/**
 * What a change touches: compare the code at the merge base with the code
 * now, using the same analysis on both sides.
 *
 * The base is checked out into a temporary git worktree, so the user's
 * working copy is never touched. The head is the working copy as it is
 * (uncommitted edits included) unless another ref is given.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import type { AnalysisResult, CycleGroup } from './types.js';
import { analyzeProject } from './analyzer.js';
import { readGitHistory, type GitCommit } from './git.js';
import { coChanges } from './behavior.js';
import { reverseEdges } from './internal/graph.js';
import { CODE_EXTENSIONS } from './internal/discovery.js';

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  role: 'source' | 'test';
  added: number;
  removed: number;
  complexityBefore: number | null; // sum over units, null when the file did not exist
  complexityAfter: number | null;
  directDependents: number; // distinct files importing it after the change
  topAuthor: string | null; // most surviving lines at the base, from git blame
  onlyAuthor: boolean; // that author wrote every surviving line
}

export interface DiffReport {
  base: string;
  head: string;
  mergeBase: string;
  headCommit: string;
  files: DiffFile[];
  totals: { files: number; added: number; removed: number };
  blastRadius: { files: number; percent: number; entryPoints: string[] };
  complexity: {
    net: number;
    functions: Array<{ file: string; name: string; before: number | null; after: number | null }>;
  };
  /** Cycle groups after the change that are new, or larger than any group before it. */
  newCycles: CycleGroup[];
  removedCycles: number;
  /** The clone has limited history, so authorship and co-change counts only cover what is there. */
  shallowHistory: boolean;
  owners: Array<{ author: string; lines: number; percent: number }>;
  partners: Array<{ file: string; partnerOf: string; together: number; commitsOfChanged: number; hidden: boolean }>;
  resolution: { internal: number; projectImports: number; unresolved: number };
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 1024 * 1024 * 512, windowsHide: true }, (err, stdout, stderr) =>
      err ? reject(new Error(`git ${args[0]} failed: ${String(stderr || err.message).trim()}`)) : resolve(stdout),
    );
  });
}

const isCode = (p: string) => CODE_EXTENSIONS.includes(path.extname(p).toLowerCase()) && !/\.d\.[cm]?ts$/i.test(p);

