import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import ignore, { type Ignore } from 'ignore';
import type { FileRole } from '../types.js';

export const CODE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

// Never source, even when committed.
const NEVER_SOURCE_DIRS = new Set(['node_modules', '.git', '.hg', '.svn']);

// Outside a git repository there is no list of tracked files, so these
// common build and cache folders are skipped as well. Matched against a
// whole path segment, never a substring.
const ALWAYS_SKIPPED_DIRS = new Set([
  ...NEVER_SOURCE_DIRS,
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
 * Every code file under the root that is part of the project.
 *
 * Inside a git repository this is exactly what git sees: tracked files
 * plus untracked files that are not ignored (`git ls-files`), so every
 * .gitignore rule applies the way git applies it. Elsewhere the folder is
 * walked, .gitignore files are honoured, and common build folders are
 * skipped by whole name (a folder called "builders" is kept).
 */
export function discoverFiles(root: string): Discovery {
  const abs = path.resolve(root);
  const fromGit = gitListedFiles(abs);
  const rels = fromGit ?? walkFiles(abs);

  const files: DiscoveredFile[] = [];
  const packageJsons: string[] = [];
  const htmlFiles: string[] = [];
  for (const rel of rels) {
    const segments = rel.split('/');
    if (segments.slice(0, -1).some((s) => NEVER_SOURCE_DIRS.has(s))) continue;
    const name = segments[segments.length - 1];
    if (name === 'package.json') packageJsons.push(rel);
    else if (name.endsWith('.html')) htmlFiles.push(rel);
    else if (!DECLARATION_RE.test(name) && CODE_EXTENSIONS.includes(path.extname(name).toLowerCase())) {
      files.push({ abs: path.join(abs, ...segments), rel, role: fileRole(rel) });
    }
  }
  return { files, packageJsons, htmlFiles };
}

/** Files git tracks or would track under `root`, relative to it. Null outside a repository. */
function gitListedFiles(root: string): string[] | null {
  let out: string;
  try {
    out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 512,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
  } catch {
    return null;
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rel of out.split('\0')) {
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    // Skip files deleted from the working tree, submodules and symlinks.
    try {
      if (!fs.lstatSync(path.join(root, rel)).isFile()) continue;
    } catch {
      continue;
    }
    result.push(rel);
  }
  // An ignored folder inside a repository lists nothing: walk it instead.
  return result.length > 0 ? result.sort() : null;
}

function walkFiles(root: string): string[] {
  const result: string[] = [];
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
      const isDir = entry.isDirectory();
      if (isDir && ALWAYS_SKIPPED_DIRS.has(entry.name)) continue;
      if (isIgnored(activeScopes, rel, isDir)) continue;
      if (isDir) walk(path.join(absDir, entry.name), rel, activeScopes);
      else if (entry.isFile()) result.push(rel); // symlinks and sockets are skipped
    }
  };
  walk(root, '', []);
  return result;
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
