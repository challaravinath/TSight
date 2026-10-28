import { SourceFile, Node, SyntaxKind, ts } from 'ts-morph';
import * as path from 'path';
import type {
  FileInfo,
  FolderInfo,
  ClassInfo,
  InterfaceInfo,
  ImportInfo,
  ImportSyntax,
  ParameterInfo,
  FileRole,
} from '../types.js';
import { ModuleResolver } from './resolve.js';
import { toPosix } from './discovery.js';

export interface Parsed {
  sf: SourceFile;
  rel: string;
  role: FileRole;
}

export function extractFiles(parsed: Parsed[]): FileInfo[] {
  return parsed.map(({ sf, rel, role }) => {
    const text = sf.getFullText();
    const folder = path.posix.dirname(rel);
    return {
      path: rel,
      name: path.posix.basename(rel),
      extension: path.posix.extname(rel),
      folder: folder === '.' ? '' : folder,
      lines: countLines(text),
      size: text.length,
      role,
    };
  });
}

/** Lines as an editor numbers them: a final newline does not add an empty line. */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  const breaks = text.match(/\r\n|\r|\n/g)?.length ?? 0;
  return /[\r\n]$/.test(text) ? breaks : breaks + 1;
}

export function extractFolders(files: FileInfo[]): FolderInfo[] {
  const folderMap = new Map<string, FolderInfo>();

  for (const file of files) {
    const parts = file.folder.split('/').filter(Boolean);
    let currentPath = '';

    for (const part of parts) {
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!folderMap.has(currentPath)) {
        folderMap.set(currentPath, { path: currentPath, name: part, fileCount: 0, totalLines: 0, children: [] });
      }
      if (parentPath) {
        const parent = folderMap.get(parentPath)!;
        if (!parent.children.includes(part)) parent.children.push(part);
      }
    }

    if (file.folder && folderMap.has(file.folder)) {
      const folder = folderMap.get(file.folder)!;
      folder.fileCount++;
      folder.totalLines += file.lines;
    }
  }

  return Array.from(folderMap.values());
}

function annotation(node: Node, typeNode: Node | undefined): string {
  return typeNode ? typeNode.getText() : 'inferred';
}

function parameters(params: Node[]): ParameterInfo[] {
  return params.map((p) => {
    const param = p.asKindOrThrow(SyntaxKind.Parameter);
    return {
      name: param.getName(),
      type: annotation(param, param.getTypeNode()),
      optional: param.hasQuestionToken() || param.hasInitializer(),
      defaultValue: param.getInitializer()?.getText(),
    };
  });
}

function visibility(node: { hasModifier(kind: SyntaxKind): boolean }): 'public' | 'private' | 'protected' {
  if (node.hasModifier(SyntaxKind.PrivateKeyword)) return 'private';
  if (node.hasModifier(SyntaxKind.ProtectedKeyword)) return 'protected';
  return 'public';
}

export function extractClasses(parsed: Parsed[], exported: Map<string, Set<string>>): ClassInfo[] {
  const classes: ClassInfo[] = [];
  for (const { sf, rel } of parsed) {
    const names = exported.get(rel) ?? new Set<string>();
    for (const cls of sf.getClasses()) {
      const name = cls.getName() ?? 'default'; // only `export default class {}` has no name
      const isExported = names.has(name);
      classes.push({
        id: `${rel}:${name}`,
        name,
        type: 'class',
        file: rel,
        line: cls.getStartLineNumber(),
        endLine: cls.getEndLineNumber(),
        exported: isExported,
        methods: cls.getMethods().map((m) => ({
          name: m.getName(),
          parameters: parameters(m.getParameters()),
          returnType: annotation(m, m.getReturnTypeNode()),
          visibility: visibility(m),
          async: m.isAsync(),
          static: m.isStatic(),
          line: m.getStartLineNumber(),
        })),
        properties: cls.getProperties().map((p) => ({
          name: p.getName(),
          type: annotation(p, p.getTypeNode()),
          optional: p.hasQuestionToken(),
          visibility: visibility(p),
        })),
        extends: cls.getExtends()?.getText(),
        implements: cls.getImplements().map((i) => i.getText()),
        decorators: cls.getDecorators().map((d) => d.getName()),
      });
    }
  }
  return classes;
}

