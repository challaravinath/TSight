import { Node, SyntaxKind } from 'ts-morph';
import { FunctionInfo, ComplexityScore } from '../types.js';

export function calculateFunctionComplexity(func: any): number {
  let complexity = 1;

  try {
    const body = func.getBody?.();
    if (!body) return complexity;

    body.forEachDescendant?.((node: Node) => {
      const kind = node.getKind();
      if (
        kind === SyntaxKind.IfStatement ||
        kind === SyntaxKind.ConditionalExpression ||
        kind === SyntaxKind.ForStatement ||
        kind === SyntaxKind.ForInStatement ||
        kind === SyntaxKind.ForOfStatement ||
        kind === SyntaxKind.WhileStatement ||
        kind === SyntaxKind.DoStatement ||
        kind === SyntaxKind.CatchClause ||
        kind === SyntaxKind.CaseClause ||
        kind === SyntaxKind.BinaryExpression
      ) {
        const text = node.getText?.();
        if (text?.includes('&&') || text?.includes('||')) {
          complexity++;
        }
        complexity++;
      }
    });
  } catch (e) {
    // ignore
  }

  return complexity;
}

export function calculateComplexity(functions: FunctionInfo[]): ComplexityScore[] {
  return functions
    .filter((f) => f.complexity > 5)
    .map((f) => ({
      file: f.file,
      element: f.name,
      line: f.line,
      score: f.complexity,
      reasons: [
        f.complexity > 10 ? 'High cyclomatic complexity' : '',
        f.lines > 30 ? `Long function (${f.lines} lines)` : '',
        f.parameters.length > 4 ? `Many parameters (${f.parameters.length})` : '',
      ].filter(Boolean),
    }))
    .sort((a, b) => b.score - a.score);
}
