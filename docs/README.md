# TSight

Understand any TypeScript codebase in 30 seconds.
No AI. No guessing. Just facts from your code.

TSight reads a TypeScript or JavaScript project and its git history, then answers the questions you have on day one: which files are risky to change, who knows which parts, what nothing uses any more, and what a change is going to touch. Every number on screen is a link. Click it and you get the exact list it was counted from, with file paths and line numbers.

It runs on your machine. Your code stays there.

![TSight overview](images/overview.png)

## Quick start

You need Node.js 20 or newer and git.

```bash
git clone https://github.com/challaravinath/TSight.git
cd TSight
npm install
npm run build
npx tsight /path/to/your/project
```

The browser opens at http://localhost:4300 with the analysis. On Mac or Linux you can also run `./start.sh /path/to/your/project`, and on Windows `start.bat C:\path\to\project`. Both install, build and start in one go.

## The command

```
tsight [path]                 Open the UI for a folder (default: the current folder)
tsight analyze [path]         Print the full analysis as JSON
tsight diff [base]            What your working copy changes compared with base (default: main)
tsight report [path]          Write one HTML file you can send to someone
```

Some examples:

```bash
tsight diff main                          # Markdown summary of your branch
tsight diff main --fail-on new-cycle      # exit code 1 if the change adds a dependency loop
tsight report . --base main --out report.html
tsight analyze . --out snapshot.json
```

The report is a single file with the UI and the data inside it. It opens offline, from email or a shared drive, and loads nothing from the internet.

## What you see

**Overview.** Three answers at the top. The riskiest file to change, the code only one person has worked on, and the files nothing imports. Below that, a map of the codebase: each rectangle is a file, sized by lines and colored by the measure you pick. Click a folder to go inside it.

**Files.** Every file with its lines, complexity, dependents and recent commits. Sort by any column.

**File page.** One file in detail: its functions, who changed it, what imports it, what it imports, the files that usually change together with it, and any code copied from or to it.

**Dependencies.** Import loops, the most imported files, packages, and the entry points TSight found.

**People.** Who changed what, for all time or the last 6 or 3 months.

**Changes.** What your branch touches compared with another branch. Same facts as `tsight diff`.

## How each number is worked out

**Imports.** Resolved the way the TypeScript compiler resolves them, with the nearest `tsconfig.json` for each file, including project references. That covers path aliases, `./file.js` written for ESM, re-exports, `import()`, `require()` and Vite's `import.meta.glob`. Workspace packages in a monorepo are matched to their source folders. The bar under the header says how many project imports resolved. Click the unresolved count to see the ones that didn't, because those links are missing from everything below.

**Dependents and reach.** Dependents are the files that import a file directly, tests included. Reach follows imports backwards until nothing new turns up.

**Complexity.** Cyclomatic complexity: 1, plus 1 for each `if`, `?:`, loop, `case`, `catch`, `&&`, `||` and `??`. An inline callback, like the one you pass to `map` or `useEffect`, counts toward the function it sits in. One at the top level of a file, like a route handler, is scored on its own.

**Change hotspots.** Commits in the 90 days before the analysis times the highest function complexity in the file. A file with 41 recent commits and a function of complexity 133 scores 5,453. Busy and hard to follow is where bugs tend to come from.

**Single author.** Files where every commit came from one person. If that person has no commits in the 6 months before the analysis, the file is marked as well.

**Changed together.** Pairs of files that were changed in the same commit at least 5 times, where at least 80% of the commits to the less-changed file also touched the other. Commits touching more than 30 files are skipped, since those are usually formatting or renames. A pair is called hidden when neither file imports the other.

**Dependency cycles.** Groups of files that import each other in a loop, from a strongly connected components search. Type-only imports and `import()` are left out, because they can't cause load-order problems.

**Copied code.** Files or functions that are the same once whitespace and comments are ignored, and pairs of functions with the same structure where only names or literal values differ. Functions under 80 syntax nodes are not compared.

**Files nothing imports.** Source files that no file imports and no entry-point rule covers. TSight says "nothing imports" rather than "unused", because a file can still be loaded in a way it can't see.

**Entry points.** Files started by something other than an import: `package.json` (`main`, `exports`, `bin`, scripts), HTML `<script>` tags, `wrangler` config, test setup files, GitHub workflows, files in `public/`, Next.js conventions, tool config files and tests. If your project loads files some other way, list them in `tsight.config.json` at the project root:

```json
{
  "entryPoints": ["src/plugins/*.ts", "scripts/**"]
}
```

**Git history.** Read from the local `.git` folder in one pass, with no token or network access. Names go through `.mailmap`, files keep their history through renames, and merge commits are skipped. Commits from bots (authors ending in `[bot]`) don't count toward people or change pairs. In a shallow clone TSight says so, because authorship and co-change counts only cover the history that is there. The oldest commit of a shallow clone is left out, since git shows it as adding every file at once.

**Which files are analyzed.** In a git repository, the files git tracks plus new files that aren't ignored. Outside git, every file except those in `.gitignore` and folders like `dist` and `node_modules`. Declaration files (`.d.ts`) are skipped.

## Pull request reports

Add this workflow to a repository and every pull request gets a comment with what it touches: how many files depend on the changed code, who wrote the lines being changed, files that usually change with these but were left out, and any new dependency loop. The comment is updated on each push.

```yaml
name: TSight
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: challaravinath/TSight@main
        with:
          fail-on: new-cycle   # optional
```

TSight needs the history back to where the branch split off, and the authors of the lines being changed. If the checkout is shallow, the action fetches the full history itself, which takes a little longer; `fetch-depth: 0` saves that step. The same report is also written to the job summary, so it shows up for pull requests from forks too, where the comment can't be posted.

## What it doesn't do

- It doesn't guess what a file is for from its name. Folders are shown as folders.
- It doesn't give a single health grade. You get the counts behind it instead.
- It doesn't send your code anywhere.
- It reads code, it doesn't run it. Anything decided at runtime, such as `import(someVariable)`, isn't followed.

## Docker

```bash
docker build -t tsight .
docker run -p 127.0.0.1:3000:3000 -v "/path/to/your/code:/code" tsight
```

Open http://localhost:3000 and enter a path under `/code`, for example `/code/my-project`.

The command above only lets your own computer reach TSight. There is no login, so anyone who can reach it can read the analysis of everything under `/code`. If you still want to open it from another machine, publish the port with `-p 3000:3000` and add that machine's address with `-e TSIGHT_ALLOWED_HOSTS=192.168.1.20`.

## Working on TSight

```bash
npm install
npm run build
npm test
```

During development, `npm run dev` starts the API on port 3001 and the UI with hot reload on port 3000. Both rebuild when you save.

To check the numbers against three real repositories pinned to exact commits, run `TSIGHT_CORPUS=1 npm test`. It clones about 150 MB the first time, so it isn't part of the normal run.

The code is in four packages:

- `packages/core`: the analysis. Everything that produces a number lives here, with tests in `packages/core/test`.
- `packages/api`: a small server that runs the analysis in a worker thread.
- `packages/web`: the React UI. It reads one snapshot and computes the rest in the browser.
- `packages/cli`: the `tsight` command.

More detail on each screen is in the [guide](GUIDE.md).

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](../CONTRIBUTING.md) for how to set up and what a change needs, and [CHANGELOG.md](../CHANGELOG.md) for what changed in each release. Please report security problems privately, as described in [SECURITY.md](../SECURITY.md).

## License

MIT
