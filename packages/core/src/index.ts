/**
 * TSight Core
 * 
 * TypeScript code analysis engine
 */

export * from './types.js';
export { Analyzer } from './analyzer.js';

// Re-export commonly used types explicitly for convenience
export type {
  AnalysisResult,
  StructuralTwin,
  StructuralSignature,
  SimilarityCriterion,
} from './types.js';
