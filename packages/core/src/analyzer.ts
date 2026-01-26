/**
 * TSight Analyzer - The Brain
 * 
 * Analyzes TypeScript/React/PCF projects and builds a mental model.
 */

import { Project, SourceFile, SyntaxKind, Node, ScriptTarget, ModuleKind } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import {
  AnalysisResult,
  FileInfo,
  FolderInfo,
  ClassInfo,
  FunctionInfo,
  InterfaceInfo,
  MethodInfo,
  PropertyInfo,
  ParameterInfo,
  ImportInfo,
  Dependency,
  DependencyGraph,
  CodeIssue,
  DuplicateGroup,
  ComplexityScore,
  LanguageBreakdown,
  PackageUsage,
  CodeStats,
  MentalModel,
  Layer,
  DataFlow,
  StructuralSignature,
  StructuralTwin,
  SimilarityCriterion,
} from './types.js';

export class Analyzer {
  private project: Project;
  private rootPath: string = '';
  
  constructor() {
    this.project = new Project({
      compilerOptions: {
        target: ScriptTarget.ESNext,
        module: ModuleKind.ESNext,
        jsx: 2, // React
        allowJs: true,
        skipLibCheck: true,
        noEmit: true,
      },
      skipAddingFilesFromTsConfig: true,
    });
  }

  /**
   * Main entry point - analyze a project
   */
  async analyze(projectPath: string): Promise<AnalysisResult> {
    const startTime = Date.now();
    this.rootPath = projectPath;
    
    console.log(`🔍 TSight analyzing: ${projectPath}`);
    
    // Find and add source files
    const sourceFiles = this.addSourceFiles(projectPath);
    console.log(`   Found ${sourceFiles.length} source files`);
    
    // Extract all information
    const files = this.extractFiles(sourceFiles);
    const folders = this.extractFolders(files);
    const languages = this.calculateLanguages(files);
    
    const classes = this.extractClasses(sourceFiles);
    const functions = this.extractFunctions(sourceFiles);
    const interfaces = this.extractInterfaces(sourceFiles);
    
    const imports = this.extractImports(sourceFiles);
    const dependencyGraph = this.buildDependencyGraph(imports);
    const externalPackages = this.extractExternalPackages(imports);
    
    // Find issues
    const issues: CodeIssue[] = [];
    const deadCode = this.findDeadCode(sourceFiles);
    const circularDeps = this.findCircularDependencies(dependencyGraph);
    const complexFunctions = this.findComplexFunctions(functions);
    issues.push(...deadCode, ...circularDeps, ...complexFunctions);
    
    // Find duplicates
    const duplicates = this.findDuplicates(sourceFiles, classes, functions, interfaces);
    
    // Find structural twins (honest similarity detection)
    // Simple approach: just find the top matches, no complex pagination needed
    let structuralTwins: StructuralTwin[] = [];
    try {
      structuralTwins = this.findStructuralTwins(sourceFiles, functions);
    } catch (e) {
      console.error('   ⚠ Structural twins detection failed:', e);
    }
    
    // Calculate complexity scores
    const complexity = this.calculateComplexity(functions);
    
    // Build mental model
    const mentalModel = this.buildMentalModel(folders, imports, classes, functions);
    
    // Calculate stats
    const stats = this.calculateStats(files, classes, functions, interfaces, issues, duplicates, complexity);
    
    const duration = Date.now() - startTime;
    console.log(`   ✓ Analysis complete in ${duration}ms`);
    
    return {
      analyzedAt: new Date(),
      duration,
      files,
      folders,
      languages,
      classes,
      functions,
      interfaces,
      imports,
      dependencyGraph,
      externalPackages,
      mentalModel,
      issues,
      duplicates,
      complexity,
      structuralTwins,
      stats,
    };
  }

  // ===========================================================================
  // FILE DISCOVERY
  // ===========================================================================

  private addSourceFiles(projectPath: string): SourceFile[] {
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    const excludePatterns = [
      'node_modules', 'dist', 'build', '.git', 'coverage',
      '__tests__', '__mocks__', '*.test.', '*.spec.', '.d.ts',
      'integration-tests', 'e2e'
    ];
    
    const files: string[] = [];
    this.walkDir(projectPath, files, extensions, excludePatterns);
    
    for (const file of files) {
      try {
        this.project.addSourceFileAtPath(file);
      } catch (e) {
        // Skip files that can't be parsed
      }
    }
    
    return this.project.getSourceFiles();
  }

  private walkDir(dir: string, files: string[], extensions: string[], exclude: string[]): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        // Check exclusions
        if (exclude.some(ex => entry.name.includes(ex) || fullPath.includes(ex))) {
          continue;
        }
        
