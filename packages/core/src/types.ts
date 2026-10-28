/**
 * TSight core types.
 *
 * Every number TSight shows is derived from these structures. When a value
 * is computed with a rule (a threshold, a convention), the rule is written
 * next to the field so the UI can show it.
 */

// ============================================================================
// FILES AND FOLDERS
// ============================================================================

/** `test` covers *.test.*, *.spec.* and files under __tests__, __mocks__, test, tests or e2e folders. */
export type FileRole = 'source' | 'test';

export interface FileInfo {
  path: string; // relative to the analysis root, always with forward slashes
  name: string;
  extension: string;
  folder: string;
  lines: number;
  size: number; // characters
  role: FileRole;
}

export interface FolderInfo {
  path: string;
  name: string;
  fileCount: number;
  totalLines: number;
  children: string[]; // subfolder names
}

// ============================================================================
// CODE ELEMENTS
// ============================================================================

export interface CodeElement {
  id: string;
  name: string;
  type: 'class' | 'function' | 'interface' | 'type' | 'enum' | 'variable' | 'component';
  file: string;
  line: number;
  endLine: number;
  exported: boolean;
}

export interface ClassInfo extends CodeElement {
  type: 'class';
  methods: MethodInfo[];
  properties: PropertyInfo[];
  extends?: string;
  implements: string[];
  decorators: string[];
}

/**
 * A function-like unit that gets its own complexity score.
 *
 * Units: function declarations, class methods, constructors, getters and
 * setters, and arrow functions or function expressions that are given a
 * name (assigned to a variable, an object property or a class field).
 * Anonymous inline functions, such as a callback passed to `map` or
 * `useEffect`, are counted as part of the unit that contains them.
 */
export type FunctionKind = 'function' | 'method' | 'constructor' | 'getter' | 'setter' | 'arrow';

export interface FunctionInfo extends CodeElement {
  type: 'function';
  kind: FunctionKind;
  className?: string;
  parameters: ParameterInfo[];
  returnType: string; // the annotation as written, or 'inferred'
  async: boolean;
  complexity: number; // cyclomatic complexity, see internal/complexity.ts
  lines: number;
}

export interface InterfaceInfo extends CodeElement {
  type: 'interface';
  properties: PropertyInfo[];
  extends: string[];
}

export interface MethodInfo {
  name: string;
  parameters: ParameterInfo[];
  returnType: string;
  visibility: 'public' | 'private' | 'protected';
  async: boolean;
  static: boolean;
  line: number;
}

export interface PropertyInfo {
  name: string;
  type: string; // the annotation as written, or 'inferred'
  optional: boolean;
  visibility?: 'public' | 'private' | 'protected';
}

export interface ParameterInfo {
  name: string;
  type: string; // the annotation as written, or 'inferred'
  optional: boolean;
  defaultValue?: string;
}

// ============================================================================
// IMPORTS AND THE DEPENDENCY GRAPH
// ============================================================================

/**
 * What an import specifier resolved to.
 * - internal: a file in this analysis
 * - external: a package (node_modules, a Node built-in, or a package that is not installed)
 * - unresolved: looked like project code (relative path, tsconfig alias, workspace package) but no file was found
 * - asset: a non-code file such as .css, .svg or .json
 * - excluded: a real code file that is not part of this analysis (outside the root, ignored, or a .d.ts)
 */
export type ImportKind = 'internal' | 'external' | 'unresolved' | 'asset' | 'excluded';

export type ImportSyntax = 'import' | 'export' | 'dynamic' | 'require';

export interface ImportInfo {
  from: string; // importing file, relative path
  to: string; // relative path for internal and excluded files, otherwise the specifier
  specifier: string; // exactly as written in the source
  kind: ImportKind;
  syntax: ImportSyntax;
  typeOnly: boolean;
  imports: string[]; // imported names; 'default' for a default import, '*' for namespace, star or dynamic
  isExternal: boolean; // kept for older consumers: true when kind is 'external'
  line: number;
  resolvedBy?: 'typescript' | 'workspace'; // how an internal target was found
}

export interface ResolutionStats {
  /** Import statements that point at project code (internal + unresolved). */
  projectImports: number;
  internal: number;
  unresolved: number;
  external: number;
  asset: number;
  excluded: number;
  unresolvedImports: Array<{ from: string; specifier: string; line: number }>;
  /** tsconfig.json files used for resolution, relative to the analysis root (may start with ../). */
  tsconfigs: string[];
}

export interface Dependency {
  source: string;
  target: string;
  type: 'import' | 'extends' | 'implements' | 'calls';
  weight: number; // number of import statements from source to target
  typeOnly: boolean; // true when every one of those statements is type-only
  dynamicOnly: boolean; // true when every one of those statements is an import() call
}

/**
 * Cycles are found over runtime imports only. Type-only imports are erased
 * when the code is compiled and import() calls load lazily, so neither can
 * cause the load-order problems that make cycles harmful.
 */
export interface CycleGroup {
  /** All files in one strongly connected component of the runtime import graph. */
  files: string[];
  /** One shortest cycle through the group, for display. The first file is not repeated at the end. */
  example: string[];
}

