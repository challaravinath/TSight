import { ImportInfo, Dependency, DependencyGraph, PackageUsage } from '../types.js';

export function buildDependencyGraph(imports: ImportInfo[]): DependencyGraph {
  const nodeSet = new Set<string>();
  const edgeMap = new Map<string, Dependency>();

  for (const imp of imports) {
    if (imp.isExternal) continue;

    nodeSet.add(imp.from);
    nodeSet.add(imp.to);

    const key = `${imp.from}->${imp.to}`;
    if (edgeMap.has(key)) {
      edgeMap.get(key)!.weight++;
    } else {
      edgeMap.set(key, {
        source: imp.from,
        target: imp.to,
        type: 'import',
        weight: 1,
      });
    }
  }

  const edges = Array.from(edgeMap.values());
  const circular = detectCycles(Array.from(nodeSet), edges);

  return {
    nodes: Array.from(nodeSet),
    edges,
    circular,
  };
}

function detectCycles(nodes: string[], edges: Dependency[]): string[][] {
  const cycles: string[][] = [];
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    adjacency.set(node, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }

  const visited = new Set<string>();
  const recStack = new Set<string>();

  const dfs = (node: string, path: string[]): void => {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    for (const neighbor of adjacency.get(node) || []) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...path]);
      } else if (recStack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        if (cycleStart !== -1) {
          cycles.push(path.slice(cycleStart));
        }
      }
    }

    recStack.delete(node);
  };

  for (const node of nodes) {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  }

  return cycles;
}

export function extractExternalPackages(imports: ImportInfo[]): PackageUsage[] {
  const packageMap = new Map<string, PackageUsage>();

  for (const imp of imports) {
    if (!imp.isExternal) continue;

    let pkgName = imp.to;
    if (pkgName.startsWith('@')) {
      const parts = pkgName.split('/');
      pkgName = parts.slice(0, 2).join('/');
    } else {
      pkgName = pkgName.split('/')[0];
    }

    if (!packageMap.has(pkgName)) {
      packageMap.set(pkgName, { name: pkgName, importCount: 0, usedIn: [] });
    }

    const pkg = packageMap.get(pkgName)!;
    pkg.importCount++;
    if (!pkg.usedIn.includes(imp.from)) {
      pkg.usedIn.push(imp.from);
    }
  }

  return Array.from(packageMap.values()).sort((a, b) => b.importCount - a.importCount);
}