export function extractInterfaces(parsed: Parsed[], exported: Map<string, Set<string>>): InterfaceInfo[] {
  const interfaces: InterfaceInfo[] = [];
  for (const { sf, rel } of parsed) {
    const names = exported.get(rel) ?? new Set<string>();
    for (const iface of sf.getInterfaces()) {
      const name = iface.getName();
      interfaces.push({
        id: `${rel}:${name}`,
        name,
        type: 'interface',
        file: rel,
        line: iface.getStartLineNumber(),
        endLine: iface.getEndLineNumber(),
        exported: names.has(name),
        properties: iface.getProperties().map((p) => ({
          name: p.getName(),
          type: annotation(p, p.getTypeNode()),
          optional: p.hasQuestionToken(),
        })),
        extends: iface.getExtends().map((e) => e.getText()),
      });
    }
  }
  return interfaces;
}

/**
 * Names a file exports from its own declarations, with the line of each
 * declaration. Re-exports (`export ... from`) are left out: they belong to
 * the file that declares them. Read from the syntax tree only, so no type
 * checker (and no node_modules typings) is needed.
 *
 * exportedLocalNames also holds the local names behind each export, so
 * `export default function Foo` marks Foo as exported.
 */
export function extractExports(parsed: Parsed[]): {
  exportsByFile: Record<string, string[]>;
  exportLines: Record<string, Record<string, number>>;
  exportedLocalNames: Map<string, Set<string>>;
} {
  const exportsByFile: Record<string, string[]> = {};
  const exportLines: Record<string, Record<string, number>> = {};
  const exportedLocalNames = new Map<string, Set<string>>();

  for (const { sf: wrapped, rel } of parsed) {
    const sf = wrapped.compilerNode;
    const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    const lines: Record<string, number> = {};
    const locals = new Set<string>();
    const topLevel = new Map<string, number>(); // local declaration name -> line

    const bindingNames = (name: ts.BindingName): string[] => {
      if (ts.isIdentifier(name)) return [name.text];
      return name.elements.flatMap((el) => (ts.isOmittedExpression(el) ? [] : bindingNames(el.name)));
    };
    const declaredNames = (st: ts.Statement): string[] => {
      if (ts.isVariableStatement(st)) return st.declarationList.declarations.flatMap((d) => bindingNames(d.name));
      if (
        (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) ||
          ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st)) &&
        st.name && ts.isIdentifier(st.name)
      ) {
        return [st.name.text];
      }
      return [];
    };
    const mods = (st: ts.Statement) => (ts.canHaveModifiers(st) ? ts.getModifiers(st) ?? [] : []);

    for (const st of sf.statements) for (const n of declaredNames(st)) if (!topLevel.has(n)) topLevel.set(n, lineOf(st));

    for (const st of sf.statements) {
      const m = mods(st);
      const isExport = m.some((x) => x.kind === ts.SyntaxKind.ExportKeyword);
      const isDefault = m.some((x) => x.kind === ts.SyntaxKind.DefaultKeyword);
      if (ts.isModuleDeclaration(st) && st.flags & ts.NodeFlags.GlobalAugmentation) continue;

      if (isExport) {
        const names = declaredNames(st);
        if (isDefault) {
          lines['default'] = lineOf(st);
          names.forEach((n) => locals.add(n));
        } else {
          for (const n of names) {
            lines[n] = lineOf(st);
            locals.add(n);
          }
        }
      } else if (ts.isExportAssignment(st)) {
        lines['default'] = lineOf(st);
        if (ts.isIdentifier(st.expression)) locals.add(st.expression.text);
      } else if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) {
          const local = (el.propertyName ?? el.name).text;
          lines[el.name.text] = topLevel.get(local) ?? lineOf(st);
          locals.add(local);
        }
      }
    }

    for (const n of Object.keys(lines)) locals.add(n);
    exportsByFile[rel] = Object.keys(lines).sort();
    exportLines[rel] = lines;
    exportedLocalNames.set(rel, locals);
  }
  return { exportsByFile, exportLines, exportedLocalNames };
}

