/**
 * TSight HTTP server: serves the web UI and a small API over @tsight/core.
 *
 *   GET  /api/status            what is loaded, and progress while analyzing
 *   POST /api/analyze           { path } analyze a local folder
 *   POST /api/analyze/github    { url }  clone a public GitHub repo and analyze it
 *   GET  /api/snapshot          the full snapshot of the current analysis
 *   GET  /api/diff?base=main    what the working copy changes compared with base
 *
 * Analysis runs in a worker thread. Every number comes from core.
 */
import express from 'express';
import cors from 'cors';
import { simpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import type { Server } from 'http';
import type { Job, WorkerMessage } from './worker.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface ServerOptions {
  port: number;
  host?: string; // default 127.0.0.1
  /** Folder with the built web UI. Not served when missing. */
  webDir?: string;
  /** If set, only folders inside it can be analyzed. */
  workspaceRoot?: string | null;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  /** Folder to analyze as soon as the server starts. */
  initialPath?: string;
  version?: string;
  log?: (message: string) => void;
}

// Only plain https GitHub URLs can be cloned. This rules out ssh, scp-style
// and the ext:: transport, which has allowed command execution before.
const GITHUB_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/;
const CLONE_TIMEOUT_MS = 120_000;
const CLONE_TMP_ROOT = path.join(os.tmpdir(), 'tsight-repos');
const CLONE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const DEFAULT_ORIGINS = ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001'];

type Status =
  | { state: 'idle' }
  | { state: 'analyzing'; path: string; message: string; startedAt: number }
  | { state: 'ready'; path: string; name: string; analyzedAt: string }
  | { state: 'error'; path: string; message: string };