export async function analyzeDiff(
  projectPath: string,
  options: { base: string; head?: string; log?: (m: string) => void },
): Promise<DiffReport> {
  const log = options.log ?? (() => {});
  const root = path.resolve(projectPath);
  const headRef = options.head ?? 'HEAD';
  const useWorkingTree = options.head === undefined;
  for (const ref of [options.base, headRef]) {
    // A ref starting with "-" would be read by git as an option.
    if (!ref || ref.startsWith('-')) throw new Error(`Not a valid git ref: ${ref}`);
  }

  let mergeBase: string;
  try {
    mergeBase = (await git(root, ['merge-base', options.base, headRef])).trim();
  } catch (e) {
    throw new Error(
      `Could not find a common commit for ${options.base} and ${headRef}. In CI, fetch full history (actions/checkout with fetch-depth: 0). ${(e as Error).message}`,
    );
  }
  const headCommit = (await git(root, ['rev-parse', headRef])).trim();
  const prefix = (await git(root, ['rev-parse', '--show-prefix'])).trim();

  // Changed files, relative to the analyzed folder.
  const range = useWorkingTree ? [mergeBase] : [mergeBase, headRef];
  const nameStatus = await git(root, ['diff', '--name-status', '-z', '-M', '--relative', ...range, '--', '.']);
  const numstat = await git(root, ['diff', '--numstat', '-z', '-M', '--relative', ...range, '--', '.']);
  const changes = parseNameStatus(nameStatus).filter((c) => isCode(c.path) || (c.oldPath && isCode(c.oldPath)));
  const lineCounts = parseNumstat(numstat);

  // Analyze both sides.
  log('Analyzing the change');
  const headDir = useWorkingTree ? root : await addWorktree(root, headRef);
  const baseDir = await addWorktree(root, mergeBase);
  let head: AnalysisResult;
  let base: AnalysisResult;
  try {
    head = await analyzeProject(useWorkingTree ? root : path.join(headDir, prefix));
    base = await analyzeProject(path.join(baseDir, prefix));
  } finally {
    await removeWorktree(root, baseDir);
    if (!useWorkingTree) await removeWorktree(root, headDir);
  }

  const headRoles = new Map(head.files.map((f) => [f.path, f.role] as const));
  const baseRoles = new Map(base.files.map((f) => [f.path, f.role] as const));
  const sumBy = (r: AnalysisResult) => {
    const m = new Map<string, number>();
    for (const fn of r.functions) m.set(fn.file, (m.get(fn.file) ?? 0) + fn.complexity);
    return m;
  };
  const headCx = sumBy(head);
  const baseCx = sumBy(base);
  const rev = reverseEdges(head.dependencyGraph);

  const relevant = changes.filter((c) => headRoles.has(c.path) || baseRoles.has(c.oldPath ?? c.path));
  const changedHead = relevant.filter((c) => c.status !== 'deleted').map((c) => c.path);
  const changedSet = new Set([...changedHead, ...relevant.map((c) => c.oldPath ?? c.path)]);

  // Authorship at the base, from git blame (files that existed before the change).
  const blame = await blameLines(root, mergeBase, relevant.filter((c) => c.status !== 'added').map((c) => c.oldPath ?? c.path).slice(0, 60));

  const files: DiffFile[] = relevant.map((c) => {
    const before = c.oldPath ?? c.path;
    const lines = lineCounts.get(c.path) ?? { added: 0, removed: 0 };
    const authors = blame.byFile.get(before);
    let topAuthor: string | null = null;
    let topLines = 0;
    let total = 0;
    for (const [a, n] of authors ?? []) {
      total += n;
      if (n > topLines) {
        topLines = n;
        topAuthor = a;
      }
    }
    return {
      path: c.path,
      oldPath: c.oldPath,
      status: c.status,
      role: headRoles.get(c.path) ?? baseRoles.get(before) ?? 'source',
      added: lines.added,
      removed: lines.removed,
      complexityBefore: baseRoles.has(before) ? baseCx.get(before) ?? 0 : null,
      complexityAfter: headRoles.has(c.path) && c.status !== 'deleted' ? headCx.get(c.path) ?? 0 : null,
      directDependents: rev.get(c.path)?.size ?? 0,
      topAuthor,
      onlyAuthor: total > 0 && topLines === total,
    };
  });

  // Every file that can be affected through imports, after the change.
  const reached = new Set<string>();
  let frontier = changedHead;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const f of frontier) {
      for (const dep of rev.get(f) ?? []) {
        if (changedSet.has(dep) || reached.has(dep)) continue;
        reached.add(dep);
        next.push(dep);
      }
    }
    frontier = next;
  }
  const entrySet = new Set(head.entryPoints.filter((e) => e.reason !== 'test file').map((e) => e.file));
  const entryPoints = Array.from(reached).filter((f) => entrySet.has(f)).sort();

  // Function-level complexity changes in the changed files.
  const unitsBy = (r: AnalysisResult, filesOfInterest: Set<string>) => {
    const m = new Map<string, number>();
    for (const fn of r.functions) {
      if (!filesOfInterest.has(fn.file)) continue;
      const key = `${fn.file}\u0000${fn.name}`;
      m.set(key, (m.get(key) ?? 0) + fn.complexity);
    }
    return m;
  };
  const renamedTo = new Map(relevant.filter((c) => c.oldPath).map((c) => [c.oldPath!, c.path] as const));
  const headUnits = unitsBy(head, new Set(changedHead));
  const baseUnitsRaw = unitsBy(base, new Set(relevant.map((c) => c.oldPath ?? c.path)));
  const baseUnits = new Map<string, number>();
  for (const [key, v] of baseUnitsRaw) {
    const [file, name] = key.split('\u0000');
    baseUnits.set(`${renamedTo.get(file) ?? file}\u0000${name}`, v);
  }
  const fnChanges: DiffReport['complexity']['functions'] = [];
  for (const key of new Set([...headUnits.keys(), ...baseUnits.keys()])) {
    const before = baseUnits.get(key) ?? null;
    const after = headUnits.get(key) ?? null;
    if (before === after) continue;
    const [file, name] = key.split('\u0000');
    fnChanges.push({ file, name, before, after });
  }
  fnChanges.sort((a, b) => Math.abs((b.after ?? 0) - (b.before ?? 0)) - Math.abs((a.after ?? 0) - (a.before ?? 0)) || a.file.localeCompare(b.file));
  const net = files.reduce((s, f) => s + (f.complexityAfter ?? 0) - (f.complexityBefore ?? 0), 0);

  // Cycles that exist after the change and did not before.
  const baseGroups = base.dependencyGraph.cycleGroups.map((g) => new Set(g.files.map((f) => renamedTo.get(f) ?? f)));
  const newCycles = head.dependencyGraph.cycleGroups.filter((g) => !baseGroups.some((b) => g.files.every((f) => b.has(f))));
  const headGroups = head.dependencyGraph.cycleGroups.map((g) => new Set(g.files));
  const removedCycles = base.dependencyGraph.cycleGroups.filter(
    (g) => !headGroups.some((h) => g.files.every((f) => h.has(renamedTo.get(f) ?? f))),
  ).length;

  // Files that usually change with the changed ones but are not in this change (history before the change).
  let partners: DiffReport['partners'] = [];
  const history = await readGitHistory(root);
  if (history.available) {
    const inChange = new Set((await git(root, ['rev-list', `${mergeBase}..${headCommit}`])).split('\n').filter(Boolean));
    const before: GitCommit[] = history.commits.filter((c) => !inChange.has(c.hash));
    // History paths are current names, so pair them with the analysis after the change.
    const pairs = coChanges(head, before);
    const seen = new Set<string>();
    for (const p of pairs) {
      for (const [changed, other, commits] of [
        [p.a, p.b, p.commitsA],
        [p.b, p.a, p.commitsB],
      ] as const) {
        const now = renamedTo.get(changed) ?? changed;
        if (!changedSet.has(changed) && !changedSet.has(now)) continue;
        if (changedSet.has(other) || seen.has(other)) continue;
        seen.add(other);
        partners.push({ file: other, partnerOf: now, together: p.together, commitsOfChanged: commits, hidden: p.hidden });
      }
    }
    partners = partners.slice(0, 10);
  }

  const shallowHistory = (await git(root, ['rev-parse', '--is-shallow-repository']).catch(() => 'false')).trim() === 'true';
  const owners = Array.from(blame.totals, ([author, lines]) => ({
    author,
    lines,
    percent: blame.total > 0 ? Math.round((lines / blame.total) * 100) : 0,
  }))
    .sort((a, b) => b.lines - a.lines || a.author.localeCompare(b.author))
    .slice(0, 5);

  return {
    base: options.base,
    head: useWorkingTree ? 'working tree' : headRef,
    mergeBase,
    headCommit,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    totals: {
      files: files.length,
      added: files.reduce((s, f) => s + f.added, 0),
      removed: files.reduce((s, f) => s + f.removed, 0),
    },
    blastRadius: {
      files: reached.size,
      percent: head.files.length > 0 ? Math.round((reached.size / head.files.length) * 1000) / 10 : 0,
      entryPoints,
    },
    complexity: { net, functions: fnChanges.slice(0, 20) },
    newCycles,
    removedCycles,
    shallowHistory,
    owners,
    partners,
    resolution: { internal: head.resolution.internal, projectImports: head.resolution.projectImports, unresolved: head.resolution.unresolved },
  };
}

