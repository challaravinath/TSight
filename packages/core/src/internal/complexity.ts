import { ts } from 'ts-morph';
import type { FunctionInfo, FunctionKind, ComplexityScore, ParameterInfo } from '../types.js';

/**
 * Cyclomatic complexity, McCabe style: 1 + one for each decision point.
 *
 * Decision points: if, ?:, for, for-in, for-of, while, do-while, each
 * `case` (not `default`), catch, and the short-circuit operators &&, ||, ??
 * and their assignment forms (&&=, ||=, ??=).
 *
 * Counting stops at the boundary of another unit (see FunctionKind in
 * types.ts), so a named helper inside a function is scored on its own.
 * Anonymous inline functions are counted as part of the unit around them.
 */
export function cyclomaticComplexity(unit: ts.Node): number {
  let score = 1;
  const visit = (node: ts.Node): void => {
    if (node !== unit && isUnit(node)) return;
    switch (node.kind) {
      case ts.SyntaxKind.IfStatement:
      case ts.SyntaxKind.ConditionalExpression:
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.CaseClause:
      case ts.SyntaxKind.CatchClause:
        score++;
        break;
      case ts.SyntaxKind.BinaryExpression: {
        const op = (node as ts.BinaryExpression).operatorToken.kind;
        if (
          op === ts.SyntaxKind.AmpersandAmpersandToken ||
          op === ts.SyntaxKind.BarBarToken ||
          op === ts.SyntaxKind.QuestionQuestionToken ||
          op === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
          op === ts.SyntaxKind.BarBarEqualsToken ||
          op === ts.SyntaxKind.QuestionQuestionEqualsToken
        ) {
          score++;
        }
        break;
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(unit, visit);
  return score;
}

const unitCache = new WeakMap<ts.Node, boolean>();

/** Is this node a unit that gets its own score? */
export function isUnit(node: ts.Node): boolean {
  let v = unitCache.get(node);
  if (v === undefined) {
    v = computeIsUnit(node);
    unitCache.set(node, v);
  }
  return v;
}

function computeIsUnit(node: ts.Node): boolean {
  switch (node.kind) {
    case ts.SyntaxKind.FunctionDeclaration:
    case ts.SyntaxKind.MethodDeclaration:
    case ts.SyntaxKind.Constructor:
    case ts.SyntaxKind.GetAccessor:
    case ts.SyntaxKind.SetAccessor:
      return (node as ts.FunctionLikeDeclaration).body !== undefined;
    case ts.SyntaxKind.ArrowFunction:
    case ts.SyntaxKind.FunctionExpression:
      return unitNameForExpression(node) !== null;
    default:
      return false;
  }
}

/** A function expression is a unit when its parent gives it a name. */
function unitNameForExpression(node: ts.Node): { name: string; owner?: string } | null {
  let parent = node.parent;
  // Allow wrappers such as `const A = (x) => ...` written as `(…) as T` or `<T>(…)`.
  while (
    parent &&
    (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent))
  ) {
    parent = parent.parent;
  }
  if (!parent) return null;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return { name: parent.name.text };
  }
  if (ts.isPropertyAssignment(parent) && propertyNameText(parent.name)) {
    return { name: propertyNameText(parent.name)!, owner: objectOwnerName(parent.parent) };
  }
  if (ts.isPropertyDeclaration(parent) && propertyNameText(parent.name)) {
    return { name: propertyNameText(parent.name)!, owner: className(parent.parent) };
  }
  if (ts.isExportAssignment(parent)) {
    return { name: 'default' };
  }
  // A function passed inline is part of the unit around it. At the top
  // level of a file there is none (forwardRef(...), app.get('/', ...)), so
  // it is scored on its own, named after where it ends up.
  if (!hasEnclosingUnit(node)) return { name: topLevelName(node) };
  return null;
}

function hasEnclosingUnit(node: ts.Node): boolean {
  for (let p = node.parent; p && !ts.isSourceFile(p); p = p.parent) {
    if (isUnit(p)) return true;
  }
  return false;
}

function topLevelName(node: ts.Node): string {
  for (let p = node.parent; p && !ts.isSourceFile(p); p = p.parent) {
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    if (ts.isExportAssignment(p)) return 'default';
    if (ts.isPropertyAssignment(p) && propertyNameText(p.name)) return propertyNameText(p.name)!;
  }
  if (ts.isFunctionExpression(node) && node.name) return node.name.text;
  const call = node.parent && ts.isCallExpression(node.parent) ? node.parent : undefined;
  if (call) {
    const callee = call.expression.getText().replace(/\s+/g, '');
    return `${callee.length > 40 ? callee.slice(0, 40) + '…' : callee} callback`;
  }
  return '(anonymous)';
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isPrivateIdentifier(name)) {
    return name.text;
  }
  return null;
}

