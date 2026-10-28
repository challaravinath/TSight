# TSight

Understand any TypeScript codebase in 30 seconds. No AI. No guessing. Just facts from your code.

TSight reads a TypeScript or JavaScript project and its git history, then shows which files are risky to change, which code only one person knows, what nothing imports any more, and what a change is going to touch. Every number links to the exact list it was counted from, with file paths and line numbers.

It runs on your machine. Your code stays there.

## Try it

In any project folder (Node.js 20 or newer):

```bash
npx tsight
```

Your browser opens with the analysis.

## Commands

```
tsight [path]                 Open the UI for a folder (default: the current folder)
tsight analyze [path]         Print the full analysis as JSON
tsight diff [base]            What your working copy changes compared with base (default: main)
tsight report [path]          Write one HTML file you can send to someone
```

```bash
tsight diff main                          # Markdown summary of your branch
tsight diff main --fail-on new-cycle      # exit code 1 if the change adds an import loop
tsight report . --base main --out report.html
```

The report is a single file that opens offline and loads nothing from the internet.

## Pull request reports

TSight can comment on every pull request with what it touches. See the [GitHub Action setup](https://github.com/challaravinath/TSight/tree/main/docs#pull-request-reports).

## More

How each number is worked out, and a guide to every screen: [github.com/challaravinath/TSight](https://github.com/challaravinath/TSight/tree/main/docs)

MIT licensed.
