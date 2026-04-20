import { SourceFile, Node, SyntaxKind } from 'ts-morph';
import {
  FunctionInfo,
  StructuralSignature,
  StructuralTwin,
  SimilarityCriterion,
} from '../types.js';
import { toRelative } from './paths.js';

/**
 * Find functions that are structurally similar.
 * We compare discrete, verifiable criteria — no fuzzy scores.
 */
export function findStructuralTwins(
  rootPath: string,
  sourceFiles: SourceFile[],
  _functions: FunctionInfo[],
): StructuralTwin[] {
  const twins: StructuralTwin[] = [];

  // Build structural signatures for all meaningful functions
  const signatures: StructuralSignature[] = [];

  for (const sf of sourceFiles) {
    const relativePath = toRelative(rootPath, sf.getFilePath());

    // Process top-level functions
    for (const func of sf.getFunctions()) {
      const name = func.getName();
      if (!name) continue;

      const sig = extractStructuralSignature(func, name, relativePath);
      // Only consider functions with meaningful body (at least 3 statements)
      if (sig && sig.statementCount >= 3) {
        signatures.push(sig);
      }
    }

    // Process arrow functions assigned to variables
    for (const varDecl of sf.getVariableDeclarations()) {
      const init = varDecl.getInitializer();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
        const name = varDecl.getName();
        const sig = extractStructuralSignature(init, name, relativePath);
        if (sig && sig.statementCount >= 3) {
          signatures.push(sig);
        }
      }
    }
  }

  // O(n²) but filtered to meaningful functions; cap to keep memory bounded
  const maxSignatures = Math.min(signatures.length, 200);

  if (signatures.length < 2) {
    return [];
  }

  const signaturesLimited = signatures.slice(0, maxSignatures);

  for (let i = 0; i < signaturesLimited.length; i++) {
    for (let j = i + 1; j < signaturesLimited.length; j++) {
      const sigA = signaturesLimited[i];
      const sigB = signaturesLimited[j];

      // Same-file helpers are expected to be similar — skip
      if (sigA.file === sigB.file) continue;

      // Cheap pre-check before the per-criterion comparison
      if (sigA.paramCount !== sigB.paramCount || sigA.isAsync !== sigB.isAsync) {
        continue;
      }

      const comparison = compareSignatures(sigA, sigB);

      if (comparison.matchedCount >= 6) {
        twins.push(comparison);
      }

      if (twins.length >= 30) break;
    }
    if (twins.length >= 30) break;
  }

  twins.sort((a, b) => b.matchedCount - a.matchedCount);

  return twins.slice(0, 20);
}

/**
 * Extract a structural signature from a function's AST.
 * Everything here is factual — directly from parsing.
 */