export function createServer(options: ServerOptions) {
  const log = options.log ?? ((m: string) => console.log(m));
  const host = options.host ?? '127.0.0.1';
  const workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : null;
  const allowedOrigins = options.allowedOrigins ?? DEFAULT_ORIGINS;
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1', ...(options.allowedHosts ?? [])].map((s) => s.trim().toLowerCase()).filter(Boolean));
  const app = express();

  let status: Status = { state: 'idle' };
  let snapshotJson: string | null = null;
  let projectPath: string | null = null;
  let runId = 0;
  const diffCache = new Map<string, Promise<string>>();

  // ---- checks ---------------------------------------------------------------

  const validateProjectPath = (input: unknown): string => {
    if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) throw new Error('path must be a non-empty string');
    const resolved = path.resolve(input);
    if (!fs.existsSync(resolved)) throw new Error('Path does not exist');
    if (!fs.statSync(resolved).isDirectory()) throw new Error('Path must be a directory');
    if (workspaceRoot) {
      const rel = path.relative(fs.realpathSync(workspaceRoot), fs.realpathSync(resolved));
      if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('Path is outside the configured workspace root');
    }
    return resolved;
  };

  const hostnameOf = (h: string | undefined) => {
    if (!h) return '';
    const lower = h.toLowerCase();
    return lower.startsWith('[') ? lower.slice(0, lower.indexOf(']') + 1) : lower.split(':')[0];
  };

  // Host check: blocks DNS rebinding, where a page re-points its own domain at
  // 127.0.0.1 and reads this API as same-origin (same-origin GETs send no Origin).
  app.use((req, res, next) => {
    if (!allowedHosts.has(hostnameOf(req.headers.host))) {
      return res.status(403).json({ success: false, error: 'Host not allowed. Set TSIGHT_ALLOWED_HOSTS to add it.' });
    }
    next();
  });
  app.use(
    cors((req, cb) => {
      const origin = req.headers.origin;
      let allowed = !origin || allowedOrigins.includes(origin);
      if (!allowed && origin) {
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

  // ---- jobs -----------------------------------------------------------------

  const runJob = (job: Job, onProgress: (m: string) => void): Promise<string> =>
    new Promise((resolve, reject) => {
      const worker = new Worker(path.join(here, 'worker.js'), { workerData: job });
      worker.on('message', (m: WorkerMessage) => {
        if (m.type === 'progress') onProgress(m.message);
        else if (m.type === 'done') resolve(m.json);
        else reject(new Error(m.message));
      });
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) reject(new Error(`Analysis stopped (exit code ${code})`));
      });
    });

  const analyze = async (dir: string, name: string): Promise<void> => {
    const id = ++runId;
    status = { state: 'analyzing', path: dir, message: 'Starting', startedAt: Date.now() };
    log(`Analyzing ${dir}`);
    try {
      const json = await runJob({ type: 'snapshot', path: dir, name, version: options.version ?? '0.0.0' }, (message) => {
        if (id === runId && status.state === 'analyzing') status = { ...status, message };
      });
      if (id !== runId) return; // a newer request replaced this one
      const previous = projectPath;
      snapshotJson = json;
      projectPath = dir;
      diffCache.clear();
      status = { state: 'ready', path: dir, name, analyzedAt: new Date().toISOString() };
      if (previous && previous !== dir) removeIfClone(previous);
      log(`Ready: ${dir}`);
    } catch (e) {
      if (id === runId) status = { state: 'error', path: dir, message: (e as Error).message };
      throw e;
    }
  };

  // ---- routes ---------------------------------------------------------------

  app.get('/api/status', (_req, res) => {
    res.json({ success: true, status, version: options.version ?? '0.0.0' });
  });

  app.post('/api/analyze', async (req, res) => {
    let dir: string;
    try {
      dir = validateProjectPath(req.body?.path);
    } catch (e) {
      return res.status(400).json({ success: false, error: (e as Error).message });
    }
    try {
      await analyze(dir, path.basename(dir));
      res.json({ success: true, status });
    } catch (e) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  app.post('/api/analyze/github', async (req, res) => {
    const url = req.body?.url;
    if (typeof url !== 'string' || !GITHUB_URL_RE.test(url)) {
      return res.status(400).json({ success: false, error: 'url must be an https://github.com/{owner}/{repo} URL' });
    }
    const repoName = url.replace(/\/$/, '').replace(/\.git$/, '').split('/').pop() || 'repo';
    const tempDir = path.join(CLONE_TMP_ROOT, `${repoName}-${Date.now()}`);
    try {
      fs.mkdirSync(CLONE_TMP_ROOT, { recursive: true });
      status = { state: 'analyzing', path: url, message: 'Cloning', startedAt: Date.now() };
      // Full commit history (the history views need it), file contents only as needed.
      await simpleGit({ timeout: { block: CLONE_TIMEOUT_MS } }).clone(url, tempDir, ['--filter=blob:none', '--no-tags', '--single-branch']);
      await analyze(tempDir, repoName);
      res.json({ success: true, status });
    } catch (e) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      if (status.state === 'analyzing') status = { state: 'error', path: url, message: (e as Error).message };
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  app.get('/api/snapshot', (_req, res) => {
    if (!snapshotJson) return res.status(404).json({ success: false, error: 'No analysis yet' });
    res.type('application/json').send(snapshotJson);
  });

  app.get('/api/diff', async (req, res) => {
    if (!projectPath) return res.status(404).json({ success: false, error: 'No analysis yet' });
    const base = typeof req.query.base === 'string' && /^[\w./~^@{}][\w./~^@{}-]{0,199}$/.test(req.query.base) ? req.query.base : null;
    if (!base) return res.status(400).json({ success: false, error: 'base must be a branch, tag or commit, for example main' });
    let pending = diffCache.get(base);
    if (!pending) {
      pending = runJob({ type: 'diff', path: projectPath, base }, () => {});
      diffCache.set(base, pending);
      pending.catch(() => diffCache.delete(base));
    }
    try {
      res.type('application/json').send(await pending);
    } catch (e) {
      res.status(400).json({ success: false, error: (e as Error).message });
    }
  });

  app.use('/api', (_req, res) => res.status(404).json({ success: false, error: 'Unknown API route' }));

  // ---- web UI ---------------------------------------------------------------

  const webDir = options.webDir ?? path.join(here, '../../web/dist');
  if (fs.existsSync(path.join(webDir, 'index.html'))) {
    app.use(express.static(webDir));
    app.get('*', (_req, res) => res.sendFile(path.join(webDir, 'index.html')));
  }

  // Errors from middleware (a blocked origin, malformed JSON) as JSON, without stack traces.
  app.use((err: Error & { status?: number; type?: string }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    if (err.message === 'Origin not allowed') return res.status(403).json({ success: false, error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ success: false, error: 'Request body is not valid JSON' });
    log(String(err));
    res.status(err.status ?? 500).json({ success: false, error: 'Internal error' });
  });

  // ---- housekeeping -----------------------------------------------------------

  function removeIfClone(dir: string): void {
    const rel = path.relative(CLONE_TMP_ROOT, dir);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return;
    fs.rm(dir, { recursive: true, force: true }, () => {});
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

  return {
    app,
    start(): Promise<{ url: string; server: Server }> {
      cleanupOldClones();
      setInterval(cleanupOldClones, 60 * 60 * 1000).unref();
      return new Promise((resolve, reject) => {
        const server = app.listen(options.port, host, () => {
          const addr = server.address();
          const port = typeof addr === 'object' && addr ? addr.port : options.port;
          const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
          if (options.initialPath) {
            try {
              const dir = validateProjectPath(options.initialPath);
              analyze(dir, path.basename(dir)).catch((e) => log(`Analysis failed: ${(e as Error).message}`));
            } catch (e) {
              log(`Cannot analyze ${options.initialPath}: ${(e as Error).message}`);
            }
          }
          resolve({ url, server });
        });
        server.on('error', reject);
      });
    },
  };
}
