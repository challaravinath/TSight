import * as fs from 'fs';
import * as path from 'path';
import ignore, { type Ignore } from 'ignore';
import type { FileRole } from '../types.js';

export const CODE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

// Directories that are never source, whether or not .gitignore lists them.
// Matched against a whole path segment, never a substring.
const ALWAYS_SKIPPED_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.vercel',
  '.output',
]);

const TEST_DIRS = new Set(['__tests__', '__mocks__', 'test', 'tests', 'e2e']);
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/i;
const DECLARATION_RE = /\.d\.[cm]?ts$/i;

export interface DiscoveredFile {
  abs: string;
  rel: string; // forward slashes, relative to the root
  role: FileRole;
}

export interface Discovery {
  files: DiscoveredFile[];
  packageJsons: string[]; // relative paths of every package.json seen
  htmlFiles: string[]; // relative paths of .html files, for <script src> entry points
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

export function fileRole(rel: string): FileRole {
  const segments = rel.split('/');
  const name = segments[segments.length - 1];
  if (TEST_FILE_RE.test(name)) return 'test';
  for (let i = 0; i < segments.length - 1; i++) {
    if (TEST_DIRS.has(segments[i])) return 'test';
  }
  return 'source';
}

interface IgnoreScope {
  base: string; // relative dir (posix) the .gitignore lives in, '' for root
  ig: Ignore;
}

/**
 * Walk the root and return every code file that is not ignored.
 * Honours .gitignore files at every level, skips symlinked directories,
 * and never matches path fragments (a folder called "builders" is kept).
 */
export function discoverFiles(root: string): Discovery {
  const files: DiscoveredFile[] = [];
  const packageJsons: string[] = [];
  const htmlFiles: string[] = [];

  const walk = (absDir: string, relDir: string, scopes: IgnoreScope[]): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    const local = readGitignore(absDir);
    const activeScopes = local ? [...scopes, { base: relDir, ig: local }] : scopes;

    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const abs = path.join(absDir, entry.name);
      const isDir = entry.isDirectory();

      if (isDir && ALWAYS_SKIPPED_DIRS.has(entry.name)) continue;
      if (isIgnored(activeScopes, rel, isDir)) continue;

      if (isDir) {
        walk(abs, rel, activeScopes);
        continue;
      }
      if (!entry.isFile()) continue; // symlinks and sockets are skipped

      if (entry.name === 'package.json') {
        packageJsons.push(rel);
        continue;
      }
      if (entry.name.endsWith('.html')) {
        htmlFiles.push(rel);
        continue;
      }
      if (DECLARATION_RE.test(entry.name)) continue;
      if (!CODE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) continue;

      files.push({ abs, rel, role: fileRole(rel) });
    }
  };

  walk(path.resolve(root), '', []);
  return { files, packageJsons, htmlFiles };
}

function readGitignore(absDir: string): Ignore | null {
  const file = path.join(absDir, '.gitignore');
  try {
    const text = fs.readFileSync(file, 'utf8');
    return ignore().add(text);
  } catch {
    return null;
  }
}

function isIgnored(scopes: IgnoreScope[], rel: string, isDir: boolean): boolean {
  for (const scope of scopes) {
    let sub = rel;
    if (scope.base) {
      if (!rel.startsWith(scope.base + '/')) continue;
      sub = rel.slice(scope.base.length + 1);
    }
    if (scope.ig.ignores(isDir ? sub + '/' : sub)) return true;
  }
  return false;
}
