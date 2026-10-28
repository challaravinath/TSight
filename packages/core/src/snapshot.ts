/**
 * The snapshot: everything the UI shows, in one versioned JSON object.
 *
 * The web app reads it from the API, a static HTML report embeds it, and
 * `tsight analyze --json` writes it. Files are referred to by index into
 * `files` to keep it small on large repositories.
 */
import * as path from 'path';
import type { AnalysisResult, CycleGroup, DuplicateGroup, EntryPoint, StructuralTwin, ResolutionStats } from './types.js';
import type { GitHistory } from './git.js';
import { ownership, busFactor, type TimeWindow } from './git.js';
import { changeHotspots, coChanges } from './behavior.js';
import { codebaseFacts } from './views.js';

export const SNAPSHOT_SCHEMA = 1;

export interface SnapshotFile {
  path: string;
  lines: number;
  role: 'source' | 'test';
  complexity: number; // sum over units
  maxComplexity: number;
  topFunction: string | null;
  exports: string[];
  entry: string | null; // entry-point rule, if any
}

export interface SnapshotImport {
  from: number; // index into files
  to: number;
  line: number;
  specifier: string;
  syntax: string;
  typeOnly: boolean;
}

export interface SnapshotFunction {
  file: number;
  name: string;
  kind: string;
  line: number;
  lines: number;
  complexity: number;
  params: number;
}

export interface SnapshotGitFile {
  file: number;
  commits: number; // all time
  commits90: number; // last 90 days
  authors: Array<{ name: string; commits: number }>; // all time, most commits first
  lastChanged: string; // YYYY-MM-DD
}

export interface Snapshot {
  schema: number;
  tool: { name: 'tsight'; version: string };
  project: { name: string; root: string; analyzedAt: string; durationMs: number };
  stats: AnalysisResult['stats'];
  resolution: ResolutionStats & { percentResolved: number };
  languages: AnalysisResult['languages'];
  files: SnapshotFile[];
  imports: SnapshotImport[];
  externalImports: Array<{ from: number; package: string; line: number }>;
  functions: SnapshotFunction[];
  entryPoints: EntryPoint[];
  cycleGroups: CycleGroup[];
  duplicates: DuplicateGroup[];
  twins: StructuralTwin[];
  twinStats: { functionsCompared: number; pairsFound: number };
  noImporters: Array<{ file: number; onlyTests: boolean }>;
  git: null | {
    shallow: boolean;
    renamesFollowed: boolean;
    head: string;
    commits: number;
    authorLastActive: Record<string, string>; // author -> last commit date
    files: SnapshotGitFile[];
    changeHotspots: Array<{ file: number; commits: number; authors: number; maxComplexity: number; topFunction: string | null; score: number }>;
    coChanges: Array<{ a: number; b: number; together: number; commitsA: number; commitsB: number; confidence: number; hidden: boolean }>;
    windows: Record<
      TimeWindow,
      { singleAuthor: Array<{ file: number; author: string }>; gaps: number[]; filesWithActivity: number }
    >;
  };
}

