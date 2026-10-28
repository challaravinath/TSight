/**
 * Derived views over an AnalysisResult. These are pure functions: the API
 * and any other caller get the same numbers for the same snapshot.
 */
import * as path from 'path';
import type { AnalysisResult, Hotspot, BlastRadius, FileInfo } from './types.js';
import { reverseEdges } from './internal/graph.js';
import { generateFileCrux } from './internal/file-crux.js';

function sourcePaths(result: AnalysisResult): Set<string> {
  return new Set(result.files.filter((f) => f.role === 'source').map((f) => f.path));
}

/** Distinct source files that import each file directly. */
export function sourceDependents(result: AnalysisResult): Map<string, string[]> {
  const source = sourcePaths(result);
  const rev = reverseEdges(result.dependencyGraph);
  const out = new Map<string, string[]>();
  for (const [target, from] of rev) {
    out.set(target, Array.from(from).filter((f) => source.has(f)).sort());
  }
  return out;
}

/**
 * Structural hotspots: files that are both complex and widely imported.
 * complexity = sum of unit complexities in the file; dependents = distinct
 * source files importing it. Listed when complexity >= 10 and dependents >= 3.
 * riskLevel: 500 or more is critical, 200 or more is high.
 */
export function computeHotspots(result: AnalysisResult, limit = 20): Hotspot[] {
  const dependents = sourceDependents(result);
  const byFile = new Map<string, { total: number; functions: Hotspot['functions'] }>();
  for (const fn of result.functions) {
    const entry = byFile.get(fn.file) ?? { total: 0, functions: [] };
    entry.total += fn.complexity;
    if (fn.complexity >= 5) entry.functions.push({ name: fn.name, complexity: fn.complexity, line: fn.line });
    byFile.set(fn.file, entry);
  }

  const hotspots: Hotspot[] = [];
  for (const file of sourcePaths(result)) {
    const c = byFile.get(file);
    const d = dependents.get(file)?.length ?? 0;
    if (!c || c.total < 10 || d < 3) continue;
    const riskScore = c.total * d;
    hotspots.push({
      file,
      name: path.posix.basename(file),
      complexity: c.total,
      dependents: d,
      riskScore,
      riskLevel: riskScore >= 500 ? 'critical' : riskScore >= 200 ? 'high' : 'medium',
      functions: c.functions.sort((a, b) => b.complexity - a.complexity).slice(0, 5),
    });
  }
  return hotspots.sort((a, b) => b.riskScore - a.riskScore || a.file.localeCompare(b.file)).slice(0, limit);
}

/**
 * Every file that can be affected by a change to `file`, following
 * resolved imports backwards. Level 1 imports it directly; level 2 imports
 * a level 1 file; and so on, with no depth limit.
 */
export function blastRadius(result: AnalysisResult, file: string): BlastRadius | null {
  const info = result.files.find((f) => f.path === file);
  if (!info) return null;
  const roles = new Map(result.files.map((f) => [f.path, f.role] as const));
  const rev = reverseEdges(result.dependencyGraph);

  const visited = new Set<string>([file]);
  const levels: BlastRadius['levels'] = [];
  let frontier = [file];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const f of frontier) {
      for (const dep of rev.get(f) ?? []) {
        if (visited.has(dep)) continue;
        visited.add(dep);
        next.push(dep);
      }
    }
    if (next.length === 0) break;
    next.sort();
    levels.push({
      level: levels.length + 1,
      files: next.map((p) => ({ file: p, name: path.posix.basename(p), role: roles.get(p) ?? 'source' })),
    });
    frontier = next;
  }

  const directImpact = levels[0]?.files.length ?? 0;
  const totalImpact = levels.reduce((s, l) => s + l.files.length, 0);
  const indirectImpact = totalImpact - directImpact;
  const totalFiles = result.files.length;
  const percentageImpact = totalFiles > 0 ? Math.round((totalImpact / totalFiles) * 1000) / 10 : 0;
  const unresolved = result.resolution.unresolved;

  let riskLevel: BlastRadius['riskLevel'] = 'low';
  if (totalImpact >= 50 || percentageImpact >= 10) riskLevel = 'critical';
  else if (totalImpact >= 20 || percentageImpact >= 5) riskLevel = 'high';
  else if (totalImpact >= 5) riskLevel = 'medium';

  const caveat =
    unresolved > 0
      ? ` ${unresolved} import${unresolved === 1 ? '' : 's'} in the project could not be resolved and are not counted.`
      : '';
  const summary =
    totalImpact === 0
      ? `No analyzed file imports this file.${caveat}`
      : `${totalImpact} file${totalImpact === 1 ? '' : 's'} can be affected (${percentageImpact}% of analyzed files): ` +
        `${directImpact} import it directly and ${indirectImpact} through other files.${caveat}`;

  return {
    file,
    name: info.name,
    directImpact,
    indirectImpact,
    totalImpact,
    totalFiles,
    percentageImpact,
    riskLevel,
    levels,
    unresolvedInProject: unresolved,
    summary,
  };
}