        if (entry.isDirectory()) {
          this.walkDir(fullPath, files, extensions, exclude);
        } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    } catch (e) {
      // Skip inaccessible directories
    }
  }

  // ===========================================================================
  // EXTRACTION
  // ===========================================================================

  private extractFiles(sourceFiles: SourceFile[]): FileInfo[] {
    return sourceFiles.map(sf => {
      const filePath = sf.getFilePath();
      const relativePath = path.relative(this.rootPath, filePath).replace(/\\/g, '/');
      
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

  private extractFolders(files: FileInfo[]): FolderInfo[] {
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
        
        // Add as child to parent
        if (parentPath && folderMap.has(parentPath)) {
          const parent = folderMap.get(parentPath)!;
          if (!parent.children.includes(part)) {
            parent.children.push(part);
          }
        }
      }
      
      // Count file in its folder
      if (file.folder && folderMap.has(file.folder)) {
        const folder = folderMap.get(file.folder)!;
        folder.fileCount++;
        folder.totalLines += file.lines;
      }
    }
    
    return Array.from(folderMap.values());
  }

  private extractClasses(sourceFiles: SourceFile[]): ClassInfo[] {
    const classes: ClassInfo[] = [];
    
    for (const sf of sourceFiles) {
      const relativePath = path.relative(this.rootPath, sf.getFilePath()).replace(/\\/g, '/');
      
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
          methods: cls.getMethods().map(m => ({
            name: m.getName(),
            parameters: m.getParameters().map(p => this.extractParameter(p)),
            returnType: m.getReturnType().getText(),
            visibility: this.getVisibility(m),
            async: m.isAsync(),
            static: m.isStatic(),
            line: m.getStartLineNumber(),
          })),
          properties: cls.getProperties().map(p => ({
            name: p.getName(),
            type: p.getType().getText(),
            optional: p.hasQuestionToken(),
            visibility: this.getVisibility(p),
          })),
          extends: cls.getExtends()?.getText(),
          implements: cls.getImplements().map(i => i.getText()),
          decorators: cls.getDecorators().map(d => d.getName()),
        });
      }
    }
    
    return classes;
  }

  private extractFunctions(sourceFiles: SourceFile[]): FunctionInfo[] {
    const functions: FunctionInfo[] = [];
    
    for (const sf of sourceFiles) {
      const relativePath = path.relative(this.rootPath, sf.getFilePath()).replace(/\\/g, '/');
      
      // Top-level functions
      for (const func of sf.getFunctions()) {
        const name = func.getName();
        if (!name) continue;
        
        functions.push(this.createFunctionInfo(func, name, relativePath));
      }
      
      // Arrow functions assigned to variables (React components)
      for (const varDecl of sf.getVariableDeclarations()) {
        const init = varDecl.getInitializer();
        if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
          const name = varDecl.getName();
          functions.push(this.createFunctionInfo(init, name, relativePath, varDecl.isExported()));
        }
      }
    }
    
    return functions;
  }

  private createFunctionInfo(func: any, name: string, file: string, exported?: boolean): FunctionInfo {
    const body = func.getBody?.();
    const lines = body ? (body.getEndLineNumber?.() || 0) - (body.getStartLineNumber?.() || 0) + 1 : 1;
    
    return {
      id: `${file}:${name}`,
      name,
      type: 'function',
      file,
      line: func.getStartLineNumber?.() || 1,
      endLine: func.getEndLineNumber?.() || 1,
      exported: exported ?? func.isExported?.() ?? false,
      parameters: (func.getParameters?.() || []).map((p: any) => this.extractParameter(p)),
      returnType: func.getReturnType?.()?.getText?.() || 'unknown',
      async: func.isAsync?.() ?? false,
      complexity: this.calculateFunctionComplexity(func),
      lines,
    };
  }

  private extractInterfaces(sourceFiles: SourceFile[]): InterfaceInfo[] {
    const interfaces: InterfaceInfo[] = [];
    
    for (const sf of sourceFiles) {
      const relativePath = path.relative(this.rootPath, sf.getFilePath()).replace(/\\/g, '/');
      
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
          properties: iface.getProperties().map(p => ({
            name: p.getName(),
            type: p.getType().getText(),
            optional: p.hasQuestionToken(),
          })),
          extends: iface.getExtends().map(e => e.getText()),
        });
      }
    }
    
    return interfaces;
  }

  private extractImports(sourceFiles: SourceFile[]): ImportInfo[] {
    const imports: ImportInfo[] = [];
    
    for (const sf of sourceFiles) {
      const fromPath = path.relative(this.rootPath, sf.getFilePath()).replace(/\\/g, '/');
      
      for (const imp of sf.getImportDeclarations()) {
        const moduleSpec = imp.getModuleSpecifierValue();
        const isExternal = !moduleSpec.startsWith('.') && !moduleSpec.startsWith('/');
        
        let toPath = moduleSpec;
        if (!isExternal) {
          // Resolve relative import
          const resolved = path.resolve(path.dirname(sf.getFilePath()), moduleSpec);
          toPath = path.relative(this.rootPath, resolved).replace(/\\/g, '/');
          // Try to add extension if missing
          if (!toPath.match(/\.(ts|tsx|js|jsx)$/)) {
            for (const ext of ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']) {
              if (fs.existsSync(path.join(this.rootPath, toPath + ext))) {
                toPath = toPath + ext;
                break;
              }
            }
          }
        }
        
        const namedImports = imp.getNamedImports().map(n => n.getName());
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

  // ===========================================================================
  // DEPENDENCY GRAPH
  // ===========================================================================

  private buildDependencyGraph(imports: ImportInfo[]): DependencyGraph {
    const nodeSet = new Set<string>();
    const edgeMap = new Map<string, Dependency>();
    
    for (const imp of imports) {
      if (imp.isExternal) continue;
      
      nodeSet.add(imp.from);
      nodeSet.add(imp.to);
      
      const key = `${imp.from}->${imp.to}`;
      if (edgeMap.has(key)) {
        edgeMap.get(key)!.weight++;
      } else {
        edgeMap.set(key, {
          source: imp.from,
          target: imp.to,
          type: 'import',
          weight: 1,
        });
      }
    }
    
    const edges = Array.from(edgeMap.values());
    const circular = this.detectCycles(Array.from(nodeSet), edges);
    
    return {
      nodes: Array.from(nodeSet),
      edges,
      circular,
    };
  }

  private detectCycles(nodes: string[], edges: Dependency[]): string[][] {
    const cycles: string[][] = [];
    const adjacency = new Map<string, string[]>();
    
    for (const node of nodes) {
      adjacency.set(node, []);
    }
    for (const edge of edges) {
      adjacency.get(edge.source)?.push(edge.target);
    }
    
    const visited = new Set<string>();
    const recStack = new Set<string>();
    
    const dfs = (node: string, path: string[]): void => {
      visited.add(node);
      recStack.add(node);
      path.push(node);
      
      for (const neighbor of adjacency.get(node) || []) {
        if (!visited.has(neighbor)) {
          dfs(neighbor, [...path]);
        } else if (recStack.has(neighbor)) {
          const cycleStart = path.indexOf(neighbor);
          if (cycleStart !== -1) {
            cycles.push(path.slice(cycleStart));
          }
        }
      }
      
      recStack.delete(node);
    };
    
    for (const node of nodes) {
      if (!visited.has(node)) {
        dfs(node, []);
      }
    }
    
    return cycles;
  }

  private extractExternalPackages(imports: ImportInfo[]): PackageUsage[] {
    const packageMap = new Map<string, PackageUsage>();
    
    for (const imp of imports) {
      if (!imp.isExternal) continue;
      
      // Extract package name (handle scoped packages)
      let pkgName = imp.to;
      if (pkgName.startsWith('@')) {
        const parts = pkgName.split('/');
        pkgName = parts.slice(0, 2).join('/');
      } else {
        pkgName = pkgName.split('/')[0];
      }
      
      if (!packageMap.has(pkgName)) {
        packageMap.set(pkgName, { name: pkgName, importCount: 0, usedIn: [] });
      }
      
      const pkg = packageMap.get(pkgName)!;
      pkg.importCount++;
      if (!pkg.usedIn.includes(imp.from)) {
        pkg.usedIn.push(imp.from);
      }
    }
    
    return Array.from(packageMap.values()).sort((a, b) => b.importCount - a.importCount);
  }

  // ===========================================================================
  // MENTAL MODEL
  // ===========================================================================

  private buildMentalModel(
    folders: FolderInfo[],
    imports: ImportInfo[],
    classes: ClassInfo[],
    functions: FunctionInfo[]
  ): MentalModel {
    // Categorize folders into layers
    const layers = this.categorizeLayers(folders, classes, functions);
    
    // Calculate data flows between layers
    const flows = this.calculateDataFlows(layers, imports);
    
    // Find entry points
    const entryPoints = this.findEntryPoints(classes, functions, imports);
    
    // Find core components (most used)
    const coreComponents = this.findCoreComponents(imports, classes, functions);
    
    return { layers, flows, entryPoints, coreComponents };
  }

  private categorizeLayers(
    folders: FolderInfo[],
    classes: ClassInfo[],
    functions: FunctionInfo[]
  ): Layer[] {
    const layerDefs = [
      { 
        name: 'UI', 
        patterns: ['control', 'component', 'page', 'view', 'screen', 'ui', 'app'],
        color: '#61dafb'  // React blue
      },
      { 
        name: 'Services', 
        patterns: ['service', 'provider', 'hook', 'context', 'store', 'api'],
        color: '#68d391'  // Green
      },
      { 
        name: 'Models', 
        patterns: ['model', 'type', 'interface', 'entity', 'schema', 'dto'],
        color: '#f6ad55'  // Orange
      },
      { 
        name: 'Utilities', 
        patterns: ['util', 'helper', 'common', 'shared', 'lib', 'constant'],
        color: '#a78bfa'  // Purple
      },
    ];
    
    const layers: Layer[] = [];
    const categorized = new Set<string>();
    
    for (const def of layerDefs) {
      const matchingFolders: string[] = [];
      const matchingFiles: string[] = [];
      
      for (const folder of folders) {
        const lower = folder.path.toLowerCase();
        if (def.patterns.some(p => lower.includes(p)) && !categorized.has(folder.path)) {
          matchingFolders.push(folder.path);
          categorized.add(folder.path);
        }
      }
      
      // Also check individual files
      for (const cls of classes) {
        const folderLower = cls.file.toLowerCase();
        if (def.patterns.some(p => folderLower.includes(p) || cls.name.toLowerCase().includes(p))) {
          if (!matchingFiles.includes(cls.file)) {
            matchingFiles.push(cls.file);
          }
        }
      }
      
      if (matchingFolders.length > 0 || matchingFiles.length > 0) {
        layers.push({
          name: def.name,
          description: `${def.name} layer`,
          folders: matchingFolders,
          files: matchingFiles,
          color: def.color,
        });
      }
    }
    
    // Add "Other" layer for uncategorized
    const otherFolders = folders
      .filter(f => !categorized.has(f.path) && f.fileCount > 0)
      .map(f => f.path)
      .slice(0, 5);
    
    if (otherFolders.length > 0) {
      layers.push({
        name: 'Other',
        description: 'Other code',
        folders: otherFolders,
        files: [],
        color: '#a0aec0',
      });
    }
    
    return layers;
  }

  private calculateDataFlows(layers: Layer[], imports: ImportInfo[]): DataFlow[] {
    const flows: DataFlow[] = [];
    const flowMap = new Map<string, number>();
    
    const getLayer = (file: string): Layer | undefined => {
      for (const layer of layers) {
        if (layer.files.includes(file)) return layer;
        for (const folder of layer.folders) {
          if (file.startsWith(folder + '/') || file.startsWith(folder)) return layer;
        }
      }
      return undefined;
    };
    
    for (const imp of imports) {
      if (imp.isExternal) continue;
      
      const fromLayer = getLayer(imp.from);
      const toLayer = getLayer(imp.to);
      
      if (fromLayer && toLayer && fromLayer.name !== toLayer.name) {
        const key = `${fromLayer.name}->${toLayer.name}`;
        flowMap.set(key, (flowMap.get(key) || 0) + 1);
      }
    }
    
    for (const [key, count] of flowMap) {
      const [from, to] = key.split('->');
      flows.push({ from, to, label: 'imports', count });
    }
    
    return flows.sort((a, b) => b.count - a.count);
  }

  private findEntryPoints(
    classes: ClassInfo[],
    functions: FunctionInfo[],
    imports: ImportInfo[]
  ): string[] {
    // Entry points = exported but not imported by anything internal
    const imported = new Set<string>();
    for (const imp of imports) {
      if (!imp.isExternal) {
        imported.add(imp.to);
      }
    }
    
    const entryPoints: string[] = [];
    
    // Check classes
    for (const cls of classes) {
      if (cls.exported && !imported.has(cls.file)) {
        // Check if it's a Control or Component
        if (cls.name.includes('Control') || cls.name.includes('Component') || 
            cls.decorators.some(d => d.includes('Component'))) {
          entryPoints.push(cls.name);
        }
      }
    }
    
    // Check functions (React components)
    for (const func of functions) {
      if (func.exported && !imported.has(func.file)) {
        // PascalCase = likely React component
        if (func.name[0] === func.name[0].toUpperCase()) {
          entryPoints.push(func.name);
        }
      }
    }
    
    return entryPoints.slice(0, 10);
  }

  private findCoreComponents(
    imports: ImportInfo[],
    classes: ClassInfo[],
    functions: FunctionInfo[]
  ): string[] {
    // Count how many times each internal file is imported
    const importCount = new Map<string, number>();
    
    for (const imp of imports) {
      if (!imp.isExternal) {
        importCount.set(imp.to, (importCount.get(imp.to) || 0) + 1);
      }
    }
    
    // Sort by import count
    const sorted = Array.from(importCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    // Get names of the classes/functions in those files
    const coreComponents: string[] = [];
    
    for (const [file] of sorted) {
      const cls = classes.find(c => c.file === file);
      if (cls) {
        coreComponents.push(cls.name);
        continue;
      }
      
      const func = functions.find(f => f.file === file);
      if (func) {
        coreComponents.push(func.name);
      }
    }
    
    return coreComponents;
  }

  // ===========================================================================
  // ISSUES & DUPLICATES
  // ===========================================================================

  private findDeadCode(sourceFiles: SourceFile[]): CodeIssue[] {
    // CONSERVATIVE APPROACH: Only flag things we're 100% sure about
    // Better to miss some dead code than show false positives
    const issues: CodeIssue[] = [];
    
    // Build a map of all files and what imports them
    const fileImportCount = new Map<string, number>();
    
    for (const sf of sourceFiles) {
      for (const imp of sf.getImportDeclarations()) {
        const moduleSpec = imp.getModuleSpecifierValue();
        if (moduleSpec.startsWith('.')) {
          const resolved = path.resolve(path.dirname(sf.getFilePath()), moduleSpec);
          const relativePath = path.relative(this.rootPath, resolved).replace(/\\/g, '/');
          
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
    
    // Only check for completely orphaned files (no imports at all)
    for (const sf of sourceFiles) {
      const relativePath = path.relative(this.rootPath, sf.getFilePath()).replace(/\\/g, '/');
      
      // Skip files that should be ignored
      if (this.shouldSkipDeadCodeCheck(relativePath)) continue;
      
      // Check if this file is imported anywhere
      const isImported = fileImportCount.has(relativePath) ||
                         fileImportCount.has(relativePath.replace(/\.(ts|tsx)$/, ''));
      
      // Only flag if file is NEVER imported AND has exports
      if (!isImported) {
        const exports = sf.getExportedDeclarations();
        if (exports.size > 0) {
          // Get first export name for the message
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

  /**
   * Check if file should be skipped for dead code analysis
   */
  private shouldSkipDeadCodeCheck(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    
    // Skip test files
    if (lower.includes('.test.') || lower.includes('.spec.')) return true;
    
    // Skip type definitions
    if (lower.endsWith('.d.ts')) return true;
    
    // Skip index files (barrel exports)
    if (lower.endsWith('index.ts') || lower.endsWith('index.tsx')) return true;
    
    // Skip generated files
    if (lower.includes('generated') || lower.includes('.generated.')) return true;
    if (lower.includes('/gen/') || lower.includes('\\gen\\')) return true;
    
    // Skip config files
    if (lower.includes('config')) return true;
    if (lower.includes('webpack')) return true;
    if (lower.includes('jest')) return true;
    if (lower.includes('babel')) return true;
    
    // Skip entity/model definitions (often used dynamically)
    if (lower.includes('/entities/')) return true;
    if (lower.includes('/models/')) return true;
    if (lower.includes('/types/')) return true;
    if (lower.includes('enum')) return true;
    
    // Skip common utility patterns
    if (lower.includes('constants')) return true;
    if (lower.includes('strings')) return true;
    if (lower.includes('localization')) return true;
    if (lower.includes('i18n')) return true;
    
    // Skip entry points
    if (lower.includes('app.ts') || lower.includes('main.ts')) return true;
    
    // Skip testing/mock folders
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

  /**
   * Generate a crux (brief description) for a file based on analysis
   */
  public generateFileCrux(
    file: FileInfo,
    classes: ClassInfo[],
    functions: FunctionInfo[],
    interfaces: InterfaceInfo[],
    imports: ImportInfo[],
    importedBy: ImportInfo[]
  ): string {
    const parts: string[] = [];
    
    // 1. Detect pattern type
    const pattern = this.detectFilePattern(file, classes, functions);
    parts.push(pattern);
    
    // 2. What it exports
    const exportCount = classes.filter(c => c.exported).length + 
                        functions.filter(f => f.exported).length +
                        interfaces.filter(i => i.exported).length;
    
    if (exportCount > 0) {
      const mainExports: string[] = [];
      classes.filter(c => c.exported).slice(0, 2).forEach(c => mainExports.push(`${c.name} class`));
      functions.filter(f => f.exported).slice(0, 2).forEach(f => mainExports.push(`${f.name}()`));
      
      if (mainExports.length > 0) {
        const more = exportCount > mainExports.length ? ` and ${exportCount - mainExports.length} more` : '';
        parts.push(`Exports ${mainExports.join(', ')}${more}.`);
      }
    }
    
    // 3. Usage status
    if (importedBy.length === 0) {
      if (file.path.toLowerCase().includes('test') || file.path.toLowerCase().includes('mock')) {
        parts.push('Test/mock utility - used by test files.');
      } else if (pattern.includes('Control') || pattern.includes('entry')) {
        parts.push('Entry point - loaded directly by framework.');
      } else {
        parts.push('Not imported by other files.');
      }
    } else if (importedBy.length >= 10) {
      parts.push(`Core file - imported by ${importedBy.length} files.`);
    } else if (importedBy.length >= 5) {
      parts.push(`Widely used - imported by ${importedBy.length} files.`);
    } else {
      parts.push(`Used by ${importedBy.length} file${importedBy.length > 1 ? 's' : ''}.`);
    }
    
    // 4. Key dependencies
    const internalImports = imports.filter(i => !i.isExternal);
    if (internalImports.length > 0) {
      const keyDeps = internalImports.slice(0, 3).map(i => {
        const parts = i.to.split('/');
        return parts[parts.length - 1].replace(/\.(ts|tsx)$/, '');
      });
      parts.push(`Depends on ${keyDeps.join(', ')}${internalImports.length > 3 ? ` +${internalImports.length - 3} more` : ''}.`);
    }
    
    return parts.join(' ');
  }

  /**
   * Detect the pattern/type of a file
   */
  private detectFilePattern(file: FileInfo, classes: ClassInfo[], functions: FunctionInfo[]): string {
    const name = file.name.toLowerCase();
    const path = file.path.toLowerCase();
    
    // Check for specific patterns
    if (name.includes('control') && file.extension === '.tsx') return 'PCF Control';
    if (name.includes('control') && classes.some(c => c.methods.some(m => m.name === 'init' || m.name === 'updateView'))) return 'PCF Control';
    if (name.startsWith('use') && functions.length > 0) return 'React Hook';
    if (name.includes('.hook')) return 'React Hook';
    if (name.includes('service')) return 'Service';
    if (name.includes('provider')) return 'Provider';
    if (name.includes('context')) return 'React Context';
    if (name.includes('util') || name.includes('helper')) return 'Utility file';
    if (name.includes('constant') || name.includes('config')) return 'Constants file';
    if (name.includes('type') || name.includes('interface')) return 'Type definitions';
    if (name.includes('mock') || path.includes('/mock')) return 'Mock/test utility';
    if (name.includes('test') || name.includes('spec')) return 'Test file';
    if (file.extension === '.tsx' && functions.some(f => f.name[0] === f.name[0].toUpperCase())) return 'React Component';
    if (classes.length > 0 && classes[0].decorators.length > 0) return 'Decorated class';
    if (classes.length > 0) return 'Class module';
    if (functions.length > 0) return 'Function module';
    if (file.extension === '.ts') return 'TypeScript module';
    
    return 'Module';
  }

  private findCircularDependencies(graph: DependencyGraph): CodeIssue[] {
    return graph.circular.map(cycle => ({
      type: 'circular-dep' as const,
      severity: 'error' as const,
      message: `Circular dependency: ${cycle.join(' → ')} → ${cycle[0]}`,
      file: cycle[0],
      details: cycle.join(' → '),
      suggestion: 'Break the cycle by extracting shared code or restructuring',
    }));
  }

  private findComplexFunctions(functions: FunctionInfo[]): CodeIssue[] {
    return functions
      .filter(f => f.complexity > 10 || f.lines > 50 || f.parameters.length > 5)
      .map(f => ({
        type: 'complex' as const,
        severity: (f.complexity > 20 ? 'error' : 'warning') as 'error' | 'warning',
        message: `Complex function "${f.name}": complexity=${f.complexity}, lines=${f.lines}, params=${f.parameters.length}`,
        file: f.file,
        line: f.line,
        suggestion: 'Consider breaking this into smaller functions',
      }));
  }

  private findDuplicates(
    sourceFiles: SourceFile[],
    classes: ClassInfo[],
    functions: FunctionInfo[],
    interfaces: InterfaceInfo[]
  ): DuplicateGroup[] {
    const duplicates: DuplicateGroup[] = [];
    
    // ONLY exact file duplicates - 100% real, no false positives
    // We use MD5 hash of normalized content (whitespace-insensitive)
    const fileHashes = new Map<string, Array<{ path: string; name: string }>>();
    
    for (const sf of sourceFiles) {
      // Normalize: remove all whitespace and comments for comparison
      const content = sf.getFullText();
      const normalized = this.normalizeCode(content);
      
      // Only consider files with actual content
      if (normalized.length < 50) continue;
      
      const hash = crypto.createHash('md5').update(normalized).digest('hex');
      const relativePath = path.relative(this.rootPath, sf.getFilePath()).replace(/\\/g, '/');
      
      if (!fileHashes.has(hash)) {
        fileHashes.set(hash, []);
      }
      fileHashes.get(hash)!.push({ 
        path: relativePath, 
        name: path.basename(relativePath) 
      });
    }
    
    // Only report actual duplicates (2+ files with same hash)
    for (const [hash, files] of fileHashes) {
      if (files.length > 1) {
        duplicates.push({
          type: 'exact-file',
          items: files.map(f => ({ file: f.path, name: f.name, line: 1 })),
          similarity: 100,
        });
      }
    }
    
    // NOTE: We removed "similar functions" and "similar interfaces" detection
    // because they produced false positives. Only exact duplicates are shown.
    // 
    // Future improvement: Add AST-based similarity comparison
    // that compares actual code structure, not just signatures.
    
    return duplicates;
  }

  /**
   * Normalize code for comparison - removes formatting differences
   */
  private normalizeCode(code: string): string {
    return code
      // Remove single-line comments
      .replace(/\/\/.*$/gm, '')
      // Remove multi-line comments
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Remove all whitespace
      .replace(/\s+/g, '')
      // Lowercase for case-insensitive comparison
      .toLowerCase();
  }

  // ===========================================================================
  // STRUCTURAL SIMILARITY DETECTION (Honest)
  // ===========================================================================

  /**
   * Find functions that are structurally similar.
   * We compare discrete, verifiable criteria — no fuzzy scores.
   */
  private findStructuralTwins(sourceFiles: SourceFile[], functions: FunctionInfo[]): StructuralTwin[] {
    const twins: StructuralTwin[] = [];
    
    // Build structural signatures for all meaningful functions
    const signatures: StructuralSignature[] = [];
    
    for (const sf of sourceFiles) {
      const relativePath = path.relative(this.rootPath, sf.getFilePath()).replace(/\\/g, '/');
      
      // Process top-level functions
      for (const func of sf.getFunctions()) {
        const name = func.getName();
        if (!name) continue;
        
        const sig = this.extractStructuralSignature(func, name, relativePath);
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
          const sig = this.extractStructuralSignature(init, name, relativePath);
          if (sig && sig.statementCount >= 3) {
            signatures.push(sig);
          }
        }
      }
    }
    
    // Compare all pairs (O(n²) but filtered to meaningful functions)
    // Limit comparisons on very large codebases to avoid memory issues
    const maxSignatures = Math.min(signatures.length, 200); // Cap at 200 functions for safety
    
    // If we have too few functions, skip
    if (signatures.length < 2) {
      return [];
    }
    
    const signaturesLimited = signatures.slice(0, maxSignatures);
    
    for (let i = 0; i < signaturesLimited.length; i++) {
      for (let j = i + 1; j < signaturesLimited.length; j++) {
        const sigA = signaturesLimited[i];
        const sigB = signaturesLimited[j];
        
        // Skip if same file (internal helpers are expected to be similar)
        if (sigA.file === sigB.file) continue;
        
        // Quick pre-check to avoid expensive comparison
        // Must have same param count and async status
        if (sigA.paramCount !== sigB.paramCount || sigA.isAsync !== sigB.isAsync) {
          continue;
        }
        
        // Compare and get criteria breakdown
        const comparison = this.compareSignatures(sigA, sigB);
        
        // Only report if enough criteria match (at least 6 out of 8)
        if (comparison.matchedCount >= 6) {
          twins.push(comparison);
        }
        
        // Early exit if we have enough twins
        if (twins.length >= 30) break;
      }
      if (twins.length >= 30) break;
    }
    
    // Sort by match count descending
    twins.sort((a, b) => b.matchedCount - a.matchedCount);
    
    // Limit to top 20 to avoid overwhelming
    return twins.slice(0, 20);
  }

  /**
   * Extract a structural signature from a function's AST.
   * Everything here is factual — directly from parsing.
   */
  private extractStructuralSignature(func: any, name: string, file: string): StructuralSignature | null {
    try {
      const body = func.getBody?.();
      if (!body) return null;
      
      // Get parameters
      const params = func.getParameters?.() || [];
      const paramTypes = params.map((p: any) => this.simplifyType(p.getType?.()?.getText?.() || 'unknown'));
      
      // Get return type
      const returnType = this.simplifyType(func.getReturnType?.()?.getText?.() || 'unknown');
      
      // Analyze body structure
      let statementCount = 0;
      let hasLoop = false;
      let hasTryCatch = false;
      let hasConditional = false;
      const controlFlowParts: string[] = [];
      const patterns: string[] = [];
      
      // Count statements and detect patterns
      body.forEachDescendant?.((node: Node) => {
        const kind = node.getKind();
        
        // Count top-level-ish statements
        if (kind === SyntaxKind.ExpressionStatement ||
            kind === SyntaxKind.VariableStatement ||
            kind === SyntaxKind.ReturnStatement ||
            kind === SyntaxKind.ThrowStatement) {
          statementCount++;
        }
        
        // Detect control flow
        if (kind === SyntaxKind.IfStatement) {
          hasConditional = true;
          if (!controlFlowParts.includes('if')) controlFlowParts.push('if');
          
          // Check for guard clause pattern (early return)
          const ifNode = node as any;
          const thenBlock = ifNode.getThenStatement?.()?.getText?.() || '';
          if (thenBlock.includes('return') || thenBlock.includes('throw')) {
            if (!patterns.includes('guard-clause')) patterns.push('guard-clause');
          }
        }
        
        if (kind === SyntaxKind.ForStatement || 
            kind === SyntaxKind.ForInStatement || 
            kind === SyntaxKind.ForOfStatement ||
            kind === SyntaxKind.WhileStatement) {
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
        
        // Detect common patterns
        if (kind === SyntaxKind.AwaitExpression) {
          if (!patterns.includes('await-call')) patterns.push('await-call');
        }
        
        if (kind === SyntaxKind.CallExpression) {
          const callText = node.getText?.() || '';
          if (callText.includes('.get(') || callText.includes('.post(') || 
              callText.includes('.put(') || callText.includes('.delete(') ||
              callText.includes('fetch(')) {
            if (!patterns.includes('api-call')) patterns.push('api-call');
          }
          if (callText.includes('log') || callText.includes('console.')) {
            if (!patterns.includes('logging')) patterns.push('logging');
          }
        }
        
        // Error rethrow pattern
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
   * Simplify a TypeScript type to a category for comparison.
   * We don't need exact types — just structural categories.
   */
  private simplifyType(type: string): string {
    const t = type.toLowerCase();
    if (t === 'void' || t === 'undefined') return 'void';
    if (t === 'string') return 'string';
    if (t === 'number' || t === 'bigint') return 'number';
    if (t === 'boolean') return 'boolean';
    if (t.startsWith('promise')) return 'Promise';
    if (t.includes('[]') || t.startsWith('array')) return 'array';
    if (t === 'any' || t === 'unknown') return 'any';
    if (t === 'null' || t === 'never') return t;
    return 'object'; // interfaces, classes, complex types
  }

  /**
   * Compare two structural signatures and produce criteria breakdown.
   * Every criterion is explicit and verifiable.
   */
  private compareSignatures(a: StructuralSignature, b: StructuralSignature): StructuralTwin {
    const criteria: SimilarityCriterion[] = [];
    let matchedCount = 0;
    
    // Criterion 1: Parameter count
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
    
    // Criterion 2: Parameter types (simplified)
    const paramTypesMatch = a.paramTypes.length === b.paramTypes.length &&
      a.paramTypes.every((t, i) => t === b.paramTypes[i]);
    criteria.push({
      name: 'Parameter types',
      description: paramTypesMatch 
        ? `Same parameter type pattern` 
        : `Different parameter types`,
      valueA: a.paramTypes.join(', ') || '(none)',
      valueB: b.paramTypes.join(', ') || '(none)',
      matched: paramTypesMatch,
    });
    if (paramTypesMatch) matchedCount++;
    
    // Criterion 3: Return type
    const returnMatch = a.returnType === b.returnType;
    criteria.push({
      name: 'Return type',
      description: returnMatch 
        ? `Both return ${a.returnType}` 
        : `Different return types`,
      valueA: a.returnType,
      valueB: b.returnType,
      matched: returnMatch,
    });
    if (returnMatch) matchedCount++;
    
    // Criterion 4: Async/sync
    const asyncMatch = a.isAsync === b.isAsync;
    criteria.push({
      name: 'Async pattern',
      description: asyncMatch 
        ? (a.isAsync ? 'Both async' : 'Both sync') 
        : 'Different async patterns',
      valueA: a.isAsync ? 'async' : 'sync',
      valueB: b.isAsync ? 'async' : 'sync',
      matched: asyncMatch,
    });
    if (asyncMatch) matchedCount++;
    
    // Criterion 5: Statement count (within ±3)
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
    
    // Criterion 6: Control flow pattern
    const cfMatch = a.controlFlowPattern === b.controlFlowPattern;
    criteria.push({
      name: 'Control flow',
      description: cfMatch 
        ? `Same flow: ${a.controlFlowPattern}` 
        : `Different control flow`,
      valueA: a.controlFlowPattern,
      valueB: b.controlFlowPattern,
      matched: cfMatch,
    });
    if (cfMatch) matchedCount++;
    
    // Criterion 7: Has try/catch
    const tryMatch = a.hasTryCatch === b.hasTryCatch;
    criteria.push({
      name: 'Error handling',
      description: tryMatch 
        ? (a.hasTryCatch ? 'Both have try/catch' : 'Neither has try/catch') 
        : 'Different error handling',
      valueA: a.hasTryCatch ? 'has try/catch' : 'no try/catch',
      valueB: b.hasTryCatch ? 'has try/catch' : 'no try/catch',
      matched: tryMatch,
    });
    if (tryMatch) matchedCount++;
    
    // Criterion 8: Code patterns overlap
    const commonPatterns = a.patterns.filter(p => b.patterns.includes(p));
    const patternOverlap = commonPatterns.length >= Math.min(a.patterns.length, b.patterns.length, 1);
    criteria.push({
      name: 'Code patterns',
      description: commonPatterns.length > 0 
        ? `Shared: ${commonPatterns.join(', ')}` 
        : 'No common patterns',
      valueA: a.patterns.join(', ') || '(none detected)',
      valueB: b.patterns.join(', ') || '(none detected)',
      matched: patternOverlap,
    });
    if (patternOverlap) matchedCount++;
    
    // Determine verdict
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

  // ===========================================================================
  // COMPLEXITY
  // ===========================================================================

  private calculateFunctionComplexity(func: any): number {
    let complexity = 1;
    
    try {
      const body = func.getBody?.();
      if (!body) return complexity;
      
      body.forEachDescendant?.((node: Node) => {
        const kind = node.getKind();
        // Count decision points
        if (kind === SyntaxKind.IfStatement ||
            kind === SyntaxKind.ConditionalExpression ||
            kind === SyntaxKind.ForStatement ||
            kind === SyntaxKind.ForInStatement ||
            kind === SyntaxKind.ForOfStatement ||
            kind === SyntaxKind.WhileStatement ||
            kind === SyntaxKind.DoStatement ||
            kind === SyntaxKind.CatchClause ||
            kind === SyntaxKind.CaseClause ||
            kind === SyntaxKind.BinaryExpression) {
          const text = node.getText?.();
          if (text?.includes('&&') || text?.includes('||')) {
            complexity++;
          }
          complexity++;
        }
      });
    } catch (e) {
      // Ignore errors
    }
    
    return complexity;
  }

  private calculateComplexity(functions: FunctionInfo[]): ComplexityScore[] {
    return functions
      .filter(f => f.complexity > 5)
      .map(f => ({
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

  // ===========================================================================
  // LANGUAGES
  // ===========================================================================

  private calculateLanguages(files: FileInfo[]): LanguageBreakdown[] {
    const langMap: Record<string, { count: number; lines: number; color: string }> = {
      '.ts': { count: 0, lines: 0, color: '#3178c6' },
      '.tsx': { count: 0, lines: 0, color: '#61dafb' },
      '.js': { count: 0, lines: 0, color: '#f7df1e' },
      '.jsx': { count: 0, lines: 0, color: '#61dafb' },
    };
    
    const langNames: Record<string, string> = {
      '.ts': 'TypeScript',
      '.tsx': 'React TSX',
      '.js': 'JavaScript',
      '.jsx': 'React JSX',
    };
    
    let totalLines = 0;
    
    for (const file of files) {
      if (langMap[file.extension]) {
        langMap[file.extension].count++;
        langMap[file.extension].lines += file.lines;
        totalLines += file.lines;
      }
    }
    
    return Object.entries(langMap)
      .filter(([, data]) => data.count > 0)
      .map(([ext, data]) => ({
        language: langNames[ext],
        extension: ext,
        fileCount: data.count,
        lines: data.lines,
        percentage: Math.round((data.lines / totalLines) * 100),
        color: data.color,
      }))
      .sort((a, b) => b.percentage - a.percentage);
  }

  // ===========================================================================
  // STATS
  // ===========================================================================

  private calculateStats(
    files: FileInfo[],
    classes: ClassInfo[],
    functions: FunctionInfo[],
    interfaces: InterfaceInfo[],
    issues: CodeIssue[],
    duplicates: DuplicateGroup[],
    complexity: ComplexityScore[]
  ): CodeStats {
    const totalLines = files.reduce((sum, f) => sum + f.lines, 0);
    const avgComplexity = functions.length > 0
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

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private extractParameter(param: any): ParameterInfo {
    return {
      name: param.getName(),
      type: param.getType().getText(),
      optional: param.hasQuestionToken() || param.hasInitializer(),
      defaultValue: param.getInitializer()?.getText(),
    };
  }

  private getVisibility(node: any): 'public' | 'private' | 'protected' {
    if (node.hasModifier?.(SyntaxKind.PrivateKeyword)) return 'private';
    if (node.hasModifier?.(SyntaxKind.ProtectedKeyword)) return 'protected';
    return 'public';
  }
}
