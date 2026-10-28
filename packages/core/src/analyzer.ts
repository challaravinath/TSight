/**
 * TSight analyzer: runs the pipeline for one folder and returns a snapshot.
 *
 * Each run gets its own parser and resolver, so analyzing a second project
 * never carries files over from the first.
 */
import * as path from 'path';
import * as fs from 'fs';
import type { AnalysisResult, CodeIssue } from './types.js';
import { discoverFiles, toPosix } from './internal/discovery.js';
import { parseFiles } from './internal/project.js';
import { ModuleResolver, realPath } from './internal/resolve.js';
import {
  extractFiles,
  extractFolders,
  extractClasses,
  extractInterfaces,
  extractImports,
  extractExports,
  type Parsed,
} from './internal/extract.js';
import { collectUnits, calculateComplexity } from './internal/complexity.js';
import { buildDependencyGraph, extractExternalPackages, resolutionStats } from './internal/graph.js';
import { findEntryPoints } from './internal/entry-points.js';
import { buildMentalModel } from './internal/mental-model.js';
import { findFilesWithoutImporters, findCircularDependencies, findComplexFunctions } from './internal/issues.js';
import { findDuplicates } from './internal/duplicates.js';
import { findStructuralTwins } from './internal/structural-twins.js';
import { calculateLanguages } from './internal/languages.js';
import { calculateStats } from './internal/stats.js';

export interface AnalyzeOptions {
  /** Called with short progress messages. Defaults to no output. */
  log?: (message: string) => void;
}

export async function analyzeProject(projectPath: string, options: AnalyzeOptions = {}): Promise<AnalysisResult> {
  const log = options.log ?? (() => {});
  const startTime = Date.now();
  const given = path.resolve(projectPath);
  if (!fs.existsSync(given) || !fs.statSync(given).isDirectory()) {
    throw new Error(`Not a directory: ${projectPath}`);
  }
  // Work on the real path so symlinked folders (macOS /tmp, a linked checkout) compare equal.
  const root = realPath(given);

  const discovery = discoverFiles(root);
  log(`Found ${discovery.files.length} code files`);

  const parsedRaw = parseFiles(discovery.files);
  const parsed: Parsed[] = parsedRaw.map(({ sf, file }) => ({ sf, rel: file.rel, role: file.role }));

  const files = extractFiles(parsed);
  const folders = extractFolders(files);
  const languages = calculateLanguages(files);
  const { exportsByFile, exportLines, exportedLocalNames } = extractExports(parsed);
  const classes = extractClasses(parsed, exportedLocalNames);
  const interfaces = extractInterfaces(parsed, exportedLocalNames);

  const units = parsed.flatMap(({ sf, rel, role }) =>
    collectUnits(sf.compilerNode, rel, exportedLocalNames.get(rel) ?? new Set()).map((u) => ({ ...u, sf: sf.compilerNode, role })),
  );
  const functions = units.map((u) => u.info);

  const resolver = new ModuleResolver(root, parsed.map((p) => p.sf.getFilePath()));
  const imports = extractImports(root, parsed, resolver);
  const resolution = resolutionStats(imports, resolver.usedConfigs());
  log(`Resolved ${resolution.internal} of ${resolution.projectImports} project imports`);

  const dependencyGraph = buildDependencyGraph(files.map((f) => f.path), imports);
  const externalPackages = extractExternalPackages(imports);

  const packageJsons = [...discovery.packageJsons, ...packageJsonsAbove(root)];
  const entryPoints = findEntryPoints(root, files, packageJsons, discovery.htmlFiles, discovery.configFiles);

  const issues: CodeIssue[] = [
    ...findCircularDependencies(dependencyGraph),
    ...findComplexFunctions(functions, files),
    ...findFilesWithoutImporters(files, dependencyGraph, entryPoints, resolution),
  ];
  const duplicates = findDuplicates(parsed);
  const twinReport = findStructuralTwins(units);
  const sourceFiles = new Set(files.filter((f) => f.role === 'source').map((f) => f.path));
  const complexity = calculateComplexity(functions.filter((f) => sourceFiles.has(f.file)));
  const mentalModel = buildMentalModel(files, dependencyGraph, entryPoints);
  const stats = calculateStats(files, classes, functions, interfaces, issues, duplicates);

  const duration = Date.now() - startTime;
  log(`Analysis complete in ${duration} ms`);

  return {
    root,
    analyzedAt: new Date(),
    duration,
    files,
    folders,
    languages,
    classes,
    functions,
    interfaces,
    imports,
    resolution,
    dependencyGraph,
    externalPackages,
    entryPoints,
    exportsByFile,
    exportLines,
    mentalModel,
    issues,
    duplicates,
    complexity,
    structuralTwins: twinReport.twins,
    structuralTwinStats: { functionsCompared: twinReport.functionsCompared, pairsFound: twinReport.pairsFound },
    stats,
  };
}

/** The nearest package.json above the root, as a path relative to the root (e.g. ../package.json). */
function packageJsonsAbove(root: string): string[] {
  let dir = path.dirname(root);
  for (;;) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) return [toPosix(path.relative(root, candidate))];
    const parent = path.dirname(dir);
    if (parent === dir) return [];
    dir = parent;
  }
}

/** Kept for existing callers: `new Analyzer().analyze(path)`. Each call is independent. */
export class Analyzer {
  async analyze(projectPath: string, options?: AnalyzeOptions): Promise<AnalysisResult> {
    return analyzeProject(projectPath, options);
  }
}