export interface DependencyInsights {
  coreFiles: Array<{ file: string; name: string; dependentCount: number }>;
  complexFiles: Array<{ file: string; name: string; importCount: number }>;
  isolatedFiles: Array<{ file: string; name: string }>;
  circularDeps: Array<{ cycle: string[]; files: string[] }>;
  hotspots: Hotspot[];
}

/**
 * coreFiles: imported by 5 or more distinct source files.
 * complexFiles: imports 10 or more distinct project files.
 * isolatedFiles: source files with no project imports in either direction and no entry-point rule.
 */
export function computeInsights(result: AnalysisResult): DependencyInsights {
  const dependents = sourceDependents(result);
  const source = sourcePaths(result);
  const outgoing = new Map<string, Set<string>>();
  const touched = new Set<string>();
  for (const e of result.dependencyGraph.edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, new Set());
    outgoing.get(e.source)!.add(e.target);
    touched.add(e.source);
    touched.add(e.target);
  }
  const entries = new Set(result.entryPoints.map((e) => e.file));
  const base = (p: string) => path.posix.basename(p);

  return {
    coreFiles: Array.from(dependents)
      .filter(([file, from]) => source.has(file) && from.length >= 5)
      .map(([file, from]) => ({ file, name: base(file), dependentCount: from.length }))
      .sort((a, b) => b.dependentCount - a.dependentCount || a.file.localeCompare(b.file)),
    complexFiles: Array.from(outgoing)
      .filter(([file, to]) => source.has(file) && to.size >= 10)
      .map(([file, to]) => ({ file, name: base(file), importCount: to.size }))
      .sort((a, b) => b.importCount - a.importCount || a.file.localeCompare(b.file)),
    isolatedFiles: result.files
      .filter((f) => f.role === 'source' && !touched.has(f.path) && !entries.has(f.path))
      .map((f) => ({ file: f.path, name: f.name })),
    circularDeps: result.dependencyGraph.cycleGroups.map((g) => ({ cycle: g.example, files: g.files })),
    hotspots: computeHotspots(result),
  };
}

/** Everything the file panel needs, from resolved edges only (exact path matches). */
export function fileDetail(result: AnalysisResult, filePath: string) {
  const file = result.files.find((f) => f.path === filePath);
  if (!file) return null;

  const classes = result.classes.filter((c) => c.file === filePath);
  const functions = result.functions.filter((f) => f.file === filePath);
  const interfaces = result.interfaces.filter((i) => i.file === filePath);
  const outgoing = result.imports.filter((i) => i.from === filePath);
  const incoming = result.imports.filter((i) => i.kind === 'internal' && i.to === filePath && i.from !== filePath);

  const importedByFiles = Array.from(new Set(incoming.map((i) => i.from))).sort();
  const internalTargets = Array.from(new Set(outgoing.filter((i) => i.kind === 'internal').map((i) => i.to))).sort();
  const packages = Array.from(
    new Set(
      outgoing
        .filter((i) => i.kind === 'external')
        .map((i) => (i.specifier.startsWith('@') ? i.specifier.split('/').slice(0, 2).join('/') : i.specifier.split('/')[0])),
    ),
  ).sort();
  const entry = result.entryPoints.find((e) => e.file === filePath);
  const exportNames = result.exportsByFile[filePath] ?? [];

  const complexity = functions.reduce((s, f) => s + f.complexity, 0);
  const avgComplexity = functions.length > 0 ? Math.round((complexity / functions.length) * 10) / 10 : 0;

  const allExports = [
    ...classes.filter((c) => c.exported).map((c) => ({ name: c.name, type: 'class', line: c.line })),
    ...functions.filter((f) => f.exported).map((f) => ({ name: f.name, type: 'function', line: f.line })),
    ...interfaces.filter((i) => i.exported).map((i) => ({ name: i.name, type: 'interface', line: i.line })),
  ];

  return {
    ...file,
    crux: generateFileCrux({
      exportNames,
      importedBy: importedByFiles,
      internalImports: internalTargets,
      externalPackages: packages,
      entryReason: entry?.reason,
      role: file.role,
    }),
    entryReason: entry?.reason ?? null,
    exportNames,
    allExports,
    classes: classes.map((c) => ({
      name: c.name,
      line: c.line,
      methods: c.methods.length,
      properties: c.properties.length,
      extends: c.extends,
      implements: c.implements,
      exported: c.exported,
    })),
    functions: functions.map((f) => ({
      name: f.name,
      kind: f.kind,
      line: f.line,
      params: f.parameters.length,
      complexity: f.complexity,
      async: f.async,
      exported: f.exported,
    })),
    interfaces: interfaces.map((i) => ({ name: i.name, line: i.line, properties: i.properties.length, exported: i.exported })),
    imports: outgoing.map((i) => ({
      module: i.to,
      specifier: i.specifier,
      kind: i.kind,
      items: i.imports,
      isExternal: i.kind === 'external',
      line: i.line,
    })),
    importedBy: incoming.map((i) => ({ file: i.from, items: i.imports, line: i.line, specifier: i.specifier })),
    metrics: {
      totalClasses: classes.length,
      totalFunctions: functions.length,
      totalInterfaces: interfaces.length,
      totalExports: exportNames.length,
      complexity,
      avgComplexity,
      importCount: outgoing.length,
      dependentCount: importedByFiles.length,
    },
    issues: result.issues.filter((i) => i.file === filePath),
    duplicates: result.duplicates.filter((d) => d.items.some((item) => item.file === filePath)),
  };
}

