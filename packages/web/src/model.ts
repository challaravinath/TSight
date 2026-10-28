/**
 * The UI's view of a snapshot: indexes and derived facts, computed once.
 * Every number on screen comes from here, and each can produce its proof.
 */
import type { Snapshot, SnapshotFile, SnapshotFunction, SnapshotGitFile, DiffReport } from '@tsight/core';

export type { Snapshot, DiffReport };

declare global {
  interface Window {
    __TSIGHT_SNAPSHOT__?: Snapshot;
    __TSIGHT_DIFF__?: DiffReport | null;
  }
}

export const isStatic = () => typeof window !== 'undefined' && !!window.__TSIGHT_SNAPSHOT__;

export interface Model {
  s: Snapshot;
  files: SnapshotFile[];
  sourceIdx: number[];
  byPath: Map<string, number>;
  importsTo: number[][]; // per file: indexes into s.imports pointing at it
  importsFrom: number[][]; // per file: indexes into s.imports it makes
  importers: Array<Set<number>>; // per file: distinct files importing it
  fns: SnapshotFunction[][]; // per file
  git: Map<number, SnapshotGitFile>;
  hotspot: Map<number, NonNullable<Snapshot['git']>['changeHotspots'][number]>;
  soloAuthor: Map<number, string>; // all-time single author
  cycleOf: Map<number, number>; // file -> index into cycleGroups
  now: number; // analysis time, used for "inactive" and "recent"
  inactive: (author: string) => boolean; // no commits in the 6 months before the analysis
}

export function buildModel(s: Snapshot): Model {
  const n = s.files.length;
  const importsTo: number[][] = Array.from({ length: n }, () => []);
  const importsFrom: number[][] = Array.from({ length: n }, () => []);
  const importers: Array<Set<number>> = Array.from({ length: n }, () => new Set());
  s.imports.forEach((imp, k) => {
    importsTo[imp.to].push(k);
    importsFrom[imp.from].push(k);
    if (imp.from !== imp.to) importers[imp.to].add(imp.from);
  });
  const fns: SnapshotFunction[][] = Array.from({ length: n }, () => []);
  for (const f of s.functions) if (f.file >= 0) fns[f.file].push(f);
  const git = new Map((s.git?.files ?? []).map((g) => [g.file, g] as const));
  const hotspot = new Map((s.git?.changeHotspots ?? []).map((h) => [h.file, h] as const));
  const soloAuthor = new Map((s.git?.windows.all.singleAuthor ?? []).map((x) => [x.file, x.author] as const));
  const cycleOf = new Map<number, number>();
  const byPath = new Map(s.files.map((f, i) => [f.path, i] as const));
  s.cycleGroups.forEach((g, gi) => g.files.forEach((p) => {
    const i = byPath.get(p);
    if (i !== undefined) cycleOf.set(i, gi);
  }));
  const now = Date.parse(s.project.analyzedAt);
  const sixMonths = new Date(now);
  sixMonths.setMonth(sixMonths.getMonth() - 6);
  const cutoff = sixMonths.toISOString().slice(0, 10);
  const last = s.git?.authorLastActive ?? {};
  return {
    s,
    files: s.files,
    sourceIdx: s.files.map((_, i) => i).filter((i) => s.files[i].role === 'source'),
    byPath,
    importsTo,
    importsFrom,
    importers,
    fns,
    git,
    hotspot,
    soloAuthor,
    cycleOf,
    now,
    inactive: (author) => !last[author] || last[author] < cutoff,
  };
}

/** Files reachable backwards through imports, level by level. */
export function blastLevels(m: Model, start: number): number[][] {
  const seen = new Set([start]);
  const levels: number[][] = [];
  let frontier = [start];
  while (frontier.length) {
    const next: number[] = [];
    for (const f of frontier) for (const d of m.importers[f]) if (!seen.has(d)) { seen.add(d); next.push(d); }
    if (!next.length) break;
    next.sort((a, b) => m.files[a].path.localeCompare(m.files[b].path));
    levels.push(next);
    frontier = next;
  }
  return levels;
}

// ---------------------------------------------------------------------------
// Metrics for the codebase map and ranked lists
// ---------------------------------------------------------------------------

export type MetricKey = 'hotspot' | 'dependents' | 'solo' | 'complexity';

export interface Metric {
  key: MetricKey;
  label: string;
  formula: string;
  needsGit: boolean;
  value: (m: Model, i: number) => number;
  bucket: (v: number) => number; // 0..4
  show: (m: Model, i: number) => string;
  detail: (m: Model, i: number) => string;
  legend: Array<string | null>;
}

const steps = (cut: number[]) => (v: number) => { let i = 0; while (i < cut.length && v >= cut[i]) i++; return i; };
const fmt = (n: number) => n.toLocaleString('en-US');

