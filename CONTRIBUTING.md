# Contributing to TSight

Thanks for helping. TSight has one rule that shapes every change: every number it shows must be a fact you can check. No estimates, no scores without a formula, no AI.

## Getting started

You need Node.js 20 or newer and git.

```bash
git clone https://github.com/challaravinath/TSight.git
cd TSight
npm install
npm run build
npm test
```

`npm run dev` starts the API on port 3001 and the UI with hot reload on port 3000.

## Where things live

- `packages/core`: the analysis. Anything that produces a number belongs here, with a test in `packages/core/test`.
- `packages/api`: the server. It runs the analysis in a worker thread.
- `packages/web`: the React UI. It reads one snapshot and works out the rest in the browser.
- `packages/cli`: the `tsight` command.

## Making a change

1. Open an issue first for anything bigger than a small fix, so we can agree on the approach.
2. If you change how a number is calculated, add a test that shows the case your change fixes.
3. If the UI shows a new number, it needs a list behind it that the reader can open.
4. Run `npm run build`, `npm run typecheck` and `npm test` before you open the pull request.
5. To check the numbers against real projects, run `TSIGHT_CORPUS=1 npm test`. It clones about 150 MB the first time.

## Writing

Text in the UI, the docs and the command line should be plain and direct. Say what something is and how it was worked out. Avoid marketing words, and keep the tone of a helpful colleague.

## Pull requests

Every pull request gets a comment from TSight itself, showing what the change touches. If it reports a new dependency cycle, the check fails; fix the cycle or explain in the pull request why it is fine.

## Releases

1. Set the new version everywhere with `npm version 3.1.0 --workspaces --include-workspace-root --no-git-tag-version`, and add a section for it at the top of CHANGELOG.md. For a new major version, also update the `@tsight/core` and `@tsight/api` versions listed under `dependencies` in the other packages. Merge that as a pull request.
2. Tag the merge on `main` and push the tag: `git tag v3.1.0` then `git push origin v3.1.0`.
3. The release workflow runs the tests and creates the GitHub release, with a sample report attached.

TSight isn't published to npm.

### Testing the release process

A version with a hyphen, like `3.0.2-rc.0`, is a test release. The GitHub release is marked as a pre-release, and it doesn't need a changelog section. Tag it from a branch so `main` keeps the real version.
