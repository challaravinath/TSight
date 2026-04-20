import { SourceFile, Node } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs';
import {
  FileInfo,
  FolderInfo,
  ClassInfo,
  FunctionInfo,
  InterfaceInfo,
  ImportInfo,
} from '../types.js';
import { toRelative } from './paths.js';
import { extractParameter, getVisibility } from './syntax-helpers.js';
import { calculateFunctionComplexity } from './complexity.js';

export function extractFiles(rootPath: string, sourceFiles: SourceFile[]): FileInfo[] {
  return sourceFiles.map((sf) => {
    const filePath = sf.getFilePath();
    const relativePath = toRelative(rootPath, filePath);

    return {
      path: relativePath,
      name: path.basename(filePath),
      extension: path.extname(filePath),
      folder: path.dirname(relativePath),
      lines: sf.getEndLineNumber(),
      size: sf.getFullText().length,
    };
  });
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
        folderMap.set(currentPath, {
          path: currentPath,
          name: part,
          fileCount: 0,
          totalLines: 0,
          children: [],
        });
      }

      if (parentPath && folderMap.has(parentPath)) {
        const parent = folderMap.get(parentPath)!;
        if (!parent.children.includes(part)) {
          parent.children.push(part);
        }
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

export function extractClasses(rootPath: string, sourceFiles: SourceFile[]): ClassInfo[] {
  const classes: ClassInfo[] = [];

  for (const sf of sourceFiles) {
    const relativePath = toRelative(rootPath, sf.getFilePath());

    for (const cls of sf.getClasses()) {
      const name = cls.getName();
      if (!name) continue;

      classes.push({
        id: `${relativePath}:${name}`,
        name,
        type: 'class',
        file: relativePath,
        line: cls.getStartLineNumber(),
        endLine: cls.getEndLineNumber(),
        exported: cls.isExported(),
        methods: cls.getMethods().map((m) => ({
          name: m.getName(),
          parameters: m.getParameters().map((p) => extractParameter(p)),
          returnType: m.getReturnType().getText(),
          visibility: getVisibility(m),
          async: m.isAsync(),
          static: m.isStatic(),
          line: m.getStartLineNumber(),
        })),
        properties: cls.getProperties().map((p) => ({
          name: p.getName(),
          type: p.getType().getText(),
          optional: p.hasQuestionToken(),
          visibility: getVisibility(p),
        })),
        extends: cls.getExtends()?.getText(),
        implements: cls.getImplements().map((i) => i.getText()),
        decorators: cls.getDecorators().map((d) => d.getName()),
      });
    }
  }

  return classes;
}

export function extractFunctions(
  rootPath: string,
  sourceFiles: SourceFile[],
): FunctionInfo[] {
  const functions: FunctionInfo[] = [];

  for (const sf of sourceFiles) {
    const relativePath = toRelative(rootPath, sf.getFilePath());

    // Top-level functions
    for (const func of sf.getFunctions()) {
      const name = func.getName();
      if (!name) continue;

      functions.push(createFunctionInfo(func, name, relativePath));
    }

    // Arrow functions assigned to variables (React components)
    for (const varDecl of sf.getVariableDeclarations()) {
      const init = varDecl.getInitializer();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
        const name = varDecl.getName();
        functions.push(createFunctionInfo(init, name, relativePath, varDecl.isExported()));
      }
    }
  }

  return functions;
}

function createFunctionInfo(
  func: any,
  name: string,
  file: string,
  exported?: boolean,
): FunctionInfo {
  const body = func.getBody?.();
  const lines = body
    ? (body.getEndLineNumber?.() || 0) - (body.getStartLineNumber?.() || 0) + 1
    : 1;

  return {
    id: `${file}:${name}`,
    name,
    type: 'function',
    file,
    line: func.getStartLineNumber?.() || 1,
    endLine: func.getEndLineNumber?.() || 1,
    exported: exported ?? func.isExported?.() ?? false,
    parameters: (func.getParameters?.() || []).map((p: any) => extractParameter(p)),
    returnType: func.getReturnType?.()?.getText?.() || 'unknown',
    async: func.isAsync?.() ?? false,
    complexity: calculateFunctionComplexity(func),
    lines,
  };
}

export function extractInterfaces(
  rootPath: string,
  sourceFiles: SourceFile[],
): InterfaceInfo[] {
  const interfaces: InterfaceInfo[] = [];

  for (const sf of sourceFiles) {
    const relativePath = toRelative(rootPath, sf.getFilePath());

    for (const iface of sf.getInterfaces()) {
      const name = iface.getName();

      interfaces.push({
        id: `${relativePath}:${name}`,
        name,
        type: 'interface',
        file: relativePath,
        line: iface.getStartLineNumber(),
        endLine: iface.getEndLineNumber(),
        exported: iface.isExported(),
        properties: iface.getProperties().map((p) => ({
          name: p.getName(),
          type: p.getType().getText(),
          optional: p.hasQuestionToken(),
        })),
        extends: iface.getExtends().map((e) => e.getText()),
      });
    }
  }

  return interfaces;
}

export function extractImports(rootPath: string, sourceFiles: SourceFile[]): ImportInfo[] {
  const imports: ImportInfo[] = [];

  for (const sf of sourceFiles) {
    const fromPath = toRelative(rootPath, sf.getFilePath());

    for (const imp of sf.getImportDeclarations()) {
      const moduleSpec = imp.getModuleSpecifierValue();
      const isExternal = !moduleSpec.startsWith('.') && !moduleSpec.startsWith('/');

      let toPath = moduleSpec;
      if (!isExternal) {
        // Resolve relative import
        const resolved = path.resolve(path.dirname(sf.getFilePath()), moduleSpec);
        toPath = toRelative(rootPath, resolved);
        // Try to add extension if missing
        if (!toPath.match(/\.(ts|tsx|js|jsx)$/)) {
          for (const ext of ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']) {
            if (fs.existsSync(path.join(rootPath, toPath + ext))) {
              toPath = toPath + ext;
              break;
            }
          }
        }
      }

      const namedImports = imp.getNamedImports().map((n) => n.getName());
      const defaultImport = imp.getDefaultImport()?.getText();
      const allImports = defaultImport ? [defaultImport, ...namedImports] : namedImports;

      imports.push({
        from: fromPath,
        to: toPath,
        imports: allImports,
        isExternal,
        line: imp.getStartLineNumber(),
      });
    }
  }

  return imports;
}
