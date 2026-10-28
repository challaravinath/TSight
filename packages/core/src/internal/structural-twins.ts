import { ts } from 'ts-morph';
import * as crypto from 'crypto';
import type { StructuralTwin, SimilarityCriterion, StructuralTwinReport, FileRole } from '../types.js';
import type { UnitRecord } from './complexity.js';
import { isUnit } from './complexity.js';

/** Functions smaller than this many syntax nodes are skipped (one-line getters are often identical on purpose). */
export const MIN_TWIN_NODES = 80;
const MAX_RESULTS = 50;

interface Shape {
  unit: UnitRecord;
  hash: string; // syntax tree with names and literal values removed
  nodes: number;
  statements: number;
  names: string; // identifiers in order
  values: string; // literal values in order
}

/**
 * Structural twins: functions whose syntax trees are identical once
 * identifier names and literal values are ignored. This is clone
 * detection ("type 2" clones), so every reported pair can be checked by
 * reading the two functions side by side.
 *
 * Each pair says whether the names and the literal values also match:
 * both matching means the function was copied as is.
 */
export function findStructuralTwins(
  units: Array<UnitRecord & { sf: ts.SourceFile; role: FileRole }>,
): StructuralTwinReport {
  const groups = new Map<string, Shape[]>();
  let compared = 0;

  for (const u of units) {
    if (u.role !== 'source' || !u.node.body) continue;
    const shape = shapeOf(u, u.sf);
    if (shape.nodes < MIN_TWIN_NODES || shape.statements < 3) continue;
    compared++;
    if (!groups.has(shape.hash)) groups.set(shape.hash, []);
    groups.get(shape.hash)!.push(shape);
  }

  const twins: StructuralTwin[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    members.sort((a, b) => a.unit.info.file.localeCompare(b.unit.info.file) || a.unit.info.line - b.unit.info.line);
    const first = members[0];
    for (const other of members.slice(1)) twins.push(describePair(first, other, members.length));
  }

  twins.sort(
    (x, y) =>
      y.matchedCount - x.matchedCount ||
      x.functionA.file.localeCompare(y.functionA.file) ||
      x.functionA.line - y.functionA.line,
  );

  return { twins: twins.slice(0, MAX_RESULTS), functionsCompared: compared, pairsFound: twins.length };
}

function shapeOf(u: UnitRecord, sf: ts.SourceFile): Shape {
  const kinds: number[] = [];
  const names: string[] = [];
  const values: string[] = [];
  let statements = 0;

  const visit = (node: ts.Node): void => {
    // A named helper inside the function is its own unit; keep its place but not its body.
    if (node !== u.node && isUnit(node)) {
      kinds.push(-1);
      return;
    }
    kinds.push(node.kind);
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      names.push(node.text);
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNumericLiteral(node) ||
      ts.isBigIntLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isRegularExpressionLiteral(node) ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail ||
      node.kind === ts.SyntaxKind.JsxText
    ) {
      values.push(node.getText(sf));
    } else if (ts.isStatement(node) && !ts.isBlock(node)) {
      statements++;
    }
    ts.forEachChild(node, visit);
  };
  // Parameters and body, not the function's own name.
  u.node.parameters.forEach(visit);
  if (u.node.type) visit(u.node.type);
  if (u.node.body) visit(u.node.body);

  return {
    unit: u,
    hash: crypto.createHash('sha1').update(kinds.join(',')).digest('hex'),
    nodes: kinds.length,
    statements,
    names: names.join('\u0000'),
    values: values.join('\u0000'),
  };
}

function describePair(a: Shape, b: Shape, groupSize: number): StructuralTwin {
  const A = a.unit.info;
  const B = b.unit.info;
  const criteria: SimilarityCriterion[] = [
    {
      name: 'Syntax tree',
      description: `Identical once names and literal values are ignored (${a.nodes} syntax nodes)`,
      valueA: `${a.nodes} nodes`,
      valueB: `${b.nodes} nodes`,
      matched: true,
    },
    {
      name: 'Statements',
      description: `${a.statements} statements each`,
      valueA: String(a.statements),
      valueB: String(b.statements),
      matched: a.statements === b.statements,
    },
    {
      name: 'Parameters',
      description: `${A.parameters.length} each`,
      valueA: A.parameters.map((p) => p.name).join(', ') || '(none)',
      valueB: B.parameters.map((p) => p.name).join(', ') || '(none)',
      matched: A.parameters.length === B.parameters.length,
    },
    {
      name: 'Literal values',
      description: a.values === b.values ? 'Same strings and numbers' : 'Some strings or numbers differ',
      valueA: a.values === b.values ? 'same' : 'differs',
      valueB: a.values === b.values ? 'same' : 'differs',
      matched: a.values === b.values,
    },
    {
      name: 'Names',
      description: a.names === b.names ? 'Same variable and function names' : 'Some names differ',
      valueA: a.names === b.names ? 'same' : 'differs',
      valueB: a.names === b.names ? 'same' : 'differs',
      matched: a.names === b.names,
    },
  ];
  const matchedCount = criteria.filter((c) => c.matched).length;
  const exactCopy = a.names === b.names && a.values === b.values;
  const others = groupSize > 2 ? ` ${groupSize} functions share this shape.` : '';
  return {
    functionA: { file: A.file, name: A.name, line: A.line },
    functionB: { file: B.file, name: B.name, line: B.line },
    criteria,
    matchedCount,
    totalCount: criteria.length,
    verdict: exactCopy ? 'structural-twin' : a.values === b.values ? 'similar-shape' : 'worth-reviewing',
    summary:
      (exactCopy
        ? 'Same code: only the function name differs.'
        : a.values === b.values
          ? 'Same code with different names.'
          : 'Same structure with different names or values.') + others,
  };
}
