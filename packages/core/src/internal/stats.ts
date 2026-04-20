import {
  FileInfo,
  ClassInfo,
  FunctionInfo,
  InterfaceInfo,
  CodeIssue,
  DuplicateGroup,
  ComplexityScore,
  CodeStats,
} from '../types.js';

export function calculateStats(
  files: FileInfo[],
  classes: ClassInfo[],
  functions: FunctionInfo[],
  interfaces: InterfaceInfo[],
  issues: CodeIssue[],
  duplicates: DuplicateGroup[],
  _complexity: ComplexityScore[],
): CodeStats {
  const totalLines = files.reduce((sum, f) => sum + f.lines, 0);
  const avgComplexity =
    functions.length > 0
      ? functions.reduce((sum, f) => sum + f.complexity, 0) / functions.length
      : 0;

  return {
    totalFiles: files.length,
    totalLines,
    totalClasses: classes.length,
    totalFunctions: functions.length,
    totalInterfaces: interfaces.length,
    avgComplexity: Math.round(avgComplexity * 10) / 10,
    issueCount: issues.length,
    duplicateCount: duplicates.length,
  };
}
