# Changelog

All notable changes to TSight. Versions follow [semantic versioning](https://semver.org): a change to the snapshot format or the command line options that breaks existing use goes in a new major version.

## 3.0.2 (2026-10-28)

### Changed
- The GitHub Action and CI workflows use `actions/checkout` and `actions/setup-node` v7.
- The packages depend on each other at `^3.0.2`.

## 3.0.1 (2026-10-28)

### Fixed
- The `tsight` command no longer reads the analyzed project's `.env` file. Only the standalone server does.

## 3.0.0 (2026-10-28)

### New
- A new web UI. The overview answers three questions first: which file is riskiest to change, which code only one person knows, and which files nothing imports. A codebase map shows every file sized by lines and colored by the measure you pick, and you can click a folder to zoom in.
- Pages for Files, each file, Dependencies, People and Changes.
- Every underlined number opens the list it was counted from, with file paths and line numbers.
- The `tsight` command: `tsight [folder]`, `tsight analyze`, `tsight diff` and `tsight report`.
- `tsight report` writes one HTML file that works offline.
- A GitHub Action that comments on pull requests with what they touch, and can fail the check when a change adds an import loop.
- Change hotspots: commits in the last 90 days times the most complex function in the file.
- Files that change together, including pairs with no import between them.
- More entry points: wrangler config, test setup files, GitHub workflows, `public/`, `import.meta.glob`, and an `entryPoints` list in `tsight.config.json`.
- Light and dark themes, keyboard search with Ctrl K, and a layout that works on phones.

### Changed
- Analysis runs in a worker thread, so the server stays responsive on large projects.
- One versioned snapshot format (schema 1) feeds the UI, reports and the command line.
- Commits from bots (authors ending in `[bot]`) no longer count toward people or change pairs.
- In a shallow clone, the oldest commit no longer credits one person with every file.
- The default port for `tsight` is 4300.

### Removed
- The old single-page UI and its `/api/overview` style endpoints. The server now serves `/api/status`, `/api/analyze`, `/api/snapshot` and `/api/diff`.
- The Power BI export. `tsight analyze` prints the same data as one JSON file.

## Before 3.0.0

The engine rewrite merged in October 2026 replaced estimates with exact facts. Imports are resolved the way the TypeScript compiler does, complexity is scored per function, cycles come from a strongly connected components search, and git history is read in one pass with renames followed. Earlier work hardened the API server against path traversal and split the analyzer into stages.
