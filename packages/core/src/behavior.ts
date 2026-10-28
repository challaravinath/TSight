/**
 * Facts that combine the code with its git history.
 */
import type { AnalysisResult } from './types.js';
import type { GitCommit } from './git.js';

/** Commits touching more files than this are skipped for co-change: they are usually renames, formatting or dependency sweeps. */
export const MAX_FILES_PER_COMMIT = 30;

export interface ChangeHotspot {
  file: string;
  commits: number; // commits touching the file in the window
  authors: number;
  maxComplexity: number; // highest cyclomatic complexity of any unit in the file
  topFunction: string | null; // the unit with that complexity
  score: number; // commits × maxComplexity
}

/**
 * Change hotspots: files that change often and are hard to change.
 * score = commits in the last `days` days × the highest complexity of any
 * function in the file. Source files only.
 */
export function changeHotspots(result: AnalysisResult, commits: GitCommit[], days = 90, now = new Date()): ChangeHotspot[] {
  const since = now.getTime() - days * 86_400_000;
  const source = new Set(result.files.filter((f) => f.role === 'source').map((f) => f.path));
  const perFile = new Map<string, { commits: number; authors: Set<string> }>();
  for (const c of commits) {
    if (c.bot || Date.parse(c.date) < since) continue;
    for (const f of c.files) {
      if (!source.has(f)) continue;
      const e = perFile.get(f) ?? { commits: 0, authors: new Set<string>() };
      e.commits++;
      e.authors.add(c.author);
      perFile.set(f, e);
    }
  }
  const top = new Map<string, { cx: number; name: string }>();
  for (const fn of result.functions) {
    const cur = top.get(fn.file);
    if (!cur || fn.complexity > cur.cx) top.set(fn.file, { cx: fn.complexity, name: fn.name });
  }
  return Array.from(perFile, ([file, e]) => {
    const t = top.get(file);
    const maxComplexity = t?.cx ?? 0;
    return {
      file,
      commits: e.commits,
      authors: e.authors.size,
      maxComplexity,
      topFunction: t?.name ?? null,
      score: e.commits * maxComplexity,
    };
  })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
}

export interface CoChange {
  a: string;
  b: string;
  together: number; // commits that touched both
  commitsA: number;
  commitsB: number;
  /** together / commits of the less-changed file: "B changed in 14 of the 16 commits that touched A". */
  confidence: number;
  /** True when neither file imports the other directly. */
  hidden: boolean;
}

export interface CoChangeOptions {
  minTogether?: number; // default 5
  minConfidence?: number; // default 0.8
  since?: Date | null; // default: whole history
}

/**
 * Pairs of source files that keep changing in the same commits. Pairs
 * with no import between them are hidden coupling: the code does not show
 * the link, the history does.
 */
export function coChanges(result: AnalysisResult, commits: GitCommit[], options: CoChangeOptions = {}): CoChange[] {
  const minTogether = options.minTogether ?? 5;
  const minConfidence = options.minConfidence ?? 0.8;
  const sinceMs = options.since ? options.since.getTime() : -Infinity;
  const source = new Set(result.files.filter((f) => f.role === 'source').map((f) => f.path));

  const fileCommits = new Map<string, number>();
  const pairs = new Map<string, number>();
  for (const c of commits) {
    if (c.bot || Date.parse(c.date) < sinceMs) continue;
    // Large commits are left out of both counts, so "14 of 16" compares like with like.
    if (c.files.length > MAX_FILES_PER_COMMIT) continue;
    const files = Array.from(new Set(c.files.filter((f) => source.has(f)))).sort();
    for (const f of files) fileCommits.set(f, (fileCommits.get(f) ?? 0) + 1);
    if (files.length < 2) continue;
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const key = `${files[i]}\u0000${files[j]}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }

  const linked = new Set<string>();
  for (const e of result.dependencyGraph.edges) {
    linked.add(`${e.source}\u0000${e.target}`);
    linked.add(`${e.target}\u0000${e.source}`);
  }

  const out: CoChange[] = [];
  for (const [key, together] of pairs) {
    if (together < minTogether) continue;
    const [a, b] = key.split('\u0000');
    const commitsA = fileCommits.get(a) ?? 0;
    const commitsB = fileCommits.get(b) ?? 0;
    const confidence = together / Math.min(commitsA, commitsB);
    if (confidence < minConfidence) continue;
    out.push({ a, b, together, commitsA, commitsB, confidence: Math.round(confidence * 100) / 100, hidden: !linked.has(key) });
  }
  return out.sort((x, y) => y.together - x.together || y.confidence - x.confidence || x.a.localeCompare(y.a));
}
