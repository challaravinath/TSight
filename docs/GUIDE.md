# Using TSight

This guide walks through each screen and says where its numbers come from. For the short version, see the [README](README.md).

## The one thing to know

Any number with a dotted underline can be clicked. A panel opens on the right with the list behind it: the files, the import lines, the functions or the commits it was counted from. You can copy that list. If a number looks wrong, that list is where you find out why.

Press Esc to close the panel. Press Ctrl K (Cmd K on a Mac) anywhere to jump to a file by name.

## The bar under the header

"Resolved 4,272 of 4,275 project imports (99.9%)" is the first thing to check. Imports TSight couldn't resolve are left out of every count below it, so dependents and reach can be a little low near them. Click the unresolved count to see each one with its file and line. The usual causes are a path alias that only a bundler knows about, or a file that is generated during the build.

The same bar says how many entry points were found, and how much git history was read. A shallow clone is called out there, because people and co-change numbers only cover the commits that are present.

## Overview

**Riskiest file to change.** The file with the highest change hotspot score: commits in the last 90 days times the highest function complexity in the file. Under it you see how many files import it directly and how many it can reach through imports. Without git history this becomes the file with the most complex function.

**Knowledge held by one person.** Files with history where every commit came from the same person, and how many of those belong to someone with no commits in the last 6 months. This is the code that would be hardest to pick up if that person moved on.

**Files nothing imports.** Source files with no importers that no entry-point rule covers, and separately those that only tests import. Before you delete one, check whether something loads it by a path TSight can't see, such as a plugin folder, a script outside the project, or `import()` with a variable.

**Codebase map.** Every source file as a rectangle, sized by lines. Pick what the color shows:

- Change hotspot: under 80, 80 to 199, 200 to 499, 500 to 999, 1,000 and up.
- Dependents: under 4, 4 to 9, 10 to 24, 25 to 49, 50 and up.
- Single author: several authors, one active author, one author with no commits in 6 months.
- Complexity of the most complex function: under 8, 8 to 11, 12 to 19, 20 to 29, 30 and up.

A folder that is too small to show its files takes the color of the highest file inside it. Click a folder to zoom in and use the path above the map to go back out. The list next to the map ranks the files by the same measure.

**Dependency cycles, copied code, hidden coupling.** Counts with their lists. Hidden coupling is pairs of files that keep changing in the same commits but don't import each other. That usually means they share a format, a protocol or a convention that nothing in the code enforces.

## Files

A table of every source file. Turn on "Include test files" to see tests too. Click a column header to sort. Files marked "entry point" are started by something other than an import; hover the label to see which rule matched.

## File page

- The header says if the file is an entry point, part of an import loop, only used by tests, or only ever changed by one person.
- Lines, dependents, reach, highest complexity, commits in the last 90 days and the hotspot score. Click any of them for the list.
- Functions, most complex first. Callbacks written inline count toward the function they sit in. A callback at the top level of the file is listed as, for example, "app.get callback".
- History: everyone who changed the file and how many commits each made. People with no commits in the 6 months before the analysis are marked.
- Imported by, imports, and files that usually change together with this one.
- Packages it uses, the names it exports, and code it shares with other files.

## Dependencies

- Import loops, largest first, each with one shortest path around the loop. Click the file count for every file in the group.
- The most imported files. A change to one of these reaches the most code directly.
- Packages by the number of files that import them.
- Entry points grouped by the rule that found them. Add your own in `tsight.config.json`:

```json
{
  "entryPoints": ["src/plugins/*.ts", "scripts/**"]
}
```

The patterns work like `.gitignore` patterns, relative to the analyzed folder.

## People

Pick all time, the last 6 months or the last 3 months.

- Files changed in the period, and how many of those had one author only.
- With 6 or 3 months picked, the files nobody changed at all in that time.
- Each author with the files only they changed in the period, the source files they ever touched, and the date of their last commit.

Commits from authors whose name ends in `[bot]` are left out everywhere on this page, as are merge commits. Names are merged through `.mailmap` if the repository has one.

## Changes

Type a branch, tag or commit and press Compare. TSight finds where your work split off from it (the merge base), analyzes the code as it was there, analyzes your working copy, and compares the two.

- Reach: how many other files import the changed files, directly or through other files, and how many entry points are among them.
- Who knows this code: from `git blame` at the merge base, the people who wrote the lines your change touches.
- Complexity: the net change in function complexity across the changed files.
- New or larger dependency cycles: loops that exist after the change but not before, or got bigger.
- Changed files with their line counts, complexity before and after, and who wrote most of them.
- Usually changed with these: files that changed together with one of yours in past commits, but are not part of this change. Worth a look before you merge.

From the command line, `tsight diff main` prints the same thing as Markdown. With `--fail-on new-cycle` it exits with code 1 when the change adds a loop, which is what the GitHub Action uses.

## Reports

`tsight report` writes one HTML file with the whole UI and the analysis inside it. Add `--base main` to include the Changes page. The file loads nothing from the network, so it works from email, a shared drive or an air-gapped machine. It contains file paths, function names and author names from the project, so share it like you would share the code.

## Analyzing a repository from GitHub

On the open screen you can paste a public `https://github.com/owner/repo` URL. TSight clones it into a temporary folder with the full commit history but without old file contents, and removes it when you open something else. Renames aren't followed for these clones, because detecting them would mean downloading every old version of every file.

## The snapshot format

`tsight analyze` prints one JSON object, the same one the UI and reports read. Files are listed once and everything else refers to them by their position in that list, which keeps the output small. The `schema` field is 1 and will go up if the format changes in a way that breaks readers.
