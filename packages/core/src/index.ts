/**
 * TSight core: analysis engine for TypeScript and JavaScript projects.
 */
export * from './types.js';
export { Analyzer, analyzeProject, type AnalyzeOptions } from './analyzer.js';
export {
  computeHotspots,
  blastRadius,
  computeInsights,
  fileDetail,
  unusedExports,
  codebaseFacts,
  sourceDependents,
  type DependencyInsights,
} from './views.js';
export {
  readGitHistory,
  parseLog,
  churn,
  ownership,
  busFactor,
  staleFiles,
  windowStart,
  type GitHistory,
  type GitCommit,
  type TimeWindow,
} from './git.js';
