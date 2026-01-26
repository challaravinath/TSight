/**
 * TSight Core Types
 */

// ============================================================================
// FILE & STRUCTURE
// ============================================================================

export interface FileInfo {
  path: string;
  name: string;
  extension: string;
  folder: string;
  lines: number;
  size: number;
}

export interface FolderInfo {
  path: string;
  name: string;
  fileCount: number;
  totalLines: number;
  children: string[];  // subfolder names
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

export interface FunctionInfo extends CodeElement {
  type: 'function';
  parameters: ParameterInfo[];
  returnType: string;
  async: boolean;
  complexity: number;
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
  type: string;
  optional: boolean;
  visibility?: 'public' | 'private' | 'protected';
}

export interface ParameterInfo {
  name: string;
  type: string;
  optional: boolean;
  defaultValue?: string;
}

// ============================================================================
// DEPENDENCIES & RELATIONSHIPS
// ============================================================================

export interface ImportInfo {
  from: string;       // file that imports
  to: string;         // module being imported (can be file or package)
  imports: string[];  // what's imported (named imports)
  isExternal: boolean;
  line: number;
}

export interface Dependency {
  source: string;     // file path
  target: string;     // file path
  type: 'import' | 'extends' | 'implements' | 'calls';
  weight: number;     // how many times
}

export interface DependencyGraph {
  nodes: string[];    // file paths
  edges: Dependency[];
  circular: string[][]; // groups of circular deps
}

// ============================================================================
// MENTAL MODEL
// ============================================================================

export interface Layer {
  name: string;
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
  from: string;  // layer or component
  to: string;
  label: string;
  count: number; // number of actual imports
}

// ============================================================================
// ISSUES & HEALTH
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
  items: Array<{
    file: string;
    name: string;
    line: number;
  }>;
  similarity: number; // 0-100
}

// ============================================================================
// STRUCTURAL SIMILARITY (Honest Detection)
// ============================================================================

/**
 * A criterion we check when comparing two functions.
 * Each criterion is factual and verifiable.
 */
export interface SimilarityCriterion {
  name: string;           // e.g., "Parameter count"
  description: string;    // e.g., "Both functions take 3 parameters"
  valueA: string;         // e.g., "3"
  valueB: string;         // e.g., "3"
  matched: boolean;
}

/**
 * Structural signature extracted from a function's AST.
 * Everything here is factual — derived from actual code parsing.
 */
export interface StructuralSignature {
  // Identity
  file: string;
  name: string;
  line: number;
  
  // Signature facts
  paramCount: number;
  paramTypes: string[];      // Simplified types: ['string', 'object', 'number']
  returnType: string;        // Simplified: 'Promise', 'void', 'object', etc.
  isAsync: boolean;
  
  // Body structure facts
  statementCount: number;    // Number of top-level statements in body
  controlFlowPattern: string; // e.g., "if-try-catch-return" 
  hasLoop: boolean;
  hasTryCatch: boolean;
  hasConditional: boolean;
  
  // Detected patterns (factual observations)
  patterns: string[];        // ['guard-clause', 'api-call', 'error-rethrow']
}

/**
 * A pair of functions that are structurally similar.
 * We show exactly WHY they matched — no black-box scores.
 */
export interface StructuralTwin {
  functionA: {
    file: string;
    name: string;
    line: number;
  };
  functionB: {
    file: string;
    name: string;
    line: number;
  };
  
  // Explicit criteria breakdown — show our work
  criteria: SimilarityCriterion[];
  matchedCount: number;      // e.g., 6
  totalCount: number;        // e.g., 8
  
  // Human-readable verdict (not a percentage)
  verdict: 'structural-twin' | 'similar-shape' | 'worth-reviewing';
  
  // Brief explanation
  summary: string;           // e.g., "Same signature, same control flow, different names"
}

export interface ComplexityScore {
  file: string;
  element: string;
  line: number;
  score: number;
  reasons: string[];
}

// ============================================================================
// ANALYSIS RESULT
// ============================================================================

export interface AnalysisResult {
  // Meta
  analyzedAt: Date;
  duration: number;  // ms
  
  // Structure
  files: FileInfo[];
  folders: FolderInfo[];
  languages: LanguageBreakdown[];
  
  // Code Elements
  classes: ClassInfo[];
  functions: FunctionInfo[];
  interfaces: InterfaceInfo[];
  
  // Dependencies
  imports: ImportInfo[];
  dependencyGraph: DependencyGraph;
  externalPackages: PackageUsage[];
  
  // Mental Model
  mentalModel: MentalModel;
  
  // Health
  issues: CodeIssue[];
  duplicates: DuplicateGroup[];
  complexity: ComplexityScore[];
  
  // Structural Similarity (honest detection)
  structuralTwins: StructuralTwin[];
  
  // Stats
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
  usedIn: string[];  // files that import it
}

export interface CodeStats {
  totalFiles: number;
  totalLines: number;
  totalClasses: number;
  totalFunctions: number;
  totalInterfaces: number;
  avgComplexity: number;
  issueCount: number;
  duplicateCount: number;
}
