#!/usr/bin/env node
/**
 * tsight: the command line.
 *
 *   tsight [path]                   open the UI for a folder (default: here)
 *   tsight analyze [path]           write the snapshot as JSON
 *   tsight diff [base]              what the working copy changes compared with base
 *   tsight report [path]            write a single HTML file you can share
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { parseArgs } from 'util';
import { fileURLToPath } from 'url';
import { analyzeProject, readGitHistory, buildSnapshot, analyzeDiff, diffToMarkdown, type DiffReport, type Snapshot } from '@tsight/core';
import { createServer } from '@tsight/api';

const here = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(path.join(here, '../package.json'), 'utf8')).version as string;

const HELP = `tsight ${VERSION}
Understand any TypeScript codebase in 30 seconds. No AI. No guessing. Just facts from your code.

Usage
  tsight [path]                 Open the TSight UI for a folder (default: the current folder)
      --port <n>                Port to use (default 4300)
      --no-open                 Do not open a browser
      --pick                    Start without analyzing and choose a folder in the browser

  tsight analyze [path]         Write the analysis snapshot as JSON
      --out <file>              Write to a file instead of standard output

  tsight diff [base]            Show what the working copy changes compared with base (default: main)
      --path <dir>              Folder to analyze (default: the current folder)
      --head <ref>              Compare base with this ref instead of the working copy
      --format markdown|json    Output format (default: markdown)
      --out <file>              Write to a file instead of standard output
      --fail-on <list>          Exit with code 1 when the change adds any of: new-cycle

  tsight report [path]          Write a single HTML file with the full report
      --out <file>              Output file (default: tsight-report.html)
      --base <ref>              Also include what the working copy changes compared with this ref

  tsight --version | --help
`;

function fail(message: string): never {
  process.stderr.write(`tsight: ${message}\n`);
  process.exit(2);
}

function writeOut(text: string, out?: string) {
  if (out) {
    fs.writeFileSync(out, text);
    process.stderr.write(`Wrote ${out}\n`);
  } else {
    process.stdout.write(text.endsWith('\n') ? text : text + '\n');
  }
}

async function snapshotFor(dir: string): Promise<Snapshot> {
  const log = (m: string) => process.stderr.write(`  ${m}\n`);
  const result = await analyzeProject(dir, { log });
  const history = await readGitHistory(result.root).catch(() => null);
  return buildSnapshot(result, history, { version: VERSION });
}

function webDir(): string {
  const candidates = [path.join(here, 'web'), path.join(here, '../../web/dist')];
  const found = candidates.find((c) => fs.existsSync(path.join(c, 'index.html')));
  if (!found) fail('The web UI is not built. Run npm run build first.');
  return found;
}

function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  execFile(cmd, args, () => {}); // if it fails, the URL is printed anyway
}

/** One HTML file: the built UI with its scripts and styles inlined, and the data embedded. */
function buildReport(snapshot: Snapshot, diff: DiffReport | null): string {
  const dir = webDir();
  let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  // Escape characters that could end the <script> tag or break a JS string.
  const LS = new RegExp(String.fromCharCode(0x2028), 'g');
  const PS = new RegExp(String.fromCharCode(0x2029), 'g');
  const safe = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(LS, '\\u2028').replace(PS, '\\u2029');
  html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_m, src: string) => {
    const js = fs.readFileSync(path.join(dir, src.replace(/^\//, '')), 'utf8').replace(/<\/script/gi, '<\\/script');
    return `<script type="module">${js}</script>`;
  });
  html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_m, href: string) => {
    const css = fs.readFileSync(path.join(dir, href.replace(/^\//, '')), 'utf8');
    return `<style>${css}</style>`;
  });
  const data = `<script>window.__TSIGHT_SNAPSHOT__=${safe(snapshot)};window.__TSIGHT_DIFF__=${safe(diff)};</script>`;
  // A function, so that $ sequences in the data are not read as replacement patterns.
  return html.replace('</head>', () => `${data}\n</head>`);
}

async function main() {
  const argv = process.argv.slice(2);
  const commands = ['analyze', 'diff', 'report'];
  const command = commands.includes(argv[0]) ? argv[0] : 'open';
  const rest = command === 'open' ? argv : argv.slice(1);

  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      port: { type: 'string' },
      'no-open': { type: 'boolean' },
      pick: { type: 'boolean' },
      out: { type: 'string' },
      path: { type: 'string' },
      head: { type: 'string' },
      base: { type: 'string' },
      format: { type: 'string' },
      'fail-on': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  if (values.help) return void process.stdout.write(HELP);
  if (values.version) return void process.stdout.write(`${VERSION}\n`);

  if (command === 'open') {
    const dir = path.resolve(positionals[0] ?? '.');
    if (!fs.existsSync(dir)) fail(`No such folder: ${dir}`);
    const port = values.port ? Number(values.port) : 4300;
    if (!Number.isInteger(port) || port < 0 || port > 65535) fail('--port must be a number between 0 and 65535');
    const server = createServer({ port, webDir: webDir(), initialPath: values.pick ? undefined : dir, version: VERSION, log: (m) => process.stderr.write(`${m}\n`) });
    const { url } = await server.start();
    process.stderr.write(`\nTSight ${VERSION} is running at ${url}\nPress Ctrl+C to stop.\n\n`);
    if (!values['no-open']) openBrowser(url);
    return;
  }

  if (command === 'analyze') {
    const snapshot = await snapshotFor(path.resolve(positionals[0] ?? '.'));
    writeOut(JSON.stringify(snapshot), values.out);
    return;
  }

  if (command === 'diff') {
    const base = positionals[0] ?? 'main';
    const format = values.format ?? 'markdown';
    if (format !== 'markdown' && format !== 'json') fail('--format must be markdown or json');
    const failOn = new Set((values['fail-on'] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    for (const f of failOn) if (f !== 'new-cycle') fail(`Unknown --fail-on value: ${f}. Supported: new-cycle`);
    const report = await analyzeDiff(path.resolve(values.path ?? '.'), {
      base,
      head: values.head,
      log: (m) => process.stderr.write(`  ${m}\n`),
    });
    writeOut(format === 'json' ? JSON.stringify(report, null, 2) : diffToMarkdown(report), values.out);
    if (failOn.has('new-cycle') && report.newCycles.length > 0) {
      process.stderr.write(`tsight: this change adds ${report.newCycles.length} dependency cycle group(s)\n`);
      process.exit(1);
    }
    return;
  }

  if (command === 'report') {
    const dir = path.resolve(positionals[0] ?? '.');
    const snapshot = await snapshotFor(dir);
    const diff = values.base ? await analyzeDiff(dir, { base: values.base }) : null;
    const out = values.out ?? 'tsight-report.html';
    fs.writeFileSync(out, buildReport(snapshot, diff));
    process.stderr.write(`Wrote ${out}\n`);
  }
}

main().catch((e: unknown) => fail((e as Error).message ?? String(e)));
