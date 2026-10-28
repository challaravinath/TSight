import type {
  ImportInfo,
  Dependency,
  DependencyGraph,
  PackageUsage,
  CycleGroup,
  ResolutionStats,
} from '../types.js';

/** Build the file graph from resolved internal imports only. */
export function buildDependencyGraph(files: string[], imports: ImportInfo[]): DependencyGraph {
  const edgeMap = new Map<string, Dependency>();

  for (const imp of imports) {
    if (imp.kind !== 'internal') continue;
    const key = `${imp.from}\u0000${imp.to}`;
    const existing = edgeMap.get(key);
    const dynamic = imp.syntax === 'dynamic';
    if (existing) {
      existing.weight++;
      existing.typeOnly = existing.typeOnly && imp.typeOnly;
      existing.dynamicOnly = existing.dynamicOnly && dynamic;
    } else {
      edgeMap.set(key, { source: imp.from, target: imp.to, type: 'import', weight: 1, typeOnly: imp.typeOnly, dynamicOnly: dynamic });
    }
  }

  const edges = Array.from(edgeMap.values());
  const cycleGroups = findCycleGroups(files, edges.filter((e) => !e.typeOnly && !e.dynamicOnly));

  return {
    nodes: [...files],
    edges,
    circular: cycleGroups.map((g) => g.example),
    cycleGroups,
  };
}

function adjacency(nodes: string[], edges: Dependency[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n, []);
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source)!.push(e.target);
  }
  for (const list of adj.values()) list.sort();
  return adj;
}

/**
 * Every strongly connected component with more than one file (or a file
 * that imports itself) is a cycle group. Tarjan's algorithm, iterative so
 * deep graphs do not overflow the stack.
 */
export function findCycleGroups(nodes: string[], edges: Dependency[]): CycleGroup[] {
  const adj = adjacency(nodes, edges);
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const groups: string[][] = [];
  let counter = 0;

  for (const start of Array.from(adj.keys()).sort()) {
    if (index.has(start)) continue;
    const work: Array<{ node: string; next: number }> = [{ node: start, next: 0 }];
    index.set(start, counter);
    low.set(start, counter);
    counter++;
    stack.push(start);
    onStack.add(start);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const neighbours = adj.get(frame.node)!;
      if (frame.next < neighbours.length) {
        const w = neighbours[frame.next++];
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter);
          counter++;
          stack.push(w);
          onStack.add(w);
          work.push({ node: w, next: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(w)!));
        }
      } else {
        work.pop();
        if (work.length > 0) {
          const parent = work[work.length - 1].node;
          low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!));
        }
        if (low.get(frame.node) === index.get(frame.node)) {
          const component: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            component.push(w);
          } while (w !== frame.node);
          const selfLoop = component.length === 1 && adj.get(w)!.includes(w);
          if (component.length > 1 || selfLoop) groups.push(component.sort());
        }
      }
    }
  }

  return groups
    .map((files) => ({ files, example: shortestCycle(files, adj) }))
    .sort((a, b) => b.files.length - a.files.length || a.files[0].localeCompare(b.files[0]));
}

/** Shortest cycle through the alphabetically first file of the group. */
function shortestCycle(group: string[], adj: Map<string, string[]>): string[] {
  const members = new Set(group);
  const start = group[0];
  const prev = new Map<string, string>();
  const queue: string[] = [start];
  const seen = new Set<string>([start]);

  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const next of adj.get(node) ?? []) {
      if (!members.has(next)) continue;
      if (next === start) {
        const path: string[] = [node];
        let cur = node;
        while (cur !== start) {
          cur = prev.get(cur)!;
          path.push(cur);
        }
        return path.reverse();
      }
      if (!seen.has(next)) {
        seen.add(next);
        prev.set(next, node);
        queue.push(next);
      }
    }
  }
  return [start];
}

/** Map file -> distinct files that import it directly (internal edges only). */
export function reverseEdges(graph: DependencyGraph): Map<string, Set<string>> {
  const rev = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (e.source === e.target) continue;
    if (!rev.has(e.target)) rev.set(e.target, new Set());
    rev.get(e.target)!.add(e.source);
  }
  return rev;
}

export function resolutionStats(imports: ImportInfo[], tsconfigs: string[]): ResolutionStats {
  const stats: ResolutionStats = {
    projectImports: 0,
    internal: 0,
    unresolved: 0,
    external: 0,
    asset: 0,
    excluded: 0,
    unresolvedImports: [],
    tsconfigs,
  };
  for (const imp of imports) {
    stats[imp.kind]++;
    if (imp.kind === 'unresolved') {
      stats.unresolvedImports.push({ from: imp.from, specifier: imp.specifier, line: imp.line });
    }
  }
  stats.projectImports = stats.internal + stats.unresolved;
  return stats;
}

export function extractExternalPackages(imports: ImportInfo[]): PackageUsage[] {
  const packageMap = new Map<string, PackageUsage>();

  for (const imp of imports) {
    if (imp.kind !== 'external') continue;

    let pkgName = imp.specifier;
    if (pkgName.startsWith('@')) {
      pkgName = pkgName.split('/').slice(0, 2).join('/');
    } else {
      pkgName = pkgName.split('/')[0];
    }

    if (!packageMap.has(pkgName)) packageMap.set(pkgName, { name: pkgName, importCount: 0, usedIn: [] });
    const pkg = packageMap.get(pkgName)!;
    pkg.importCount++;
    if (!pkg.usedIn.includes(imp.from)) pkg.usedIn.push(imp.from);
  }

  return Array.from(packageMap.values()).sort((a, b) => b.importCount - a.importCount);
}