export function buildSnapshot(
  result: AnalysisResult,
  history: GitHistory | null,
  options: { name?: string; version?: string; now?: Date } = {},
): Snapshot {
  const now = options.now ?? new Date();
  const index = new Map(result.files.map((f, i) => [f.path, i] as const));
  const idx = (p: string) => index.get(p) ?? -1;

  const cx = new Map<string, { sum: number; max: number; top: string | null }>();
  for (const fn of result.functions) {
    const e = cx.get(fn.file) ?? { sum: 0, max: 0, top: null };
    e.sum += fn.complexity;
    if (fn.complexity > e.max) {
      e.max = fn.complexity;
      e.top = fn.name;
    }
    cx.set(fn.file, e);
  }
  const entries = new Map(result.entryPoints.map((e) => [e.file, e.reason] as const));

  const files: SnapshotFile[] = result.files.map((f) => ({
    path: f.path,
    lines: f.lines,
    role: f.role,
    complexity: cx.get(f.path)?.sum ?? 0,
    maxComplexity: cx.get(f.path)?.max ?? 0,
    topFunction: cx.get(f.path)?.top ?? null,
    exports: result.exportsByFile[f.path] ?? [],
    entry: entries.get(f.path) ?? null,
  }));

  const imports: SnapshotImport[] = [];
  const externalImports: Snapshot['externalImports'] = [];
  for (const imp of result.imports) {
    if (imp.kind === 'internal') {
      const from = idx(imp.from);
      const to = idx(imp.to);
      if (from < 0 || to < 0) continue;
      imports.push({ from, to, line: imp.line, specifier: imp.specifier, syntax: imp.syntax, typeOnly: imp.typeOnly });
    } else if (imp.kind === 'external') {
      const s = imp.specifier;
      externalImports.push({ from: idx(imp.from), package: s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0], line: imp.line });
    }
  }

  const facts = codebaseFacts(result);
  const snapshot: Snapshot = {
    schema: SNAPSHOT_SCHEMA,
    tool: { name: 'tsight', version: options.version ?? '0.0.0' },
    project: {
      name: options.name ?? path.basename(result.root),
      root: result.root,
      analyzedAt: result.analyzedAt.toISOString(),
      durationMs: result.duration,
    },
    stats: result.stats,
    resolution: { ...result.resolution, percentResolved: facts.resolution.percentResolved },
    languages: result.languages,
    files,
    imports,
    externalImports,
    functions: result.functions.map((f) => ({
      file: idx(f.file),
      name: f.name,
      kind: f.kind,
      line: f.line,
      lines: f.lines,
      complexity: f.complexity,
      params: f.parameters.length,
    })),
    entryPoints: result.entryPoints,
    cycleGroups: result.dependencyGraph.cycleGroups,
    duplicates: result.duplicates,
    twins: result.structuralTwins,
    twinStats: result.structuralTwinStats,
    noImporters: result.issues
      .filter((i) => i.type === 'dead-code')
      .map((i) => ({ file: idx(i.file), onlyTests: i.message.startsWith('Only imported by tests') })),
    git: null,
  };

  if (history && history.available) {
    const current = new Set(result.files.map((f) => f.path));
    const sourcePaths = result.files.filter((f) => f.role === 'source').map((f) => f.path);
    const since90 = now.getTime() - 90 * 86_400_000;
    const perFile = new Map<string, { commits: number; commits90: number; authors: Map<string, number>; last: string }>();
    const authorLastActive: Record<string, string> = {};
    for (const c of history.commits) {
      if (c.bot) continue;
      const day = c.date.slice(0, 10);
      if (!authorLastActive[c.author] || day > authorLastActive[c.author]) authorLastActive[c.author] = day;
      const recent = Date.parse(c.date) >= since90;
      for (const f of c.files) {
        if (!current.has(f)) continue;
        const e = perFile.get(f) ?? { commits: 0, commits90: 0, authors: new Map<string, number>(), last: '' };
        e.commits++;
        if (recent) e.commits90++;
        e.authors.set(c.author, (e.authors.get(c.author) ?? 0) + 1);
        if (day > e.last) e.last = day;
        perFile.set(f, e);
      }
    }
    const windows = {} as NonNullable<Snapshot['git']>['windows'];
    for (const w of ['all', '6months', '3months'] as TimeWindow[]) {
      const bf = busFactor(history.commits, sourcePaths, w, now);
      const own = ownership(history.commits, sourcePaths, w, now);
      windows[w] = {
        singleAuthor: bf.busFactor.flatMap((b) => b.files.map((f) => ({ file: idx(f), author: b.author }))),
        gaps: own.knowledgeGaps.map((g) => idx(g.file)),
        filesWithActivity: bf.filesWithActivity,
      };
    }
    snapshot.git = {
      shallow: history.shallow,
      renamesFollowed: history.renamesFollowed,
      head: history.head,
      commits: history.commits.length,
      authorLastActive,
      files: Array.from(perFile, ([f, e]) => ({
        file: idx(f),
        commits: e.commits,
        commits90: e.commits90,
        authors: Array.from(e.authors, ([name, commits]) => ({ name, commits })).sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name)),
        lastChanged: e.last,
      })),
      changeHotspots: changeHotspots(result, history.commits, 90, now)
        .map((h) => ({ ...h, file: idx(h.file) })),
      coChanges: coChanges(result, history.commits)
        .slice(0, 200)
        .map((p) => ({ ...p, a: idx(p.a), b: idx(p.b) })),
      windows,
    };
  }
  return snapshot;
}