async function addWorktree(root: string, ref: string): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsight-base-'));
  fs.rmSync(dir, { recursive: true, force: true });
  await git(root, ['worktree', 'add', '--detach', '--quiet', dir, ref]);
  return dir;
}

async function removeWorktree(root: string, dir: string): Promise<void> {
  try {
    await git(root, ['worktree', 'remove', '--force', dir]);
  } catch {
    fs.rmSync(dir, { recursive: true, force: true });
    await git(root, ['worktree', 'prune']).catch(() => {});
  }
}

interface Change {
  path: string;
  oldPath?: string;
  status: DiffFile['status'];
}

export function parseNameStatus(raw: string): Change[] {
  const f = raw.split('\0').filter((x) => x.length > 0);
  const out: Change[] = [];
  for (let i = 0; i < f.length; i++) {
    const code = f[i][0];
    if (code === 'R' || code === 'C') {
      const oldPath = f[++i];
      const newPath = f[++i];
      if (code === 'R') out.push({ path: newPath, oldPath, status: 'renamed' });
      else out.push({ path: newPath, status: 'added' });
    } else {
      const p = f[++i];
      out.push({ path: p, status: code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified' });
    }
  }
  return out;
}

export function parseNumstat(raw: string): Map<string, { added: number; removed: number }> {
  const out = new Map<string, { added: number; removed: number }>();
  const parts = raw.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const m = parts[i].match(/^(\d+|-)\t(\d+|-)\t(.*)$/s);
    if (!m) continue;
    const added = m[1] === '-' ? 0 : Number(m[1]);
    const removed = m[2] === '-' ? 0 : Number(m[2]);
    let p = m[3];
    if (p === '') {
      // Rename: the old and new paths follow as separate fields.
      i += 2;
      p = parts[i];
    }
    if (p) out.set(p, { added, removed });
  }
  return out;
}

async function blameLines(root: string, rev: string, files: string[]) {
  const byFile = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();
  let total = 0;
  for (const file of files) {
    let out: string;
    try {
      out = await git(root, ['blame', '--line-porcelain', '-w', rev, '--', file]);
    } catch {
      continue; // binary or missing at that revision
    }
    const counts = new Map<string, number>();
    for (const line of out.split('\n')) {
      if (!line.startsWith('author ')) continue;
      const a = line.slice(7);
      if (/\[bot\]$/i.test(a)) continue; // automation accounts are not people who know the code
      counts.set(a, (counts.get(a) ?? 0) + 1);
      totals.set(a, (totals.get(a) ?? 0) + 1);
      total++;
    }
    byFile.set(file, counts);
  }
  return { byFile, totals, total };
}

/** The report as a pull request comment: plain facts, no verdict. */
export function diffToMarkdown(r: DiffReport): string {
  const out: string[] = [];
  const short = (s: string) => s.slice(0, 7);
  out.push(`### What this change touches`);
  out.push('');
  out.push(
    `${r.totals.files} code file${r.totals.files === 1 ? '' : 's'} changed, +${r.totals.added} -${r.totals.removed}. ` +
      `Compared with ${r.base} at ${short(r.mergeBase)}.`,
  );
  out.push('');
  out.push(`| | |`);
  out.push(`| --- | --- |`);
  out.push(
    `| Blast radius | ${r.blastRadius.files} file${r.blastRadius.files === 1 ? '' : 's'} reachable through imports (${r.blastRadius.percent}%)` +
      (r.blastRadius.entryPoints.length > 0 ? `, including ${r.blastRadius.entryPoints.length} entry point${r.blastRadius.entryPoints.length === 1 ? '' : 's'}` : '') +
      ' |',
  );
  out.push(`| New or larger dependency cycles | ${r.newCycles.length}${r.newCycles.length > 0 ? `: ${r.newCycles.map((c) => '`' + c.example.join(' → ') + '`').join(', ')}` : ''} |`);
  out.push(`| Complexity, net change | ${r.complexity.net > 0 ? '+' : ''}${r.complexity.net} |`);
  if (r.resolution.unresolved > 0) out.push(`| Imports TSight could not resolve | ${r.resolution.unresolved} of ${r.resolution.projectImports} |`);
  out.push('');

  if (r.files.length > 0) {
    out.push(`<details><summary>Changed files</summary>`);
    out.push('');
    out.push(`| File | Lines | Complexity | Imported by | Knows it best |`);
    out.push(`| --- | --- | --- | --- | --- |`);
    for (const f of r.files) {
      const cx =
        f.complexityBefore === null ? `new, ${f.complexityAfter}` : f.complexityAfter === null ? 'deleted' : `${f.complexityBefore} → ${f.complexityAfter}`;
      const who = f.topAuthor ? `${f.topAuthor}${f.onlyAuthor ? ' (only author)' : ''}` : 'new file';
      out.push(`| \`${f.path}\`${f.role === 'test' ? ' (test)' : ''} | +${f.added} -${f.removed} | ${cx} | ${f.directDependents} | ${who} |`);
    }
    out.push('');
    out.push(`</details>`);
    out.push('');
  }
  if (r.complexity.functions.length > 0) {
    out.push(`**Biggest complexity changes:** ` + r.complexity.functions.slice(0, 5).map((f) => `\`${f.name}\` ${f.before ?? 'new'} → ${f.after ?? 'removed'}`).join(', '));
    out.push('');
  }
  if (r.partners.length > 0) {
    out.push(`**Usually changes with these files, but not in this change:**`);
    for (const p of r.partners.slice(0, 5)) {
      out.push(`- \`${p.file}\` changed in ${p.together} of the ${p.commitsOfChanged} commits that touched \`${p.partnerOf}\`${p.hidden ? ' (no import between them)' : ''}`);
    }
    out.push('');
  }
  if (r.owners.length > 0) {
    out.push(`**Who wrote the lines being changed:** ` + r.owners.map((o) => `${o.author} ${o.percent}%`).join(', '));
    out.push('');
  }
  if (r.shallowHistory) {
    out.push(`> This clone has only part of the git history, so authorship and "usually changes with" only cover the commits it has. In CI, check out with fetch-depth: 0.`);
    out.push('');
  }
  out.push(`<sub>Generated by TSight from the code and git history. No AI, no guessing.</sub>`);
  return out.join('\n');
}
