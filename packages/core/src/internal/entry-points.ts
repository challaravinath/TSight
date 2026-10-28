import * as fs from 'fs';
import * as path from 'path';
import type { EntryPoint, FileInfo } from '../types.js';
import { CODE_EXTENSIONS, toPosix } from './discovery.js';

/**
 * Files that are loaded by something other than an import: a package.json
 * field, an HTML page, a framework's file-name convention, a tool config or
 * a test runner. Every entry records the rule that matched, so the UI can
 * say why a file counts as used.
 */
export function findEntryPoints(
  root: string,
  files: FileInfo[],
  packageJsons: string[],
  htmlFiles: string[],
): EntryPoint[] {
  const known = new Set(files.map((f) => f.path));
  const found = new Map<string, string>();
  const add = (rel: string, reason: string) => {
    if (known.has(rel) && !found.has(rel)) found.set(rel, reason);
  };
  const addWithExtensions = (relNoExt: string, reason: string) => {
    for (const ext of CODE_EXTENSIONS) add(relNoExt + ext, reason);
  };

  let usesNext = false;

  for (const pkgRel of packageJsons) {
    const pkgDir = path.dirname(path.resolve(root, pkgRel));
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(fs.readFileSync(path.resolve(root, pkgRel), 'utf8'));
    } catch {
      continue;
    }
    const join = (p: string) => toPosix(path.relative(root, path.resolve(pkgDir, p)));

    const deps = { ...(pkg.dependencies as object), ...(pkg.devDependencies as object) } as Record<string, string>;
    if (deps && 'next' in deps) usesNext = true;

    for (const field of ['main', 'module', 'browser', 'source', 'types']) {
      const v = pkg[field];
      if (typeof v === 'string') {
        add(join(v), `package.json "${field}"`);
        addWithExtensions(join(v).replace(/\.[cm]?[jt]sx?$/, ''), `package.json "${field}"`);
      }
    }
    const bin = pkg.bin;
    if (typeof bin === 'string') add(join(bin), 'package.json "bin"');
    if (bin && typeof bin === 'object') {
      for (const v of Object.values(bin)) if (typeof v === 'string') add(join(v), 'package.json "bin"');
    }
    for (const v of stringsIn(pkg.exports)) {
      add(join(v), 'package.json "exports"');
      addWithExtensions(join(v).replace(/\.[cm]?[jt]sx?$/, ''), 'package.json "exports"');
    }
    const scripts = pkg.scripts;
    if (scripts && typeof scripts === 'object') {
      for (const cmd of Object.values(scripts)) {
        if (typeof cmd !== 'string') continue;
        for (const m of cmd.matchAll(/(?:^|\s)(\.?\.?\/?[\w./-]+\.[cm]?[jt]sx?)(?=\s|$)/g)) {
          add(join(m[1]), 'package.json script');
        }
      }
    }
    // A package's root index file is what `import 'pkg'` loads when it is built.
    addWithExtensions(join('src/index'), 'package index file');
    addWithExtensions(join('index'), 'package index file');
  }

  for (const htmlRel of htmlFiles) {
    let html: string;
    try {
      html = fs.readFileSync(path.join(root, htmlRel), 'utf8');
    } catch {
      continue;
    }
    const dir = path.posix.dirname(htmlRel) === '.' ? '' : path.posix.dirname(htmlRel);
    for (const m of html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/g)) {
      const src = m[1];
      if (/^(https?:)?\/\//.test(src)) continue;
      const rel = src.startsWith('/') ? src.slice(1) : path.posix.normalize(dir ? `${dir}/${src}` : src);
      add(rel, `<script> in ${htmlRel}`);
    }
  }

  const NEXT_APP_FILES = /(^|\/)(page|layout|template|loading|error|global-error|not-found|default|route|head|icon|apple-icon|opengraph-image|twitter-image|sitemap|robots|manifest)\.[cm]?[jt]sx?$/;
  for (const f of files) {
    const p = f.path;
    if (f.role === 'test') {
      add(p, 'test file');
      continue;
    }
    if (/\.config\.[cm]?[jt]s$/.test(f.name) || /^\..*rc\.[cm]?[jt]s$/.test(f.name)) add(p, 'tool config file');
    if (/\.stories\.[jt]sx?$/.test(f.name)) add(p, 'Storybook story');
    if (usesNext) {
      if (/(^|\/)app\//.test(p) && NEXT_APP_FILES.test(p)) add(p, 'Next.js app router file');
      if (/(^|\/)pages\//.test(p)) add(p, 'Next.js pages router file');
      if (/(^|\/)(src\/)?(middleware|instrumentation)\.[cm]?[jt]s$/.test(p)) add(p, 'Next.js special file');
    }
  }

  return Array.from(found, ([file, reason]) => ({ file, reason })).sort((a, b) => a.file.localeCompare(b.file));
}

function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}
