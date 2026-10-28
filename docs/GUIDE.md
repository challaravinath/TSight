# Using TSight

This guide walks through each screen and explains where its numbers come from. For the short version, see the [README](README.md).

## Overview

The first line tells you how many imports of project code TSight resolved, for example "Resolved 4,272 of 4,275 project imports (99.9%)". Check it first. If it's well below 100%, the unresolved imports are listed in the API response (`/api/overview`, field `resolution.unresolvedImports`). Every number that depends on imports is missing those links.

Below that are the counts that matter most: dependency cycle groups, duplicate files, files over 500 lines, and functions with a complexity over 15. Click one to see the files.

The stat cards count source files only. Test files (`*.test.*`, `*.spec.*`, and anything under `__tests__`, `test`, `tests` or `e2e`) are analyzed but counted separately, so they don't skew averages.

### Dependency insights

- **Core files**: imported by 5 or more source files.
- **Hotspots**: total complexity of the file times the number of source files that import it. A file is listed when its complexity is at least 10 and at least 3 files import it. A score of 500 or more is marked critical, 200 or more high.
- **Isolated files**: source files with no project imports in either direction and no entry-point rule.
- **Circular deps**: groups of files that import each other at runtime.
- **Large files**: over 500 lines, more than 10 exports, more than 20 functions or more than 3 classes.

## Issues

**Exact duplicates.** Files with identical code once whitespace and comments are ignored. Files shorter than 40 tokens are skipped, because tiny stubs are often identical on purpose.

**Code issues.** Cycles, plus functions with complexity over 10, more than 50 lines or more than 5 parameters. Complexity over 20 is marked as an error.

**Structural twins.** Functions whose syntax trees are identical once names and literal values are ignored. Each pair lists what else matches: statement count, parameter count, literal values and names. If names and values both match, the function was copied as is. Functions under 80 syntax nodes aren't compared.

**Potentially unused.** Source files that nothing imports and no entry-point rule covers, plus files that only tests import. Before you delete one, check whether something loads it by a path TSight can't see, such as a plugin system, a script outside the project, or a dynamic import built from a variable.

## Git insights

History comes from the local `.git` folder in one pass. Merge commits are skipped, `.mailmap` is applied, and files keep their history through renames. Deleted files are left out. If you analyze a subfolder, only that folder's history is used.

**Churn.** Commits per file in the last 90 days.

**Ownership.** Commits per author for each file. With a time filter (last 6 or 3 months), the owner is worked out from commits in that window only.

**Knowledge gaps.** With a time filter on, these are the files with no commits in that window. They're the parts of the code nobody on the current team has touched recently.

**Bus factor.** Files where every commit in the window came from one person, grouped by that person. The percentage is single-author files divided by files with any commits in the window.

For a repository cloned from GitHub through TSight, the full commit history is fetched, but renames aren't followed. Detecting them would mean downloading every old version of every file.

## File panel

Click any file to open it. You'll see:

- A summary built from facts: what it exports, how many files import it, and what it imports. If an entry-point rule covers the file, the panel names the rule.
- Its functions with their complexity.
- The files it imports and the files that import it, with the line of each import.
- **Blast radius**: every file that can be affected by a change, level by level. Level 1 imports the file directly. Level 2 imports a level 1 file, and so on, with no depth limit.

## Export

Export PBI downloads the analysis as JSON tables (files, functions, classes, imports, issues) that you can load into Power BI or any other tool.