export const METRICS: Record<MetricKey, Metric> = {
  hotspot: {
    key: 'hotspot',
    label: 'Change hotspot',
    formula: 'commits in the last 90 days × highest function complexity',
    needsGit: true,
    value: (m, i) => m.hotspot.get(i)?.score ?? 0,
    bucket: steps([80, 200, 500, 1000]),
    show: (m, i) => fmt(m.hotspot.get(i)?.score ?? 0),
    detail: (m, i) => {
      const h = m.hotspot.get(i);
      return h ? `${h.commits} commits × complexity ${h.maxComplexity}` : 'no commits in 90 days';
    },
    legend: ['under 80', '80 to 199', '200 to 499', '500 to 999', '1,000 and up'],
  },
  dependents: {
    key: 'dependents',
    label: 'Dependents',
    formula: 'files that import this file directly, tests included',
    needsGit: false,
    value: (m, i) => m.importers[i].size,
    bucket: steps([4, 10, 25, 50]),
    show: (m, i) => fmt(m.importers[i].size),
    detail: (m, i) => `imported by ${fmt(m.importers[i].size)} file${m.importers[i].size === 1 ? '' : 's'}`,
    legend: ['under 4', '4 to 9', '10 to 24', '25 to 49', '50 and up'],
  },
  solo: {
    key: 'solo',
    label: 'Single author',
    formula: 'every commit to the file came from one person; darkest when they have not committed in 6 months',
    needsGit: true,
    value: (m, i) => {
      const a = m.soloAuthor.get(i);
      return a ? (m.inactive(a) ? 2 : 1) : 0;
    },
    bucket: (v) => (v === 2 ? 4 : v === 1 ? 3 : 0),
    show: (m, i) => m.soloAuthor.get(i) ?? 'several authors',
    detail: (m, i) => {
      const a = m.soloAuthor.get(i);
      return a ? `only author: ${a}${m.inactive(a) ? ', inactive 6+ months' : ''}` : 'more than one author';
    },
    legend: ['several authors', null, null, 'one author, active', 'one author, inactive'],
  },
  complexity: {
    key: 'complexity',
    label: 'Complexity',
    formula: 'highest cyclomatic complexity of any function in the file',
    needsGit: false,
    value: (m, i) => m.files[i].maxComplexity,
    bucket: steps([8, 12, 20, 30]),
    show: (m, i) => `max ${m.files[i].maxComplexity}`,
    detail: (m, i) => (m.files[i].topFunction ? `${m.files[i].topFunction}()` : 'no functions'),
    legend: ['under 8', '8 to 11', '12 to 19', '20 to 29', '30 and up'],
  },
};

export const RAMP = ['var(--risk-0)', 'var(--risk-1)', 'var(--risk-2)', 'var(--risk-3)', 'var(--risk-4)'];

// ---------------------------------------------------------------------------
// Folder tree and squarified treemap
// ---------------------------------------------------------------------------

export interface TreeNode {
  name: string;
  path: string; // '' for the root
  children: TreeNode[];
  file?: number;
  lines: number;
  count: number; // files below
}

export function buildTree(m: Model): TreeNode {
  const root: TreeNode = { name: '', path: '', children: [], lines: 0, count: 0 };
  for (const i of m.sourceIdx) {
    const f = m.files[i];
    const parts = f.path.split('/');
    let node = root;
    node.lines += f.lines;
    node.count++;
    for (let k = 0; k < parts.length - 1; k++) {
      const p = parts.slice(0, k + 1).join('/');
      let child = node.children.find((c) => c.path === p && c.file === undefined);
      if (!child) {
        child = { name: parts[k], path: p, children: [], lines: 0, count: 0 };
        node.children.push(child);
      }
      child.lines += f.lines;
      child.count++;
      node = child;
    }
    node.children.push({ name: parts[parts.length - 1], path: f.path, children: [], file: i, lines: Math.max(1, f.lines), count: 1 });
  }
  // Skip folders with a single subfolder and no files, so the map starts where things branch.
  return root;
}

export function collapse(node: TreeNode): TreeNode {
  let n = node;
  while (n.children.length === 1 && n.children[0].file === undefined) n = n.children[0];
  return n;
}

export function findNode(root: TreeNode, path: string): TreeNode | null {
  if (root.path === path) return root;
  for (const c of root.children) {
    if (c.file !== undefined) continue;
    if (path === c.path || path.startsWith(c.path + '/')) return findNode(c, path);
  }
  return null;
}

export interface Rect { x: number; y: number; w: number; h: number }

/** Squarified treemap (Bruls, Huizing and van Wijk). Values must be sorted descending. */
export function squarify(values: number[], box: Rect): Rect[] {
  const out: Rect[] = new Array(values.length);
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return values.map(() => ({ x: box.x, y: box.y, w: 0, h: 0 }));
  const scale = (box.w * box.h) / total;
  const areas = values.map((v) => v * scale);
  let { x, y, w, h } = box;
  let i = 0;
  while (i < areas.length) {
    const side = Math.min(w, h);
    let row: number[] = [areas[i]];
    let j = i + 1;
    const worst = (r: number[]) => {
      const s = r.reduce((a, b) => a + b, 0);
      const max = Math.max(...r), min = Math.min(...r);
      return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
    };
    while (j < areas.length && worst([...row, areas[j]]) <= worst(row)) {
      row = [...row, areas[j]];
      j++;
    }
    const sum = row.reduce((a, b) => a + b, 0);
    const thick = sum / side;
    let offset = 0;
    for (let k = 0; k < row.length; k++) {
      const len = row[k] / thick;
      out[i + k] = w >= h ? { x, y: y + offset, w: thick, h: len } : { x: x + offset, y, w: len, h: thick };
      offset += len;
    }
    if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
    i = j;
  }
  return out;
}

export const plural = (n: number, word: string, many = word + 's') => `${fmt(n)} ${n === 1 ? word : many}`;
export { fmt };