/**
 * Exports that no analyzed file imports by name.
 * Skipped: entry-point files (their exports are public API) and files that
 * are reached through `import *`, `export *`, `import()` or `require()`,
 * because those can use any export.
 */
export function unusedExports(result: AnalysisResult) {
  const used = new Map<string, Set<string>>();
  for (const imp of result.imports) {
    if (imp.kind !== 'internal' || imp.from === imp.to) continue;
    if (!used.has(imp.to)) used.set(imp.to, new Set());
    for (const name of imp.imports) used.get(imp.to)!.add(name);
  }
  const entries = new Set(result.entryPoints.map((e) => e.file));

  const out: Array<{ file: string; name: string; type: string; line: number }> = [];
  let totalExports = 0;
  let skippedFiles = 0;
  const roles = new Map(result.files.map((f) => [f.path, f.role] as const));
  for (const [file, names] of Object.entries(result.exportsByFile)) {
    if (roles.get(file) !== 'source') continue;
    totalExports += names.length;
    const u = used.get(file);
    if (entries.has(file) || u?.has('*')) {
      if (names.length > 0) skippedFiles++;
      continue;
    }
    for (const name of names) {
      if (u?.has(name)) continue;
      out.push({ file, name, type: 'export', line: result.exportLines[file]?.[name] ?? 1 });
    }
  }
  return {
    unusedExports: out,
    count: out.length,
    totalExports,
    skippedFiles,
    usedPercent: totalExports > 0 ? Math.round(((totalExports - out.length) / totalExports) * 100) : 100,
  };
}

/** Plain counts that used to feed a 0-100 score. No weights, no grade. */
export function codebaseFacts(result: AnalysisResult) {
  const source: FileInfo[] = result.files.filter((f) => f.role === 'source');
  const largeFiles = source.filter((f) => f.lines > 500).sort((a, b) => b.lines - a.lines);
  const sourceSet = new Set(source.map((f) => f.path));
  const complexFunctions = result.functions
    .filter((f) => sourceSet.has(f.file) && f.complexity > 15)
    .sort((a, b) => b.complexity - a.complexity);
  const r = result.resolution;
  return {
    resolution: {
      internal: r.internal,
      projectImports: r.projectImports,
      unresolved: r.unresolved,
      percentResolved: r.projectImports > 0 ? Math.round((r.internal / r.projectImports) * 1000) / 10 : 100,
    },
    items: [
      {
        rule: 'Dependency cycle groups',
        count: result.dependencyGraph.cycleGroups.length,
        items: result.dependencyGraph.cycleGroups.slice(0, 3).map((g) => g.example.join(' → ')),
      },
      { rule: 'Duplicate files', count: result.duplicates.length, items: result.duplicates.slice(0, 3).map((d) => d.items.map((i) => i.file).join(' = ')) },
      { rule: 'Files over 500 lines', count: largeFiles.length, items: largeFiles.slice(0, 3).map((f) => `${f.path} (${f.lines})`) },
      {
        rule: 'Functions with complexity over 15',
        count: complexFunctions.length,
        items: complexFunctions.slice(0, 3).map((f) => `${f.name} (${f.complexity})`),
      },
    ],
  };
}
