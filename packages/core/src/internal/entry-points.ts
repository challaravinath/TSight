import * as fs from 'fs';
import * as path from 'path';
import ignore from 'ignore';
import type { EntryPoint, FileInfo } from '../types.js';
import { CODE_EXTENSIONS, toPosix } from './discovery.js';

/**
 * Files that are loaded by something other than an import: a package.json
 * field, an HTML page, a framework's file-name convention, a tool config,
 * a deploy config, a CI workflow or a test runner. Every entry records the
 * rule that matched, so the UI can say why a file counts as used.
 *
 * Projects with their own loading conventions can list entry points in
 * tsight.config.json: { "entryPoints": ["apps/examples/src/**\/*Example.tsx"] }
 */
export function findEntryPoints(
  root: string,
  files: FileInfo[],
  packageJsons: string[],
  htmlFiles: string[],
  configFiles: string[] = [],
): EntryPoint[] {
  const known = new Set(files.map((f) => f.path));
  const found = new Map<string, string>();
  const add = (rel: string, reason: string) => {
    if (known.has(rel) && !found.has(rel)) found.set(rel, reason);
  };
  const addWithExtensions = (relNoExt: string, reason: string) => {
    for (const ext of CODE_EXTENSIONS) add(relNoExt + ext, reason);
  };
  const stripExt = (p: string) => p.replace(/\.[cm]?[jt]sx?$/, '').replace(/\.d$/, '');
  const relFrom = (dirAbs: string, p: string) => toPosix(path.relative(root, path.resolve(dirAbs, p)));
  const read = (rel: string): string | null => {
    try {
      return fs.readFileSync(path.resolve(root, rel), 'utf8');
    } catch {
      return null;
    }
  };

  // 1. Declared by the project.
  for (const rel of configFiles.filter((c) => path.posix.basename(c) === 'tsight.config.json')) {
    const text = read(rel);
    if (!text) continue;
    let patterns: unknown;
    try {
      patterns = JSON.parse(text).entryPoints;
    } catch {
      continue;
    }
    if (!Array.isArray(patterns)) continue;
    const base = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
    const matcher = ignore().add(patterns.filter((p): p is string => typeof p === 'string'));
    for (const f of files) {
      if (base && !f.path.startsWith(base + '/')) continue;
      const sub = base ? f.path.slice(base.length + 1) : f.path;
      if (matcher.ignores(sub)) add(f.path, `${rel} entryPoints`);
    }
  }

  // 2. package.json fields and scripts.
  let usesNext = false;
  for (const pkgRel of packageJsons) {
    const text = read(pkgRel);
    if (!text) continue;
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(text);
    } catch {
      continue;
    }
    const pkgDir = path.dirname(path.resolve(root, pkgRel));
    const join = (p: string) => relFrom(pkgDir, p);

    const deps = { ...(pkg.dependencies as object), ...(pkg.devDependencies as object) } as Record<string, string>;
    if ('next' in deps) usesNext = true;

    const entryField = (value: string, reason: string) => {
      add(join(value), reason);
      addWithExtensions(stripExt(join(value)), reason);
      // Built output usually mirrors src/: dist/extension.js comes from src/extension.ts.
      const built = value.replace(/^\.\//, '').match(/^(dist|lib|build|out|esm|cjs)(-[a-z]+)?\/(.+)$/);
      if (built) {
        addWithExtensions(stripExt(join(`src/${built[3]}`)), `${reason} (built from src)`);
        // dist/web/extension.js is often built from src/extension.ts.
        addWithExtensions(stripExt(join(`src/${path.posix.basename(built[3])}`)), `${reason} (built from src)`);
      }
    };
    for (const field of ['main', 'module', 'browser', 'source', 'types']) {
      const v = pkg[field];
      if (typeof v === 'string') entryField(v, `package.json "${field}"`);
    }
    const bin = pkg.bin;
    if (typeof bin === 'string') entryField(bin, 'package.json "bin"');
    if (bin && typeof bin === 'object') {
      for (const v of Object.values(bin)) if (typeof v === 'string') entryField(v, 'package.json "bin"');
    }
    for (const v of stringsIn(pkg.exports)) entryField(v, 'package.json "exports"');

    const scripts = pkg.scripts;
    if (scripts && typeof scripts === 'object') {
      for (const cmd of Object.values(scripts)) {
        if (typeof cmd !== 'string') continue;
        for (const p of codePathsIn(cmd)) add(join(p), 'package.json script');
      }
    }
    if (pkg.jest && typeof pkg.jest === 'object') {
      for (const p of setupFilesIn(JSON.stringify(pkg.jest))) add(join(p.replace('<rootDir>/', '')), 'jest setup file in package.json');
    }
    // A package's root index file is what `import 'pkg'` loads when it is built.
    addWithExtensions(join('src/index'), 'package index file');
    addWithExtensions(join('index'), 'package index file');
  }

  // 3. Deploy configs and CI workflows.
  for (const rel of configFiles) {
    const name = path.posix.basename(rel);
    const text = read(rel);
    if (!text) continue;
    const dirAbs = path.dirname(path.resolve(root, rel));
    if (name.startsWith('wrangler.')) {
      const m = text.match(/^\s*main\s*=\s*["']([^"']+)["']/m) ?? text.match(/"main"\s*:\s*"([^"]+)"/);
      if (m) add(relFrom(dirAbs, m[1]), `main in ${rel}`);
    } else if (rel.startsWith('.github/workflows/')) {
      for (const p of codePathsIn(text)) add(relFrom(root, p), `run by ${rel}`);
    }
  }

  // 4. HTML pages.
  for (const htmlRel of htmlFiles) {
    const html = read(htmlRel);
    if (!html) continue;
    const dir = path.posix.dirname(htmlRel) === '.' ? '' : path.posix.dirname(htmlRel);
    for (const m of html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/g)) {
      const src = m[1].split('?')[0];
      if (/^(https?:)?\/\//.test(src)) continue;
      // Tools like Vite treat the HTML file's folder as the site root, so
      // "/src/main.tsx" in apps/web/index.html means apps/web/src/main.tsx.
      const fromHtmlDir = path.posix.normalize(dir ? `${dir}/${src.replace(/^\//, '')}` : src.replace(/^\//, ''));
      add(fromHtmlDir, `<script> in ${htmlRel}`);
      if (src.startsWith('/')) add(src.slice(1), `<script> in ${htmlRel}`);
    }
  }

  // 5. File conventions and test runner configs.
  const NEXT_APP_FILES = /(^|\/)(page|layout|template|loading|error|global-error|not-found|default|route|head|icon|apple-icon|opengraph-image|twitter-image|sitemap|robots|manifest)\.[cm]?[jt]sx?$/;
  const TEST_CONFIG = /(^|\/)(vitest|vite|jest|playwright)\.(config|workspace)\.[cm]?[jt]s$|(^|\/)vitest\.workspace\.[cm]?[jt]s$/;
  for (const f of files) {
    const p = f.path;
    if (f.role === 'test') {
      add(p, 'test file');
      continue;
    }
    if (TEST_CONFIG.test(p)) {
      const text = read(p);
      const dirAbs = path.dirname(path.resolve(root, p));
      if (text) {
        for (const s of setupFilesIn(text)) {
          const cleaned = s.replace('<rootDir>/', '');
          add(relFrom(dirAbs, cleaned), `setup file in ${p}`);
          addWithExtensions(stripExt(relFrom(dirAbs, cleaned)), `setup file in ${p}`);
        }
      }
    }
    if (/\.config\.[cm]?[jt]s$/.test(f.name) || /^\..*rc\.[cm]?[jt]s$/.test(f.name)) add(p, 'tool config file');
    if (/\.stories\.[jt]sx?$/.test(f.name)) add(p, 'Storybook story');
    if (/(^|\/)public\//.test(p)) add(p, 'static file in public/ (served as is)');
    if (usesNext) {
      if (/(^|\/)app\//.test(p) && NEXT_APP_FILES.test(p)) add(p, 'Next.js app router file');
      if (/(^|\/)pages\//.test(p)) add(p, 'Next.js pages router file');
      if (/(^|\/)(src\/)?(middleware|instrumentation)\.[cm]?[jt]s$/.test(p)) add(p, 'Next.js special file');
    }
  }

  return Array.from(found, ([file, reason]) => ({ file, reason })).sort((a, b) => a.file.localeCompare(b.file));
}

/** Paths to code files written in a command line or a workflow step. */
function codePathsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?:^|[\s"'=(])(\.{0,2}\/?[\w@.-][\w@./-]*\.[cm]?[jt]sx?)(?=[\s"')]|$)/gm)) {
    if (!m[1].includes('://')) out.push(m[1]);
  }
  return out;
}

/** String values of setupFiles, setupFilesAfterEnv, globalSetup and globalTeardown in a config file. */
function setupFilesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/["']?(setupFiles|setupFilesAfterEnv|globalSetup|globalTeardown)["']?\s*:\s*(\[[^\]]*\]|["'][^"']+["'])/g)) {
    for (const s of m[2].matchAll(/["']([^"']+)["']/g)) out.push(s[1]);
  }
  return out;
}

function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}