function extractStructuralSignature(
  func: any,
  name: string,
  file: string,
): StructuralSignature | null {
  try {
    const body = func.getBody?.();
    if (!body) return null;

    const params = func.getParameters?.() || [];
    const paramTypes = params.map((p: any) =>
      simplifyType(p.getType?.()?.getText?.() || 'unknown'),
    );

    const returnType = simplifyType(func.getReturnType?.()?.getText?.() || 'unknown');

    let statementCount = 0;
    let hasLoop = false;
    let hasTryCatch = false;
    let hasConditional = false;
    const controlFlowParts: string[] = [];
    const patterns: string[] = [];

    body.forEachDescendant?.((node: Node) => {
      const kind = node.getKind();

      if (
        kind === SyntaxKind.ExpressionStatement ||
        kind === SyntaxKind.VariableStatement ||
        kind === SyntaxKind.ReturnStatement ||
        kind === SyntaxKind.ThrowStatement
      ) {
        statementCount++;
      }

      if (kind === SyntaxKind.IfStatement) {
        hasConditional = true;
        if (!controlFlowParts.includes('if')) controlFlowParts.push('if');

        // Guard clause = if-then with early return/throw
        const ifNode = node as any;
        const thenBlock = ifNode.getThenStatement?.()?.getText?.() || '';
        if (thenBlock.includes('return') || thenBlock.includes('throw')) {
          if (!patterns.includes('guard-clause')) patterns.push('guard-clause');
        }
      }

      if (
        kind === SyntaxKind.ForStatement ||
        kind === SyntaxKind.ForInStatement ||
        kind === SyntaxKind.ForOfStatement ||
        kind === SyntaxKind.WhileStatement
      ) {
        hasLoop = true;
        if (!controlFlowParts.includes('loop')) controlFlowParts.push('loop');
      }

      if (kind === SyntaxKind.TryStatement) {
        hasTryCatch = true;
        if (!controlFlowParts.includes('try')) controlFlowParts.push('try');
      }

      if (kind === SyntaxKind.CatchClause) {
        if (!controlFlowParts.includes('catch')) controlFlowParts.push('catch');
      }

      if (kind === SyntaxKind.ReturnStatement) {
        if (!controlFlowParts.includes('return')) controlFlowParts.push('return');
      }

      if (kind === SyntaxKind.AwaitExpression) {
        if (!patterns.includes('await-call')) patterns.push('await-call');
      }

      if (kind === SyntaxKind.CallExpression) {
        const callText = node.getText?.() || '';
        if (
          callText.includes('.get(') ||
          callText.includes('.post(') ||
          callText.includes('.put(') ||
          callText.includes('.delete(') ||
          callText.includes('fetch(')
        ) {
          if (!patterns.includes('api-call')) patterns.push('api-call');
        }
        if (callText.includes('log') || callText.includes('console.')) {
          if (!patterns.includes('logging')) patterns.push('logging');
        }
      }

      if (kind === SyntaxKind.ThrowStatement) {
        if (!patterns.includes('error-throw')) patterns.push('error-throw');
      }
    });

    return {
      file,
      name,
      line: func.getStartLineNumber?.() || 1,
      paramCount: params.length,
      paramTypes,
      returnType,
      isAsync: func.isAsync?.() ?? false,
      statementCount,
      controlFlowPattern: controlFlowParts.join('-') || 'linear',
      hasLoop,
      hasTryCatch,
      hasConditional,
      patterns,
    };
  } catch (e) {
    return null;
  }
}

/**
 * Map TypeScript types to a coarse category for comparison.
 * Exact types aren't needed — just structural categories.
 */
function simplifyType(type: string): string {
  const t = type.toLowerCase();
  if (t === 'void' || t === 'undefined') return 'void';
  if (t === 'string') return 'string';
  if (t === 'number' || t === 'bigint') return 'number';
  if (t === 'boolean') return 'boolean';
  if (t.startsWith('promise')) return 'Promise';
  if (t.includes('[]') || t.startsWith('array')) return 'array';
  if (t === 'any' || t === 'unknown') return 'any';
  if (t === 'null' || t === 'never') return t;
  return 'object';
}

/**
 * Compare two structural signatures and produce criteria breakdown.
 * Every criterion is explicit and verifiable.
 */
