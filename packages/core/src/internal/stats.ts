import type { FileInfo, ClassInfo, FunctionInfo, InterfaceInfo, CodeIssue, DuplicateGroup, CodeStats } from '../types.js';

/** Counts cover source files only; test files are reported as testFiles. */
export function calculateStats(
  files: FileInfo[],
  classes: ClassInfo[],
  functions: FunctionInfo[],
  interfaces: InterfaceInfo[],
  issues: CodeIssue[],
  duplicates: DuplicateGroup[],
): CodeStats {
  const source = new Set(files.filter((f) => f.role === 'source').map((f) => f.path));
  const inSource = <T extends { file: string }>(xs: T[]) => xs.filter((x) => source.has(x.file));
  const sourceFunctions = inSource(functions);
  const avg = sourceFunctions.length > 0 ? sourceFunctions.reduce((s, f) => s + f.complexity, 0) / sourceFunctions.length : 0;

  return {
    totalFiles: source.size,
    testFiles: files.length - source.size,
    totalLines: files.filter((f) => f.role === 'source').reduce((s, f) => s + f.lines, 0),
    totalClasses: inSource(classes).length,
    totalFunctions: sourceFunctions.length,
    totalInterfaces: inSource(interfaces).length,
    avgComplexity: Math.round(avg * 10) / 10,
    issueCount: issues.length,
    duplicateCount: duplicates.length,
  };
}