function className(node: ts.Node | undefined): string {
  if (node && (ts.isClassDeclaration(node) || ts.isClassExpression(node))) {
    if (node.name) return node.name.text;
    if (ts.isClassExpression(node) && node.parent && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
      return node.parent.name.text;
    }
    return 'default';
  }
  return '(anonymous)';
}

function objectOwnerName(obj: ts.Node | undefined): string | undefined {
  const parent = obj?.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  return undefined;
}

export interface UnitRecord {
  info: FunctionInfo;
  node: ts.FunctionLikeDeclaration;
}

/**
 * Collect every unit in a file with its complexity, position and signature.
 * `exportedNames` is the set of names the file exports, used to mark
 * top-level functions as exported.
 */
export function collectUnits(sf: ts.SourceFile, relPath: string, exportedNames: Set<string>): UnitRecord[] {
  const out: UnitRecord[] = [];
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;

  const visit = (node: ts.Node): void => {
    if (isUnit(node)) {
      const fn = node as ts.FunctionLikeDeclaration;
      const described = describeUnit(fn);
      const startLine = lineOf(fn.getStart(sf));
      const endLine = lineOf(fn.getEnd());
      const exported =
        (described.kind === 'function' || described.kind === 'arrow') &&
        !described.className &&
        isTopLevel(fn) &&
        exportedNames.has(described.baseName);

      out.push({
        node: fn,
        info: {
          id: `${relPath}:${described.name}:${startLine}`,
          name: described.name,
          type: 'function',
          kind: described.kind,
          className: described.className,
          file: relPath,
          line: startLine,
          endLine,
          exported,
          parameters: fn.parameters.map((p) => parameterInfo(p, sf)),
          returnType: fn.type ? fn.type.getText(sf) : 'inferred',
          async: hasModifier(fn, ts.SyntaxKind.AsyncKeyword),
          complexity: cyclomaticComplexity(fn),
          lines: endLine - startLine + 1,
        },
      });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
}

function describeUnit(fn: ts.FunctionLikeDeclaration): {
  name: string;
  baseName: string;
  kind: FunctionKind;
  className?: string;
} {
  if (ts.isFunctionDeclaration(fn)) {
    const name = fn.name ? fn.name.text : 'default';
    return { name, baseName: name, kind: 'function' };
  }
  if (ts.isConstructorDeclaration(fn)) {
    const owner = className(fn.parent);
    return { name: `${owner}.constructor`, baseName: 'constructor', kind: 'constructor', className: owner };
  }
  if (ts.isMethodDeclaration(fn) || ts.isGetAccessorDeclaration(fn) || ts.isSetAccessorDeclaration(fn)) {
    const prop = propertyNameText(fn.name) ?? '[computed]';
    const kind: FunctionKind = ts.isGetAccessorDeclaration(fn) ? 'getter' : ts.isSetAccessorDeclaration(fn) ? 'setter' : 'method';
    if (ts.isClassLike(fn.parent)) {
      const owner = className(fn.parent);
      return { name: `${owner}.${prop}`, baseName: prop, kind, className: owner };
    }
    const owner = objectOwnerName(fn.parent);
    return { name: owner ? `${owner}.${prop}` : prop, baseName: prop, kind };
  }
  const named = unitNameForExpression(fn) ?? { name: '(anonymous)' };
  const isClassField = fn.parent && ts.isPropertyDeclaration(fn.parent);
  return {
    name: named.owner ? `${named.owner}.${named.name}` : named.name,
    baseName: named.name,
    kind: isClassField ? 'method' : 'arrow',
    className: isClassField ? named.owner : undefined,
  };
}

function isTopLevel(fn: ts.Node): boolean {
  let p = fn.parent;
  while (p && !ts.isSourceFile(p)) {
    if (
      ts.isFunctionLike(p) ||
      ts.isClassLike(p) ||
      ts.isBlock(p) ||
      ts.isObjectLiteralExpression(p) ||
      ts.isModuleBlock(p)
    ) {
      return false;
    }
    p = p.parent;
  }
  return true;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods?.some((m) => m.kind === kind);
}

function parameterInfo(p: ts.ParameterDeclaration, sf: ts.SourceFile): ParameterInfo {
  return {
    name: p.name.getText(sf),
    type: p.type ? p.type.getText(sf) : 'inferred',
    optional: !!p.questionToken || !!p.initializer,
    defaultValue: p.initializer?.getText(sf),
  };
}

/** Units scoring above 5, worst first, with the facts behind the score. */
export function calculateComplexity(functions: FunctionInfo[]): ComplexityScore[] {
  return functions
    .filter((f) => f.complexity > 5)
    .map((f) => ({
      file: f.file,
      element: f.name,
      line: f.line,
      score: f.complexity,
      reasons: [
        f.complexity > 10 ? `Cyclomatic complexity ${f.complexity}` : '',
        f.lines > 30 ? `${f.lines} lines long` : '',
        f.parameters.length > 4 ? `${f.parameters.length} parameters` : '',
      ].filter(Boolean),
    }))
    .sort((a, b) => b.score - a.score);
}
