/**
 * TSight Analyzer - orchestrator.
 *
 * Owns the ts-morph Project lifecycle and the analysis pipeline. Each stage
 * (discovery, extraction, graph, metrics, etc.) lives in `./internal/*` so
 * this file stays a high-level read of what an analysis run actually does.
 */

import { Project } from 'ts-morph';
import {
  AnalysisResult,
  CodeIssue,
  StructuralTwin,
  FileInfo,
  ClassInfo,
  FunctionInfo,
  InterfaceInfo,
  ImportInfo,
} from './types.js';
import { createProject, addSourceFiles } from './internal/project.js';
import {
  extractFiles,
  extractFolders,
  extractClasses,
  extractFunctions,
  extractInterfaces,
  extractImports,
} from './internal/extract.js';
import { buildDependencyGraph, extractExternalPackages } from './internal/graph.js';
import { buildMentalModel } from './internal/mental-model.js';
import {
  findDeadCode,
  findCircularDependencies,
  findComplexFunctions,
} from './internal/issues.js';
import { findDuplicates } from './internal/duplicates.js';
import { findStructuralTwins } from './internal/structural-twins.js';
import { calculateComplexity } from './internal/complexity.js';
import { calculateLanguages } from './internal/languages.js';
import { calculateStats } from './internal/stats.js';
import { generateFileCrux } from './internal/file-crux.js';

export class Analyzer {
  private project: Project;
  private rootPath: string = '';

  constructor() {
    this.project = createProject();
  }

  /**
   * Main entry point - analyze a project
   */
  async analyze(projectPath: string): Promise<AnalysisResult> {
    const startTime = Date.now();
    this.rootPath = projectPath;

    console.log(`🔍 TSight analyzing: ${projectPath}`);

    // Discovery
    const sourceFiles = addSourceFiles(this.project, projectPath);
    console.log(`   Found ${sourceFiles.length} source files`);

    // Extraction
    const files = extractFiles(this.rootPath, sourceFiles);
    const folders = extractFolders(files);
    const languages = calculateLanguages(files);
    const classes = extractClasses(this.rootPath, sourceFiles);
    const functions = extractFunctions(this.rootPath, sourceFiles);
    const interfaces = extractInterfaces(this.rootPath, sourceFiles);
    const imports = extractImports(this.rootPath, sourceFiles);

    // Graph
    const dependencyGraph = buildDependencyGraph(imports);
    const externalPackages = extractExternalPackages(imports);

    // Issues
    const issues: CodeIssue[] = [
      ...findDeadCode(this.rootPath, sourceFiles),
      ...findCircularDependencies(dependencyGraph),
      ...findComplexFunctions(functions),
    ];

    // Duplicates
    const duplicates = findDuplicates(this.rootPath, sourceFiles);

    // Structural twins (best-effort: can fail on unusual inputs)
    let structuralTwins: StructuralTwin[] = [];
    try {
      structuralTwins = findStructuralTwins(this.rootPath, sourceFiles, functions);
    } catch (e) {
      console.error('   ⚠ Structural twins detection failed:', e);
    }

    // Metrics + model
    const complexity = calculateComplexity(functions);
    const mentalModel = buildMentalModel(folders, imports, classes, functions);
    const stats = calculateStats(
      files,
      classes,
      functions,
      interfaces,
      issues,
      duplicates,
      complexity,
    );

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

  /**
   * Generate a brief description for a single file.
   * Kept on the class for backward compatibility with consumers that
   * called `analyzer.generateFileCrux(...)`.
   */
  public generateFileCrux(
    file: FileInfo,
    classes: ClassInfo[],
    functions: FunctionInfo[],
    interfaces: InterfaceInfo[],
    imports: ImportInfo[],
    importedBy: ImportInfo[],
  ): string {
    return generateFileCrux(file, classes, functions, interfaces, imports, importedBy);
  }
}