interface RawImport {
  specifier: string;
  syntax: ImportSyntax;
  typeOnly: boolean;
  names: string[];
  line: number;
}

function collectRawImports(sf: SourceFile): RawImport[] {
  const out: RawImport[] = [];

  for (const imp of sf.getImportDeclarations()) {
    const names: string[] = [];
    if (imp.getDefaultImport()) names.push('default');
    if (imp.getNamespaceImport()) names.push('*');
    for (const n of imp.getNamedImports()) names.push(n.getName());
    out.push({
      specifier: imp.getModuleSpecifierValue(),
      syntax: 'import',
      typeOnly: imp.isTypeOnly() || (names.length > 0 && imp.getNamedImports().length === names.length && imp.getNamedImports().every((n) => n.isTypeOnly())),
      names,
      line: imp.getStartLineNumber(),
    });
  }

  for (const exp of sf.getExportDeclarations()) {
    const spec = exp.getModuleSpecifierValue();
    if (!spec) continue;
    const namedNodes = exp.getNamedExports();
    const named = namedNodes.map((n) => n.getName());
    out.push({
      specifier: spec,
      syntax: 'export',
      typeOnly: exp.isTypeOnly() || (namedNodes.length > 0 && namedNodes.every((n) => n.isTypeOnly())),
      names: named.length > 0 ? named : ['*'],
      line: exp.getStartLineNumber(),
    });
  }

  // import x = require('y')
  for (const ie of sf.getDescendantsOfKind(SyntaxKind.ImportEqualsDeclaration)) {
    const ref = ie.getModuleReference();
    if (Node.isExternalModuleReference(ref)) {
      const expr = ref.getExpression();
      if (expr && Node.isStringLiteral(expr)) {
        out.push({ specifier: expr.getLiteralValue(), syntax: 'require', typeOnly: ie.isTypeOnly(), names: ['*'], line: ie.getStartLineNumber() });
      }
    }
  }

  // import('x') and require('x') with a literal argument. Walk the raw AST: it is much faster.
  const raw = sf.compilerNode;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length >= 1) {
      const arg = node.arguments[0];
      const literal = ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg) ? arg.text : null;
      if (literal !== null) {
        const isDynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
        const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
        if (isDynamic || isRequire) {
          out.push({
            specifier: literal,
            syntax: isDynamic ? 'dynamic' : 'require',
            typeOnly: false,
            names: ['*'],
            line: raw.getLineAndCharacterOfPosition(node.getStart(raw)).line + 1,
          });
        }
      }
    }
    // import('x') inside a type position, e.g. typeof import('./a')
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      out.push({
        specifier: node.argument.literal.text,
        syntax: 'dynamic',
        typeOnly: true,
        names: ['*'],
        line: raw.getLineAndCharacterOfPosition(node.getStart(raw)).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(raw, visit);

  return out;
}

export function extractImports(root: string, parsed: Parsed[], resolver: ModuleResolver): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const rootAbs = path.resolve(root);

  for (const { sf, rel } of parsed) {
    const fromAbs = path.resolve(sf.getFilePath());
    for (const raw of collectRawImports(sf)) {
      const res = resolver.resolve(raw.specifier, fromAbs);
      const to =
        res.target && (res.kind === 'internal' || res.kind === 'excluded')
          ? toPosix(path.relative(rootAbs, res.target))
          : raw.specifier;
      imports.push({
        from: rel,
        to,
        specifier: raw.specifier,
        kind: res.kind,
        syntax: raw.syntax,
        typeOnly: raw.typeOnly,
        imports: raw.names,
        isExternal: res.kind === 'external',
        line: raw.line,
        resolvedBy: res.resolvedBy,
      });
    }
  }
  return imports;
}
