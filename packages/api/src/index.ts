/**
 * TSight API server.
 *
 * A thin HTTP layer over @tsight/core. Every number in a response comes
 * from core, so the same snapshot always gives the same answers.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { simpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import {
  analyzeProject,
  computeInsights,
  blastRadius,
  fileDetail,
  unusedExports,
  codebaseFacts,
  readGitHistory,
  churn,
  ownership,
  busFactor,
  staleFiles,
  type AnalysisResult,
  type GitHistory,
  type TimeWindow,
} from '@tsight/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '127.0.0.1';

// ============================================================================
// INPUT CHECKS AND LIMITS
// ============================================================================

// If set, every analyze target must resolve inside this directory.
// Docker sets it to /code. Locally it can be unset: the server binds to
// 127.0.0.1 and only accepts the origins below.
const WORKSPACE_ROOT = process.env.TSIGHT_WORKSPACE_ROOT ? path.resolve(process.env.TSIGHT_WORKSPACE_ROOT) : null;

// Only plain https GitHub URLs can be cloned. This rules out ssh, scp-style
// and the ext:: transport, which has allowed command execution before.
const GITHUB_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/;

const CLONE_TIMEOUT_MS = 120_000;
const CLONE_TMP_ROOT = path.join(os.tmpdir(), 'tsight-repos');
const CLONE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const ALLOWED_ORIGINS = (process.env.TSIGHT_CORS_ORIGIN || 'http://localhost:3000,http://localhost:3001')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function validateProjectPath(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) {
    throw new Error('path must be a non-empty string');
  }
  const resolved = path.resolve(input);
  if (!fs.existsSync(resolved)) throw new Error('Path does not exist');
  if (!fs.statSync(resolved).isDirectory()) throw new Error('Path must be a directory');
  if (WORKSPACE_ROOT) {
    const real = fs.realpathSync(resolved);
    const rootReal = fs.realpathSync(WORKSPACE_ROOT);
    const rel = path.relative(rootReal, real);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
      throw new Error('Path is outside the configured workspace root');
    }
  }
  return resolved;
}

function validateGitHubUrl(input: unknown): string {
  if (typeof input !== 'string' || !GITHUB_URL_RE.test(input)) {
    throw new Error('url must be an https://github.com/{owner}/{repo} URL');
  }
  return input;
}

function clampInt(input: unknown, min: number, max: number, fallback: number): number {
  const n = parseInt(String(input ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function timeWindow(input: unknown): TimeWindow {
  return input === '6months' || input === '3months' ? input : 'all';
}

function cleanupOldClones(): void {
  try {
    if (!fs.existsSync(CLONE_TMP_ROOT)) return;
    const cutoff = Date.now() - CLONE_MAX_AGE_MS;
    for (const name of fs.readdirSync(CLONE_TMP_ROOT)) {
      const p = path.join(CLONE_TMP_ROOT, name);
      try {
        if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  } catch {
    // best effort
  }
}

// ============================================================================
// APP SETUP
// ============================================================================

if (process.env.NODE_ENV === 'production') {
  const webPath = path.join(__dirname, '../../web/dist');
  if (fs.existsSync(webPath)) app.use(express.static(webPath));
}

// Host names the server answers to. Checking the Host header blocks DNS
// rebinding, where a web page re-points its own domain at 127.0.0.1 and
// then reads this API as if it were same-origin. Add names (for example a
// LAN address when running in Docker) with TSIGHT_ALLOWED_HOSTS.
const ALLOWED_HOSTS = new Set(
  ['localhost', '127.0.0.1', '[::1]', '::1', ...(process.env.TSIGHT_ALLOWED_HOSTS || '').split(',')]
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

function hostnameOf(hostHeader: string | undefined): string {
  if (!hostHeader) return '';
  const h = hostHeader.toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0];
}

app.use((req, res, next) => {
  if (!ALLOWED_HOSTS.has(hostnameOf(req.headers.host))) {
    return res.status(403).json({ success: false, error: 'Host not allowed. Set TSIGHT_ALLOWED_HOSTS to add it.' });
  }
  next();
});

app.use(
  cors((req, cb) => {
    const origin = req.headers.origin;
    let allowed = !origin || ALLOWED_ORIGINS.includes(origin);
    if (!allowed && origin) {
      // The page this server serves itself (any port, e.g. Docker's -p 8080:3000).
      try {
        allowed = new URL(origin).host.toLowerCase() === String(req.headers.host).toLowerCase();
      } catch {
        allowed = false;
      }
    }
    if (!allowed) return cb(new Error('Origin not allowed'));
    cb(null, { origin: true });
  }),
);
app.use(express.json({ limit: '256kb' }));

// ============================================================================
// STATE
// ============================================================================

interface Current {
  project: { path: string; name: string; status: string };
  analysis: AnalysisResult;
  history?: Promise<GitHistory>;
}

let current: Current | null = null;
let runId = 0; // a newer analyze request wins over an older one still running

function requireAnalysis(res: express.Response): Current | null {
  if (!current) {
    res.status(404).json({ success: false, error: 'No analysis available' });
    return null;
  }
  return current;
}

async function history(c: Current): Promise<GitHistory> {
  if (!c.history) c.history = readGitHistory(c.analysis.root);
  return c.history;
}

async function runAnalysis(projectPath: string, name: string) {
  const id = ++runId;
  const analysis = await analyzeProject(projectPath, { log: (m) => console.log(`   ${m}`) });
  if (id !== runId) throw new Error('A newer analysis was started');
  current = { project: { path: projectPath, name, status: 'ready' }, analysis };
  return current;
}

const sourceFiles = (a: AnalysisResult) => a.files.filter((f) => f.role === 'source').map((f) => f.path);

// ============================================================================
// ANALYZE
// ============================================================================

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', project: current?.project ?? null, hasAnalysis: current !== null });
});

app.post('/api/analyze', async (req, res) => {
  let projectPath: string;
  try {
    projectPath = validateProjectPath(req.body?.path);
  } catch (e) {
    return res.status(400).json({ success: false, error: (e as Error).message });
  }
  try {
    console.log(`Analyzing ${projectPath}`);
    const c = await runAnalysis(projectPath, path.basename(projectPath));
    res.json({ success: true, project: c.project, stats: c.analysis.stats, resolution: c.analysis.resolution });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * Clone and analyze a GitHub repository. The clone keeps the full commit
 * history (git insights need it) but downloads old file contents only on
 * demand, which keeps it fast.
 */