function compareSignatures(a: StructuralSignature, b: StructuralSignature): StructuralTwin {
  const criteria: SimilarityCriterion[] = [];
  let matchedCount = 0;

  // 1. Parameter count
  const paramCountMatch = a.paramCount === b.paramCount;
  criteria.push({
    name: 'Parameter count',
    description: paramCountMatch
      ? `Both take ${a.paramCount} parameter(s)`
      : `Different parameter counts`,
    valueA: String(a.paramCount),
    valueB: String(b.paramCount),
    matched: paramCountMatch,
  });
  if (paramCountMatch) matchedCount++;

  // 2. Parameter types (simplified)
  const paramTypesMatch =
    a.paramTypes.length === b.paramTypes.length &&
    a.paramTypes.every((t, i) => t === b.paramTypes[i]);
  criteria.push({
    name: 'Parameter types',
    description: paramTypesMatch ? `Same parameter type pattern` : `Different parameter types`,
    valueA: a.paramTypes.join(', ') || '(none)',
    valueB: b.paramTypes.join(', ') || '(none)',
    matched: paramTypesMatch,
  });
  if (paramTypesMatch) matchedCount++;

  // 3. Return type
  const returnMatch = a.returnType === b.returnType;
  criteria.push({
    name: 'Return type',
    description: returnMatch ? `Both return ${a.returnType}` : `Different return types`,
    valueA: a.returnType,
    valueB: b.returnType,
    matched: returnMatch,
  });
  if (returnMatch) matchedCount++;

  // 4. Async/sync
  const asyncMatch = a.isAsync === b.isAsync;
  criteria.push({
    name: 'Async pattern',
    description: asyncMatch
      ? a.isAsync
        ? 'Both async'
        : 'Both sync'
      : 'Different async patterns',
    valueA: a.isAsync ? 'async' : 'sync',
    valueB: b.isAsync ? 'async' : 'sync',
    matched: asyncMatch,
  });
  if (asyncMatch) matchedCount++;

  // 5. Statement count (within ±3)
  const stmtDiff = Math.abs(a.statementCount - b.statementCount);
  const stmtMatch = stmtDiff <= 3;
  criteria.push({
    name: 'Body size',
    description: stmtMatch
      ? `Similar size (~${Math.round((a.statementCount + b.statementCount) / 2)} statements)`
      : `Different sizes`,
    valueA: `${a.statementCount} statements`,
    valueB: `${b.statementCount} statements`,
    matched: stmtMatch,
  });
  if (stmtMatch) matchedCount++;

  // 6. Control flow pattern
  const cfMatch = a.controlFlowPattern === b.controlFlowPattern;
  criteria.push({
    name: 'Control flow',
    description: cfMatch ? `Same flow: ${a.controlFlowPattern}` : `Different control flow`,
    valueA: a.controlFlowPattern,
    valueB: b.controlFlowPattern,
    matched: cfMatch,
  });
  if (cfMatch) matchedCount++;

  // 7. Has try/catch
  const tryMatch = a.hasTryCatch === b.hasTryCatch;
  criteria.push({
    name: 'Error handling',
    description: tryMatch
      ? a.hasTryCatch
        ? 'Both have try/catch'
        : 'Neither has try/catch'
      : 'Different error handling',
    valueA: a.hasTryCatch ? 'has try/catch' : 'no try/catch',
    valueB: b.hasTryCatch ? 'has try/catch' : 'no try/catch',
    matched: tryMatch,
  });
  if (tryMatch) matchedCount++;

  // 8. Code patterns overlap
  const commonPatterns = a.patterns.filter((p) => b.patterns.includes(p));
  const patternOverlap = commonPatterns.length >= Math.min(a.patterns.length, b.patterns.length, 1);
  criteria.push({
    name: 'Code patterns',
    description:
      commonPatterns.length > 0 ? `Shared: ${commonPatterns.join(', ')}` : 'No common patterns',
    valueA: a.patterns.join(', ') || '(none detected)',
    valueB: b.patterns.join(', ') || '(none detected)',
    matched: patternOverlap,
  });
  if (patternOverlap) matchedCount++;

  let verdict: 'structural-twin' | 'similar-shape' | 'worth-reviewing';
  let summary: string;

  if (matchedCount >= 7) {
    verdict = 'structural-twin';
    summary = 'Nearly identical structure — strong candidate for consolidation';
  } else if (matchedCount >= 6) {
    verdict = 'similar-shape';
    summary = 'Very similar structure — worth reviewing for potential reuse';
  } else {
    verdict = 'worth-reviewing';
    summary = 'Some structural similarities — may benefit from shared abstraction';
  }

  return {
    functionA: { file: a.file, name: a.name, line: a.line },
    functionB: { file: b.file, name: b.name, line: b.line },
    criteria,
    matchedCount,
    totalCount: criteria.length,
    verdict,
    summary,
  };
}
