import type { FileInfo, DependencyGraph, EntryPoint, MentalModel, Layer, DataFlow } from '../types.js';
import { reverseEdges } from './graph.js';

const PALETTE = ['#4C78A8', '#F58518', '#54A24B', '#B279A2', '#E45756', '#72B7B2', '#EECA3B', '#9D755D', '#BAB0AC', '#FF9DA6'];
const MAX_GROUPS = 12;

/**
 * Group source files by folder and count the imports between groups.
 *
 * Groups are real folders, never guessed roles: the first folder level
 * below whatever prefix all source files share (so a project that keeps
 * everything in src/ is grouped by src/components, src/lib, and so on).
 */
export function buildMentalModel(files: FileInfo[], graph: DependencyGraph, entryPoints: EntryPoint[]): MentalModel {
  const source = files.filter((f) => f.role === 'source');
  const depth = sharedPrefixDepth(source.map((f) => f.path));
  const groupOf = (p: string): string => {
    const parts = p.split('/');
    if (parts.length - 1 <= depth) return parts.slice(0, depth).join('/') || '.';
    return parts.slice(0, depth + 1).join('/');
  };

  const groups = new Map<string, { files: string[]; lines: number }>();
  for (const f of source) {
    const g = groupOf(f.path);
    if (!groups.has(g)) groups.set(g, { files: [], lines: 0 });
    const entry = groups.get(g)!;
    entry.files.push(f.path);
    entry.lines += f.lines;
  }

  const ordered = Array.from(groups.entries()).sort((a, b) => b[1].files.length - a[1].files.length);
  const shown = ordered.slice(0, MAX_GROUPS);
  const shownNames = new Set(shown.map(([name]) => name));

  const layers: Layer[] = shown.map(([name, g], i) => ({
    name: name === '.' ? '(root files)' : name,
    description: `${g.files.length} file${g.files.length === 1 ? '' : 's'}, ${g.lines.toLocaleString('en-US')} lines`,
    folders: name === '.' ? [] : [name],
    files: name === '.' ? g.files : [],
    color: PALETTE[i % PALETTE.length],
  }));

  const sourceSet = new Set(source.map((f) => f.path));
  const flowCounts = new Map<string, number>();
  for (const e of graph.edges) {
    if (!sourceSet.has(e.source) || !sourceSet.has(e.target)) continue;
    const from = groupOf(e.source);
    const to = groupOf(e.target);
    if (from === to || !shownNames.has(from) || !shownNames.has(to)) continue;
    const key = `${from}\u0000${to}`;
    flowCounts.set(key, (flowCounts.get(key) ?? 0) + 1);
  }
  const display = (n: string) => (n === '.' ? '(root files)' : n);
  const flows: DataFlow[] = Array.from(flowCounts, ([key, count]) => {
    const [from, to] = key.split('\u0000');
    return { from: display(from), to: display(to), label: 'imports', count };
  }).sort((a, b) => b.count - a.count);

  const rev = reverseEdges(graph);
  const coreComponents = source
    .map((f) => ({ path: f.path, n: Array.from(rev.get(f.path) ?? []).filter((p) => sourceSet.has(p)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.path.localeCompare(b.path))
    .slice(0, 10)
    .map((x) => x.path);

  return {
    layers,
    flows,
    entryPoints: entryPoints.filter((e) => sourceSet.has(e.file)).slice(0, 10).map((e) => e.file),
    coreComponents,
  };
}

/** How many leading folders every path shares, keeping at least two groups when possible. */
function sharedPrefixDepth(paths: string[]): number {
  if (paths.length === 0) return 0;
  const split = paths.map((p) => p.split('/').slice(0, -1));
  let depth = 0;
  for (;;) {
    const first = split[0][depth];
    if (first === undefined) return depth;
    if (!split.every((s) => s[depth] === first)) return depth;
    depth++;
  }
}
