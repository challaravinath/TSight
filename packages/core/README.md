# @tsight/core

The analysis engine behind [TSight](https://github.com/challaravinath/TSight). It reads a TypeScript or JavaScript project and its git history and returns facts: resolved imports, per-function complexity, dependency cycles, entry points, copied code, change hotspots and authorship. No AI, no estimates.

Most people want the `tsight` command instead. Use this package to build your own reports or checks.

```ts
import { analyzeProject, readGitHistory, buildSnapshot, analyzeDiff, diffToMarkdown } from '@tsight/core';

const result = await analyzeProject('/path/to/project');
const history = await readGitHistory(result.root);
const snapshot = buildSnapshot(result, history);

console.log(snapshot.stats.totalFiles, snapshot.cycleGroups.length);

const change = await analyzeDiff('/path/to/project', { base: 'main' });
console.log(diffToMarkdown(change));
```

The snapshot is the same JSON that `tsight analyze` prints. Files are listed once and referenced by index everywhere else. Its `schema` field goes up when the format changes in a way that breaks readers.

Documentation: [github.com/challaravinath/TSight](https://github.com/challaravinath/TSight/tree/main/docs). MIT licensed.
