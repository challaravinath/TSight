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
export { changeHotspots, coChanges, MAX_FILES_PER_COMMIT, type ChangeHotspot, type CoChange, type CoChangeOptions } from './behavior.js';
export { analyzeDiff, diffToMarkdown, parseNameStatus, parseNumstat, type DiffReport, type DiffFile } from './diff.js';
export { buildSnapshot, SNAPSHOT_SCHEMA, type Snapshot, type SnapshotFile, type SnapshotImport, type SnapshotFunction, type SnapshotGitFile } from './snapshot.js';
