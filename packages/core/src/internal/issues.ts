import { SourceFile } from 'ts-morph';
import * as path from 'path';
import { CodeIssue, FunctionInfo, DependencyGraph } from '../types.js';
import { toRelative } from './paths.js';

/**
 * Conservative dead-code detection: only flag files that are completely
 * unimported anywhere. We accept missing some dead code in exchange for
 * zero false positives.
 */
export function findDeadCode(rootPath: string, sourceFiles: SourceFile[]): CodeIssue[] {
  const issues: CodeIssue[] = [];

  // Build a map of all files and what imports them
  const fileImportCount = new Map<string, number>();

  for (const sf of sourceFiles) {
    for (const imp of sf.getImportDeclarations()) {
      const moduleSpec = imp.getModuleSpecifierValue();
      if (moduleSpec.startsWith('.')) {
        const resolved = path.resolve(path.dirname(sf.getFilePath()), moduleSpec);
        const relativePath = toRelative(rootPath, resolved);

        // Count imports to this file (try various extensions)
        const variants = [
          relativePath,
          relativePath + '.ts',
          relativePath + '.tsx',
          relativePath + '/index.ts',
          relativePath + '/index.tsx',
          relativePath.replace(/\.(ts|tsx)$/, ''),
        ];

        for (const v of variants) {
          fileImportCount.set(v, (fileImportCount.get(v) || 0) + 1);
        }
      }
    }
  }

  for (const sf of sourceFiles) {
    const relativePath = toRelative(rootPath, sf.getFilePath());

    if (shouldSkipDeadCodeCheck(relativePath)) continue;

    const isImported =
      fileImportCount.has(relativePath) ||
      fileImportCount.has(relativePath.replace(/\.(ts|tsx)$/, ''));

    if (!isImported) {
      const exports = sf.getExportedDeclarations();
      if (exports.size > 0) {
        const firstName = Array.from(exports.keys())[0];

        issues.push({
          type: 'dead-code',
          severity: 'info',
          message: `File appears unused (exports "${firstName}" and ${exports.size - 1} more)`,
          file: relativePath,
          line: 1,
          suggestion: 'Verify this file is needed or remove it',
        });
      }
    }
  }

  return issues;
}

function shouldSkipDeadCodeCheck(filePath: string): boolean {
  const lower = filePath.toLowerCase();

  if (lower.includes('.test.') || lower.includes('.spec.')) return true;
  if (lower.endsWith('.d.ts')) return true;
  if (lower.endsWith('index.ts') || lower.endsWith('index.tsx')) return true;
  if (lower.includes('generated') || lower.includes('.generated.')) return true;
  if (lower.includes('/gen/') || lower.includes('\\gen\\')) return true;
  if (lower.includes('config')) return true;
  if (lower.includes('webpack')) return true;
  if (lower.includes('jest')) return true;
  if (lower.includes('babel')) return true;
  if (lower.includes('/entities/')) return true;
  if (lower.includes('/models/')) return true;
  if (lower.includes('/types/')) return true;
  if (lower.includes('enum')) return true;
  if (lower.includes('constants')) return true;
  if (lower.includes('strings')) return true;
  if (lower.includes('localization')) return true;
  if (lower.includes('i18n')) return true;
  if (lower.includes('app.ts') || lower.includes('main.ts')) return true;
  if (lower.includes('/testing/')) return true;
  if (lower.includes('/test/')) return true;
  if (lower.includes('/tests/')) return true;
  if (lower.includes('/__tests__/')) return true;
  if (lower.includes('/mock/')) return true;
  if (lower.includes('/mocks/')) return true;
  if (lower.includes('/__mocks__/')) return true;
  if (lower.includes('.mock.')) return true;
  if (lower.includes('.stub.')) return true;

  return false;
}

export function findCircularDependencies(graph: DependencyGraph): CodeIssue[] {
  return graph.circular.map((cycle) => ({
    type: 'circular-dep' as const,
    severity: 'error' as const,
    message: `Circular dependency: ${cycle.join(' → ')} → ${cycle[0]}`,
    file: cycle[0],
    details: cycle.join(' → '),
    suggestion: 'Break the cycle by extracting shared code or restructuring',
  }));
}

export function findComplexFunctions(functions: FunctionInfo[]): CodeIssue[] {
  return functions
    .filter((f) => f.complexity > 10 || f.lines > 50 || f.parameters.length > 5)
    .map((f) => ({
      type: 'complex' as const,
      severity: (f.complexity > 20 ? 'error' : 'warning') as 'error' | 'warning',
      message: `Complex function "${f.name}": complexity=${f.complexity}, lines=${f.lines}, params=${f.parameters.length}`,
      file: f.file,
      line: f.line,
      suggestion: 'Consider breaking this into smaller functions',
    }));
}