export interface DependencyGraph {
  nodes: string[];
  edges: Dependency[];
  /** Example cycle per group (same as cycleGroups[i].example). */
  circular: string[][];
  cycleGroups: CycleGroup[];
}

export interface EntryPoint {
  file: string;
  reason: string; // which rule marked it, for example "package.json main" or "Next.js app router file"
}

// ============================================================================
// MENTAL MODEL (folders and the imports between them)
// ============================================================================

export interface Layer {
  name: string; // the folder path
  description: string;
  folders: string[];
  files: string[];
  color: string;
}

export interface MentalModel {
  layers: Layer[];
  flows: DataFlow[];
  entryPoints: string[];
  coreComponents: string[];
}

export interface DataFlow {
  from: string;
  to: string;
  label: string;
  count: number; // number of distinct file-to-file import edges between the two folders
}

// ============================================================================
// ISSUES
// ============================================================================

export interface CodeIssue {
  type: 'dead-code' | 'duplicate' | 'complex' | 'circular-dep' | 'missing-type' | 'similar-code';
  severity: 'error' | 'warning' | 'info';
  message: string;
  file: string;
  line?: number;
  details?: string;
  suggestion?: string;
}

export interface DuplicateGroup {
  type: 'exact-file' | 'similar-function' | 'similar-interface';
  /** 'bytes': the files are byte-for-byte identical. 'tokens': identical once whitespace and comments are ignored. */
  match: 'bytes' | 'tokens';
  items: Array<{
    file: string;
    name: string;
    line: number;
  }>;
  similarity: number;
}

// ============================================================================
// STRUCTURAL SIMILARITY
// ============================================================================

export interface SimilarityCriterion {
  name: string;
  description: string;
  valueA: string;
  valueB: string;
  matched: boolean;
}

export interface StructuralSignature {
  file: string;
  name: string;
  line: number;
  paramCount: number;
  paramTypes: string[];
  returnType: string;
  isAsync: boolean;
  statementCount: number;
  controlFlowPattern: string;
  hasLoop: boolean;
  hasTryCatch: boolean;
  hasConditional: boolean;
  patterns: string[];
}

export interface StructuralTwin {
  functionA: { file: string; name: string; line: number };
  functionB: { file: string; name: string; line: number };
  criteria: SimilarityCriterion[];
  matchedCount: number;
  totalCount: number;
  verdict: 'structural-twin' | 'similar-shape' | 'worth-reviewing';
  summary: string;
}

export interface StructuralTwinReport {
  twins: StructuralTwin[];
  /** Source functions large enough to compare (see MIN_TWIN_NODES). */
  functionsCompared: number;
  /** Pairs that met the threshold before the list was cut to `twins.length`. */
  pairsFound: number;
}

export interface ComplexityScore {
  file: string;
  element: string;
  line: number;
  score: number;
  reasons: string[];
}

// ============================================================================
// DERIVED VIEWS
// ============================================================================

export interface Hotspot {
  file: string;
  name: string;
  complexity: number; // sum of the cyclomatic complexity of every unit in the file
  dependents: number; // distinct source files that import this file directly
  riskScore: number; // complexity × dependents
  riskLevel: 'critical' | 'high' | 'medium'; // 500+ critical, 200+ high
  functions: Array<{ name: string; complexity: number; line: number }>;
}

export interface BlastRadius {
  file: string;
  name: string;
  directImpact: number;
  indirectImpact: number;
  totalImpact: number;
  totalFiles: number;
  percentageImpact: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  levels: Array<{ level: number; files: Array<{ file: string; name: string; role: FileRole }> }>;
  unresolvedInProject: number;
  summary: string;
}

// ============================================================================
// ANALYSIS RESULT
// ============================================================================

export interface AnalysisResult {
  root: string; // absolute path that was analyzed
  analyzedAt: Date;
  duration: number; // ms

  files: FileInfo[];
  folders: FolderInfo[];
  languages: LanguageBreakdown[];

  classes: ClassInfo[];
  functions: FunctionInfo[];
  interfaces: InterfaceInfo[];

  imports: ImportInfo[];
  resolution: ResolutionStats;
  dependencyGraph: DependencyGraph;
  externalPackages: PackageUsage[];
  entryPoints: EntryPoint[];
  /** Export names per file (declared in that file, not re-exported), used for unused-export checks. */
  exportsByFile: Record<string, string[]>;

  mentalModel: MentalModel;

  issues: CodeIssue[];
  duplicates: DuplicateGroup[];
  complexity: ComplexityScore[];
  structuralTwins: StructuralTwin[];
  structuralTwinStats: { functionsCompared: number; pairsFound: number };

  stats: CodeStats;
}

export interface LanguageBreakdown {
  language: string;
  extension: string;
  fileCount: number;
  lines: number;
  percentage: number;
  color: string;
}

export interface PackageUsage {
  name: string;
  importCount: number;
  usedIn: string[];
}

export interface CodeStats {
  totalFiles: number; // source files (tests are counted separately)
  testFiles: number;
  totalLines: number; // lines in source files
  totalClasses: number;
  totalFunctions: number;
  totalInterfaces: number;
  avgComplexity: number; // mean cyclomatic complexity over source units
  issueCount: number;
  duplicateCount: number;
}
