import type {
  CodeIssue,
  FunctionInfo,
  DependencyGraph,
  FileInfo,
  EntryPoint,
  ResolutionStats,
} from '../types.js';
import { reverseEdges } from './graph.js';

/**
 * Source files that no analyzed file imports and that no entry-point rule
 * covers. Reported as "no importers found", not "unused": a file can still
 * be loaded in ways TSight does not see (a framework TSight has no rule
 * for, or an import it could not resolve).
 */
export function findFilesWithoutImporters(
  files: FileInfo[],
  graph: DependencyGraph,
  entryPoints: EntryPoint[],
  resolution: ResolutionStats,
): CodeIssue[] {
  const importers = reverseEdges(graph);
  const entries = new Set(entryPoints.map((e) => e.file));
  const unresolvedNote =
    resolution.unresolved > 0
      ? ` ${resolution.unresolved} import${resolution.unresolved === 1 ? '' : 's'} in the project could not be resolved, so check those first.`
      : '';

  const issues: CodeIssue[] = [];
  for (const file of files) {
    if (file.role !== 'source' || entries.has(file.path)) continue;
    const from = importers.get(file.path);
    if (from && from.size > 0) {
      const sourceImporters = Array.from(from).filter((f) => !isTestPath(files, f));
      if (sourceImporters.length > 0) continue;
      issues.push({
        type: 'dead-code',
        severity: 'info',
        message: `Only imported by tests (${from.size} test file${from.size === 1 ? '' : 's'})`,
        file: file.path,
        line: 1,
        details: Array.from(from).sort().join(', '),
        suggestion: 'If it is test support code, move it next to the tests.',
      });
      continue;
    }
    issues.push({
      type: 'dead-code',
      severity: 'info',
      message: 'No importers found',
      file: file.path,
      line: 1,
      details: 'No analyzed file imports it, and it does not match an entry-point rule.' + unresolvedNote,
      suggestion: 'Confirm nothing loads it (a framework, a script, a dynamic path), then remove it.',
    });
  }
  return issues;
}

const testPathCache = new WeakMap<FileInfo[], Set<string>>();
function isTestPath(files: FileInfo[], p: string): boolean {
  let set = testPathCache.get(files);
  if (!set) {
    set = new Set(files.filter((f) => f.role === 'test').map((f) => f.path));
    testPathCache.set(files, set);
  }
  return set.has(p);
}

export function findCircularDependencies(graph: DependencyGraph): CodeIssue[] {
  return graph.cycleGroups.map((group) => {
    const cycle = group.example;
    const more = group.files.length > cycle.length ? ` (${group.files.length} files are in this cycle group)` : '';
    return {
      type: 'circular-dep' as const,
      severity: 'error' as const,
      message: `Circular dependency: ${cycle.join(' → ')} → ${cycle[0]}${more}`,
      file: cycle[0],
      details: group.files.join(', '),
      suggestion: 'Break the cycle by moving the shared code into a file both can import.',
    };
  });
}

/** Thresholds: complexity over 10, more than 50 lines, or more than 5 parameters. Over 20 complexity is an error. */
export function findComplexFunctions(functions: FunctionInfo[], files: FileInfo[]): CodeIssue[] {
  const source = new Set(files.filter((f) => f.role === 'source').map((f) => f.path));
  return functions
    .filter((f) => source.has(f.file))
    .filter((f) => f.complexity > 10 || f.lines > 50 || f.parameters.length > 5)
    .map((f) => ({
      type: 'complex' as const,
      severity: (f.complexity > 20 ? 'error' : 'warning') as 'error' | 'warning',
      message: `${f.name}: complexity ${f.complexity}, ${f.lines} lines, ${f.parameters.length} parameters`,
      file: f.file,
      line: f.line,
      suggestion: 'Split it into smaller functions.',
    }));
}