app.post('/api/analyze/github', async (req, res) => {
  let url: string;
  try {
    url = validateGitHubUrl(req.body?.url);
  } catch (e) {
    return res.status(400).json({ success: false, error: (e as Error).message });
  }

  const repoName = url.replace(/\/$/, '').replace(/\.git$/, '').split('/').pop() || 'repo';
  fs.mkdirSync(CLONE_TMP_ROOT, { recursive: true });
  const tempDir = path.join(CLONE_TMP_ROOT, `${repoName}-${Date.now()}`);

  try {
    console.log(`Cloning ${url}`);
    const git = simpleGit({ timeout: { block: CLONE_TIMEOUT_MS } });
    await git.clone(url, tempDir, ['--filter=blob:none', '--no-tags', '--single-branch']);
    const c = await runAnalysis(tempDir, repoName);
    res.json({ success: true, project: c.project, stats: c.analysis.stats, resolution: c.analysis.resolution });
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// ============================================================================
// STRUCTURE
// ============================================================================

app.get('/api/analysis', (_req, res) => {
  const c = requireAnalysis(res);
  if (c) res.json({ success: true, data: c.analysis });
});

app.get('/api/overview', (_req, res) => {
  const c = requireAnalysis(res);
  if (!c) return;
  const a = c.analysis;
  res.json({
    success: true,
    project: c.project,
    stats: a.stats,
    languages: a.languages,
    mentalModel: a.mentalModel,
    resolution: a.resolution,
    entryPoints: a.entryPoints,
    issues: a.issues.slice(0, 10),
    duplicates: a.duplicates.slice(0, 5),
  });
});

app.get('/api/files', (_req, res) => {
  const c = requireAnalysis(res);
  if (c) res.json({ success: true, files: c.analysis.files, folders: c.analysis.folders });
});

app.get('/api/dependencies', (_req, res) => {
  const c = requireAnalysis(res);
  if (c) {
    res.json({
      success: true,
      graph: c.analysis.dependencyGraph,
      externalPackages: c.analysis.externalPackages,
      resolution: c.analysis.resolution,
    });
  }
});

app.get('/api/issues', (_req, res) => {
  const c = requireAnalysis(res);
  if (c) {
    res.json({ success: true, issues: c.analysis.issues, duplicates: c.analysis.duplicates, complexity: c.analysis.complexity });
  }
});

app.get('/api/structural-twins', (_req, res) => {
  const c = requireAnalysis(res);
  if (!c) return;
  res.json({
    success: true,
    structuralTwins: c.analysis.structuralTwins,
    count: c.analysis.structuralTwins.length,
    total: c.analysis.structuralTwinStats.pairsFound,
    functionsCompared: c.analysis.structuralTwinStats.functionsCompared,
    explanation: {
      what: 'Functions whose code is the same once variable names and literal values are ignored.',
      how: 'Each function is turned into its syntax tree with names and values removed. Functions with identical trees are paired.',
      why: 'These are usually copies. Each pair says whether the names and values also match.',
      disclaimer: 'Read both functions before merging them. Small functions (under 80 syntax nodes) are not compared.',
    },
  });
});

app.get('/api/search', (req, res) => {
  const c = requireAnalysis(res);
  if (!c) return;
  const rawQuery = typeof req.query.q === 'string' ? req.query.q : '';
  const query = rawQuery.slice(0, 200).toLowerCase();
  if (!query) return res.status(400).json({ success: false, error: 'Query parameter q is required' });

  const a = c.analysis;
  const results: unknown[] = [];
  for (const cls of a.classes) if (cls.name.toLowerCase().includes(query)) results.push({ resultType: 'class', ...cls });
  for (const fn of a.functions) if (fn.name.toLowerCase().includes(query)) results.push({ resultType: 'function', ...fn });
  for (const i of a.interfaces) if (i.name.toLowerCase().includes(query)) results.push({ resultType: 'interface', ...i });
  for (const f of a.files) if (f.path.toLowerCase().includes(query)) results.push({ resultType: 'file', ...f });

  res.json({ success: true, query, results: results.slice(0, 50), total: results.length });
});

app.get('/api/insights', (_req, res) => {
  const c = requireAnalysis(res);
  if (c) res.json({ success: true, insights: computeInsights(c.analysis) });
});

app.get('/api/blast-radius/:filePath(*)', (req, res) => {
  const c = requireAnalysis(res);
  if (!c) return;
  const br = blastRadius(c.analysis, req.params.filePath);
  if (!br) return res.status(404).json({ success: false, error: 'File not found in this analysis' });
  res.json({ success: true, blastRadius: br });
});

app.get('/api/file/:filePath(*)', (req, res) => {
  const c = requireAnalysis(res);
  if (!c) return;
  const detail = fileDetail(c.analysis, req.params.filePath);
  if (!detail) return res.status(404).json({ success: false, error: 'File not found' });
  res.json({ success: true, file: detail });
});

app.get('/api/element/:type/:name', (req, res) => {
  const c = requireAnalysis(res);
  if (!c) return;
  const { type, name } = req.params;
  const a = c.analysis;
  const element =
    type === 'class'
      ? a.classes.find((x) => x.name === name)
      : type === 'function'
        ? a.functions.find((x) => x.name === name)
        : type === 'interface'
          ? a.interfaces.find((x) => x.name === name)
          : undefined;
  if (!element) return res.status(404).json({ success: false, error: `${type} "${name}" not found` });

  const usedBy = a.imports
    .filter((imp) => imp.kind === 'internal' && imp.to === element.file && (imp.imports.includes(name) || imp.imports.includes('*')))
    .map((imp) => imp.from);
  const uses = a.imports.filter((imp) => imp.from === element.file).map((imp) => ({ module: imp.to, imports: imp.imports, kind: imp.kind }));
  res.json({ success: true, element, usedBy: Array.from(new Set(usedBy)), uses });
});

// ============================================================================
// FACTS (the counts that used to feed a 0-100 health score)
// ============================================================================

app.get('/api/health-score', (_req, res) => {
  const c = requireAnalysis(res);
  if (c) res.json({ success: true, facts: codebaseFacts(c.analysis) });
});

app.get('/api/unused-exports', (_req, res) => {
  const c = requireAnalysis(res);
  if (c) res.json({ success: true, ...unusedExports(c.analysis) });
});

/** Source files over 500 lines, with more than 10 exports, more than 20 functions or more than 3 classes. */
app.get('/api/god-files', (_req, res) => {
  const c = requireAnalysis(res);
  if (!c) return;
  const a = c.analysis;
  const count = <T extends { file: string }>(xs: T[]) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x.file, (m.get(x.file) ?? 0) + 1);
    return m;
  };
  const fnCount = count(a.functions);
  const classCount = count(a.classes);

  const godFiles = a.files
    .filter((f) => f.role === 'source')
    .map((file) => {
      const exports = a.exportsByFile[file.path]?.length ?? 0;
      const functions = fnCount.get(file.path) ?? 0;
      const classes = classCount.get(file.path) ?? 0;
      const reasons: string[] = [];
      if (file.lines > 500) reasons.push(`${file.lines} lines`);
      if (exports > 10) reasons.push(`${exports} exports`);
      if (functions > 20) reasons.push(`${functions} functions`);
      if (classes > 3) reasons.push(`${classes} classes`);
      return { file: file.path, name: file.name, lines: file.lines, exports, functions, classes, reasons };
    })
    .filter((g) => g.reasons.length > 0)
    .sort((x, y) => y.lines - x.lines);

  res.json({ success: true, godFiles, count: godFiles.length });
});

app.get('/api/complex-functions', (req, res) => {
  const c = requireAnalysis(res);
  if (!c) return;
  const threshold = clampInt(req.query.threshold, 1, 1000, 15);
  const source = new Set(sourceFiles(c.analysis));
  const complexFunctions = c.analysis.functions
    .filter((f) => source.has(f.file) && f.complexity > threshold)
    .map((f) => ({
      file: f.file,
      fileName: path.posix.basename(f.file),
      name: f.name,
      kind: f.kind,
      complexity: f.complexity,
      line: f.line,
      params: f.parameters.length,
      async: f.async,
    }))
    .sort((x, y) => y.complexity - x.complexity);
  res.json({ success: true, complexFunctions, count: complexFunctions.length, threshold });
});

app.get('/api/folder-summary', (_req, res) => {
  const c = requireAnalysis(res);
  if (!c) return;
  const a = c.analysis;
  const folderOf = (p: string) => path.posix.dirname(p) === '.' ? '(root)' : path.posix.dirname(p);
  const folders = new Map<string, { path: string; files: number; lines: number; functions: number; classes: number; complexity: number; issues: number }>();
  const get = (p: string) => {
    const key = folderOf(p);
    if (!folders.has(key)) folders.set(key, { path: key, files: 0, lines: 0, functions: 0, classes: 0, complexity: 0, issues: 0 });
    return folders.get(key)!;
  };
  const source = new Set(sourceFiles(a));
  for (const f of a.files) if (source.has(f.path)) { const x = get(f.path); x.files++; x.lines += f.lines; }
  for (const fn of a.functions) if (source.has(fn.file)) { const x = get(fn.file); x.functions++; x.complexity += fn.complexity; }
  for (const cls of a.classes) if (source.has(cls.file)) get(cls.file).classes++;
  for (const issue of a.issues) if (source.has(issue.file)) get(issue.file).issues++;

  const result = Array.from(folders.values())
    .map((f) => ({ ...f, avgComplexity: f.functions > 0 ? Math.round((f.complexity / f.functions) * 10) / 10 : 0, avgLines: f.files > 0 ? Math.round(f.lines / f.files) : 0 }))
    .sort((x, y) => y.files - x.files);
  res.json({ success: true, folders: result });
});

// ============================================================================
// GIT HISTORY
// ============================================================================

async function withHistory(res: express.Response, fn: (c: Current, h: Extract<GitHistory, { available: true }>) => unknown) {
  const c = requireAnalysis(res);
  if (!c) return;
  try {
    const h = await history(c);
    if (!h.available) return res.status(400).json({ success: false, error: h.reason });
    res.json({
      success: true,
      history: { shallow: h.shallow, renamesFollowed: h.renamesFollowed, commits: h.commits.length },
      ...(fn(c, h) as object),
    });
  } catch (error) {
    console.error('Git error:', error);
    res.status(500).json({ success: false, error: 'Failed to read git history' });
  }
}

app.get('/api/git/churn', (req, res) => {
  const days = clampInt(req.query.days, 1, 3650, 90);
  return withHistory(res, (c, h) => churn(h.commits, c.analysis.files.map((f) => f.path), days));
});

app.get('/api/git/ownership', (req, res) =>
  withHistory(res, (c, h) => ownership(h.commits, sourceFiles(c.analysis), timeWindow(req.query.time))),
);

app.get('/api/git/bus-factor', (req, res) =>
  withHistory(res, (c, h) => busFactor(h.commits, sourceFiles(c.analysis), timeWindow(req.query.time))),
);

app.get('/api/git/stale', (req, res) => {
  const months = clampInt(req.query.months, 1, 120, 6);
  return withHistory(res, (c, h) => staleFiles(h.commits, sourceFiles(c.analysis), months));
});

// ============================================================================
// EXPORT
// ============================================================================

app.get('/api/export/pbi', (_req, res) => {
  const c = requireAnalysis(res);
  if (!c) return;
  const a = c.analysis;
  res.json({
    exportDate: new Date().toISOString(),
    project: c.project.name,
    projectPath: c.project.path,
    tables: {
      files: a.files.map((f) => ({ path: f.path, name: f.name, folder: f.folder || '/', lines: f.lines, extension: f.extension, role: f.role })),
      functions: a.functions.map((f) => ({ file: f.file, name: f.name, kind: f.kind, complexity: f.complexity, params: f.parameters.length, async: f.async, exported: f.exported, line: f.line })),
      classes: a.classes.map((cl) => ({ file: cl.file, name: cl.name, methods: cl.methods.length, properties: cl.properties.length, exported: cl.exported, line: cl.line })),
      imports: a.imports.map((i) => ({ from: i.from, to: i.to, kind: i.kind, syntax: i.syntax, typeOnly: i.typeOnly, isExternal: i.isExternal })),
      issues: a.issues.map((i) => ({ file: i.file, type: i.type, severity: i.severity, message: i.message, line: i.line ?? 0 })),
    },
    summary: {
      totalFiles: a.files.length,
      totalFunctions: a.functions.length,
      totalClasses: a.classes.length,
      totalImports: a.imports.length,
      totalIssues: a.issues.length,
    },
  });
});

// ============================================================================
// START
// ============================================================================

if (process.env.NODE_ENV === 'production') {
  const webPath = path.join(__dirname, '../../web/dist');
  app.get('*', (_req, res) => res.sendFile(path.join(webPath, 'index.html')));
}

// Errors from middleware (a blocked origin, malformed JSON) as JSON, without stack traces.
app.use((err: Error & { status?: number; type?: string }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  if (err.message === 'Origin not allowed') return res.status(403).json({ success: false, error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ success: false, error: 'Request body is not valid JSON' });
  console.error(err);
  res.status(err.status ?? 500).json({ success: false, error: 'Internal error' });
});

cleanupOldClones();

app.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`TSight API running at http://${displayHost}:${PORT}`);
  if (WORKSPACE_ROOT) console.log(`Only folders inside ${WORKSPACE_ROOT} can be analyzed`);
  if (process.env.NODE_ENV === 'production') console.log('Open the address above and enter a folder under /code');
});
