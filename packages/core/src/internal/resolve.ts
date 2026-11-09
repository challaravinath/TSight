import * as fs from 'fs';
import * as path from 'path';
import { builtinModules } from 'module';
import { ts } from 'ts-morph';
import type { ImportKind } from '../types.js';
import { toPosix, CODE_EXTENSIONS } from './discovery.js';
import { COMPONENT_EXTENSIONS } from './framework.js';

const ASSET_EXTENSIONS = new Set([
  '.css', '.scss', '.sass', '.less', '.styl', '.pcss',
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.webm', '.wav', '.ogg',
  '.json', '.json5', '.md', '.mdx', '.html', '.txt', '.csv', '.yaml', '.yml', '.toml',
  '.graphql', '.gql', '.wasm', '.glsl', '.vert', '.frag',
]);

const BUILTINS = new Set(builtinModules);

export interface Resolution {
  kind: ImportKind;
  target?: string; // absolute path, when a file was found
  resolvedBy?: 'typescript' | 'workspace' | 'framework';
}

interface ConfigEntry {
  configPath: string | null;
  options: ts.CompilerOptions;
  cache: ts.ModuleResolutionCache;
  pathPatterns: string[];
  fileNames: Set<string>; // files the config includes, as fileKey()
  references: string[]; // absolute paths of referenced tsconfig files
}

/** Modules Nuxt generates at build time. */
const NUXT_VIRTUAL = /^#(imports|components|app|build|vue-router|internal)(\/|$)/;

/** Specifiers that can never be npm package names, so they must be project aliases. */
const ALIAS_LIKE = /^(@\/|~\/|~$|#|\$lib(\/|$))/;

/** Resolve symlinks so paths compare equal however the folder was reached. */
export function realPath(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
}

/** A comparable key for an absolute path (case-insensitive on Windows). */
function fileKey(p: string): string {
  const posix = toPosix(path.resolve(p));
  return process.platform === 'win32' ? posix.toLowerCase() : posix;
}

const DEFAULT_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowJs: true,
  resolveJsonModule: true,
  jsx: ts.JsxEmit.Preserve,
};

/**
 * Resolves import specifiers the way TypeScript does, using the nearest
 * tsconfig.json for each file (so `paths`, `baseUrl` and the module
 * resolution mode all apply). Workspace packages that are not linked into
 * node_modules are found through the root package.json `workspaces` field.
 */
export class ModuleResolver {
  private readonly root: string;
  private readonly analyzed: Set<string>;
  private readonly nearestByDir = new Map<string, string | null>();
  private readonly configByPath = new Map<string, ConfigEntry>();
  private readonly workspaces: Map<string, string>; // package name -> absolute dir
  private readonly host: ts.ModuleResolutionHost;

  constructor(root: string, analyzedAbsPaths: Iterable<string>) {
    this.root = realPath(path.resolve(root));
    this.analyzed = new Set(Array.from(analyzedAbsPaths, (p) => realPath(path.resolve(p))));
    this.workspaces = findWorkspacePackages(this.root);
    this.host = {
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      directoryExists: ts.sys.directoryExists,
      realpath: ts.sys.realpath,
      getCurrentDirectory: () => this.root,
      getDirectories: ts.sys.getDirectories,
    };
  }

  /** tsconfig files that were actually used, relative to the root. */
  usedConfigs(): string[] {
    const out = new Set<string>();
    for (const entry of this.configByPath.values()) {
      if (entry.configPath) out.add(toPosix(path.relative(this.root, entry.configPath)));
    }
    return Array.from(out).sort();
  }

  resolve(specifier: string, fromAbs: string): Resolution {
    const cleanSpec = specifier.split('?')[0];
    if (cleanSpec !== specifier) return { kind: 'asset' }; // ./x.svg?raw, ./worker.ts?worker
    const ext = path.extname(cleanSpec).toLowerCase();
    const isRelative = cleanSpec.startsWith('.') || path.isAbsolute(cleanSpec);
    const isBare = !isRelative;

    const config = this.configFor(fromAbs);
    if (COMPONENT_EXTENSIONS.includes(ext)) return this.resolveComponent(cleanSpec, fromAbs, config);
    const result = ts.resolveModuleName(cleanSpec, fromAbs, config.options, this.host, config.cache);
    const resolved = result.resolvedModule;

    if (resolved) {
      const target = realPath(path.resolve(resolved.resolvedFileName));
      const kind = this.classifyTarget(target);
      if (kind === 'internal') return { kind, target, resolvedBy: 'typescript' };
      if (kind === 'asset') return { kind };
      if (kind === 'excluded') {
        // Built output or a declaration file: prefer the source file next to it.
        const source = this.sourceFor(target);
        if (source) return { kind: 'internal', target: source, resolvedBy: 'typescript' };
      }
      if (isBare) {
        const ws = this.resolveWorkspace(cleanSpec);
        if (ws) return { kind: 'internal', target: ws, resolvedBy: 'workspace' };
      }
      return { kind, target };
    }

    if (ext && ASSET_EXTENSIONS.has(ext)) return { kind: 'asset' };
    if (isBare) {
      const ws = this.resolveWorkspace(cleanSpec);
      if (ws) return { kind: 'internal', target: ws, resolvedBy: 'workspace' };
      const fw = this.resolveFrameworkAlias(cleanSpec, fromAbs);
      if (fw) return { kind: 'internal', target: fw, resolvedBy: 'framework' };
    }
    // SvelteKit writes ./$types for every route while it builds; it is not in the repository.
    if (/^\.\/\$types(\.js)?$/.test(cleanSpec) && this.configDir(path.dirname(fromAbs), /^svelte\.config\.[cm]?[jt]s$/)) return { kind: 'external' };
    if (isRelative) return { kind: 'unresolved' };
    if (cleanSpec.startsWith('node:') || BUILTINS.has(cleanSpec.split('/')[0])) return { kind: 'external' };
    // Modules Nuxt generates at build time (#imports, #components, #app, ...): they come from the nuxt package, not the project.
    if (NUXT_VIRTUAL.test(cleanSpec) && this.configDir(path.dirname(fromAbs), /^nuxt\.config\.[cm]?[jt]s$/)) return { kind: 'external' };
    if (
      ALIAS_LIKE.test(cleanSpec) ||
      this.matchesPathAlias(cleanSpec, config) ||
      this.matchesWorkspaceName(cleanSpec)
    ) {
      return { kind: 'unresolved' };
    }
    // A bare specifier that is not an alias: a package, installed or not.
    return { kind: 'external' };
  }

  /**
   * `./Button.vue`, `@/components/Button.vue`, `$lib/Card.svelte`. TypeScript
   * cannot load these files, so it is asked for `Button.vue.ts` instead, with a
   * file system where that name exists whenever `Button.vue` was analyzed. That
   * way tsconfig `paths` and `baseUrl` apply exactly as they do to other imports.
   */
  private resolveComponent(spec: string, fromAbs: string, config: ConfigEntry): Resolution {
    const isRelative = spec.startsWith('.') || path.isAbsolute(spec);
    const asComponent = (p: string): string | null => {
      if (!p.endsWith('.ts')) return null;
      const real = realPath(path.resolve(p.slice(0, -3)));
      return this.analyzed.has(real) ? real : null;
    };
    const host: ts.ModuleResolutionHost = {
      ...this.host,
      fileExists: (p) => asComponent(p) !== null,
    };
    const resolved = ts.resolveModuleName(spec, fromAbs, { ...config.options, allowJs: false }, host).resolvedModule;
    const target = resolved ? asComponent(resolved.resolvedFileName) : null;
    if (target) return { kind: 'internal', target, resolvedBy: 'typescript' };
    // './test.astro' can also name a code file called test.astro.js.
    const plain = ts.resolveModuleName(spec, fromAbs, config.options, this.host, config.cache).resolvedModule;
    if (plain) {
      const real = realPath(path.resolve(plain.resolvedFileName));
      if (this.classifyTarget(real) === 'internal') return { kind: 'internal', target: real, resolvedBy: 'typescript' };
    }
    if (!isRelative) {
      const ws = this.resolveWorkspace(spec);
      if (ws) return { kind: 'internal', target: ws, resolvedBy: 'workspace' };
      const fw = this.resolveFrameworkAlias(spec, fromAbs);
      if (fw) return { kind: 'internal', target: fw, resolvedBy: 'framework' };
      if (!ALIAS_LIKE.test(spec) && !this.matchesPathAlias(spec, config) && !this.matchesWorkspaceName(spec)) {
        return { kind: 'external' };
      }
    }
    return { kind: 'unresolved' };
  }

  /**
   * Aliases a framework sets up in a tsconfig it generates at build time
   * (.svelte-kit/tsconfig.json, .nuxt/tsconfig.json). A fresh clone has no such
   * file, so the framework's documented defaults are used, and only when the
   * framework's config file is present:
   * - SvelteKit: `$lib` is `src/lib` next to svelte.config.*
   * - Nuxt: `~` and `@` are the folder of nuxt.config.*, or its `app/` folder
   * The import counts only if a file is found there.
   */
  private resolveFrameworkAlias(spec: string, fromAbs: string): string | null {
    const lookFor = (configName: RegExp, bases: (dir: string) => string[], sub: string): string | null => {
      const dir = this.configDir(path.dirname(fromAbs), configName);
      if (!dir) return null;
      for (const base of bases(dir)) {
        for (const c of [realPath(path.resolve(base, sub)), ...withExtensions(path.join(base, sub)), ...withExtensions(path.join(base, sub, 'index'))]) {
          if (this.analyzed.has(c)) return c;
        }
      }
      return null;
    };
    const lib = spec.match(/^\$lib(?:\/(.*))?$/);
    if (lib) return lookFor(/^svelte\.config\.[cm]?[jt]s$/, (d) => [path.join(d, 'src', 'lib')], lib[1] ?? 'index');
    const nuxt = spec.match(/^[~@]\/(.+)$/);
    if (nuxt) return lookFor(/^nuxt\.config\.[cm]?[jt]s$/, (d) => [d, path.join(d, 'app')], nuxt[1]);
    // Nuxt 4: #shared is the shared/ folder next to nuxt.config.
    const shared = spec.match(/^#shared(?:\/(.*))?$/);
    if (shared) return lookFor(/^nuxt\.config\.[cm]?[jt]s$/, (d) => [path.join(d, 'shared')], shared[1] ?? 'index');
    return null;
  }

  private readonly configDirs = new Map<string, string | null>();

  /** findConfigDir, remembered per folder: the same folders come up for every import in them. */
  private configDir(startDir: string, name: RegExp): string | null {
    const key = `${name.source}|${startDir}`;
    let dir = this.configDirs.get(key);
    if (dir === undefined) {
      dir = findConfigDir(startDir, this.root, name);
      this.configDirs.set(key, dir);
    }
    return dir;
  }

  /** For a .d.ts or an unanalyzed .js, the analyzed source file with the same name, if any. */
  private sourceFor(target: string): string | null {
    const base = target.replace(/\.d\.[cm]?ts$/i, '').replace(/\.[cm]?[jt]sx?$/i, '');
    for (const c of withExtensions(base)) {
      if (this.analyzed.has(c)) return c;
    }
    return null;
  }

  private classifyTarget(target: string): ImportKind {
    const posix = toPosix(target);
    if (posix.includes('/node_modules/')) return 'external';
    if (this.analyzed.has(target)) return 'internal';
    const lower = target.toLowerCase();
    if (/\.d\.[cm]?ts$/.test(lower)) return 'excluded';
    const ext = path.extname(lower);
    if (CODE_EXTENSIONS.includes(ext)) return 'excluded';
    return 'asset';
  }

  /**
   * The tsconfig that governs a file: the nearest tsconfig.json, or, when
   * that file only lists `references` (the solution style Vite and others
   * use), the referenced config whose files include this one.
   */
  private configFor(fileAbs: string): ConfigEntry {
    const dir = path.dirname(fileAbs);
    let nearest = this.nearestByDir.get(dir);
    if (nearest === undefined) {
      nearest = findNearestTsconfig(dir);
      this.nearestByDir.set(dir, nearest);
    }
    const entry = this.load(nearest);
    if (!nearest || entry.fileNames.has(fileKey(fileAbs)) || entry.references.length === 0) return entry;

    const seen = new Set<string>([nearest]);
    const queue = [...entry.references];
    while (queue.length > 0) {
      const ref = queue.shift()!;
      if (seen.has(ref)) continue;
      seen.add(ref);
      const child = this.load(ref);
      if (child.fileNames.has(fileKey(fileAbs))) return child;
      queue.push(...child.references);
    }
    return entry;
  }

  private load(configPath: string | null): ConfigEntry {
    const key = configPath ?? '';
    let entry = this.configByPath.get(key);
    if (!entry) {
      entry = this.loadConfig(configPath);
      this.configByPath.set(key, entry);
    }
    return entry;
  }

  private loadConfig(configPath: string | null): ConfigEntry {
    let options: ts.CompilerOptions = { ...DEFAULT_OPTIONS };
    let fileNames = new Set<string>();
    let references: string[] = [];
    if (configPath) {
      const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => {},
      });
      if (parsed) {
        options = { ...parsed.options };
        fileNames = new Set(parsed.fileNames.map((f) => fileKey(f)));
        references = (parsed.projectReferences ?? []).map((r) => path.resolve(ts.resolveProjectReferencePath(r)));
      }
    }
    // We need every code file to be resolvable, whatever the project emits.
    options.allowJs = true;
    options.resolveJsonModule = true;
    options.noEmit = true;

    const baseDir = configPath ? path.dirname(configPath) : this.root;
    const cache = ts.createModuleResolutionCache(baseDir, (f) => f, options);
    return {
      configPath,
      options,
      cache,
      pathPatterns: Object.keys(options.paths ?? {}),
      fileNames,
      references,
    };
  }

  private matchesPathAlias(spec: string, config: ConfigEntry): boolean {
    return config.pathPatterns.some((pattern) => {
      const star = pattern.indexOf('*');
      if (star === -1) return pattern === spec;
      return spec.startsWith(pattern.slice(0, star)) && spec.endsWith(pattern.slice(star + 1));
    });
  }

  private matchesWorkspaceName(spec: string): boolean {
    for (const name of this.workspaces.keys()) {
      if (spec === name || spec.startsWith(name + '/')) return true;
    }
    return false;
  }

  /** Map `pkg` or `pkg/sub/path` to a file in that workspace package's folder. */
  private resolveWorkspace(spec: string): string | null {
    for (const [name, dir] of this.workspaces) {
      if (spec !== name && !spec.startsWith(name + '/')) continue;
      const sub = spec === name ? '' : spec.slice(name.length + 1);
      const candidates: string[] = [];
      if (!sub) {
        candidates.push(...packageEntryCandidates(dir));
        candidates.push(...withExtensions(path.join(dir, 'src', 'index')));
        candidates.push(...withExtensions(path.join(dir, 'index')));
      } else {
        // pkg/Button.svelte: a component file named with its extension.
        if (COMPONENT_EXTENSIONS.includes(path.extname(sub).toLowerCase())) {
          candidates.push(realPath(path.join(dir, 'src', sub)), realPath(path.join(dir, sub)));
        }
        candidates.push(...withExtensions(path.join(dir, 'src', sub)));
        candidates.push(...withExtensions(path.join(dir, 'src', sub, 'index')));
        candidates.push(...withExtensions(path.join(dir, sub)));
        candidates.push(...withExtensions(path.join(dir, sub, 'index')));
      }
      for (const c of candidates) {
        if (this.analyzed.has(c)) return c;
      }
    }
    return null;
  }
}

/** The nearest folder from startDir up to root that holds a file matching name. */
function findConfigDir(startDir: string, root: string, name: RegExp): string | null {
  let dir = startDir;
  for (;;) {
    try {
      if (fs.readdirSync(dir).some((f) => name.test(f))) return dir;
    } catch {
      // unreadable folder: keep going up
    }
    if (dir === root) return null;
    const parent = path.dirname(dir);
    if (parent === dir || path.relative(root, parent).startsWith('..')) return null;
    dir = parent;
  }
}

function withExtensions(base: string): string[] {
  const stripped = base.replace(/\.[cm]?js$/, '');
  return CODE_EXTENSIONS.map((ext) => realPath(path.resolve(stripped + ext)));
}

function packageEntryCandidates(dir: string): string[] {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const fields = [pkg.source, pkg.types, pkg.typings, pkg.module, pkg.main].filter(
      (v: unknown): v is string => typeof v === 'string',
    );
    return fields.map((f) => realPath(path.resolve(dir, f)));
  } catch {
    return [];
  }
}

function findNearestTsconfig(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = path.join(dir, 'tsconfig.json');
    if (fs.existsSync(candidate)) return candidate;
    const jsconfig = path.join(dir, 'jsconfig.json');
    if (fs.existsSync(jsconfig)) return jsconfig;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Read `workspaces` from the nearest package.json at or above the root
 * (npm and yarn), or pnpm-workspace.yaml, and map package names to folders.
 */
export function findWorkspacePackages(root: string): Map<string, string> {
  const result = new Map<string, string>();
  let dir = path.resolve(root);
  for (;;) {
    const patterns = readWorkspacePatterns(dir);
    if (patterns.length > 0) {
      for (const pattern of patterns) {
        for (const pkgDir of expandWorkspacePattern(dir, pattern)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
            if (typeof pkg.name === 'string' && !result.has(pkg.name)) result.set(pkg.name, pkgDir);
          } catch {
            // not a package folder
          }
        }
      }
      return result;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return result;
    dir = parent;
  }
}

function readWorkspacePatterns(dir: string): string[] {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages;
    if (Array.isArray(ws) && ws.length > 0) return ws.filter((w: unknown) => typeof w === 'string');
  } catch {
    // no package.json here
  }
  try {
    const yaml = fs.readFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'utf8');
    const out: string[] = [];
    let inPackages = false;
    for (const line of yaml.split(/\r?\n/)) {
      if (/^packages\s*:/.test(line)) {
        inPackages = true;
        continue;
      }
      if (inPackages) {
        const m = line.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*(#.*)?$/);
        if (m) out.push(m[1].trim());
        else if (/^\S/.test(line)) inPackages = false;
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Expand a workspaces glob such as packages/*, packages/plugin-* or apps/** to folders. */
function expandWorkspacePattern(base: string, pattern: string): string[] {
  if (pattern.startsWith('!')) return [];
  const segments = pattern.replace(/^\.\//, '').replace(/\/+$/, '').split('/').filter(Boolean);
  const out: string[] = [];
  const toRegex = (seg: string) => new RegExp('^' + seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');

  const walk = (dir: string, i: number, depth: number): void => {
    if (i === segments.length) {
      out.push(dir);
      return;
    }
    const seg = segments[i];
    if (!seg.includes('*')) {
      walk(path.join(dir, seg), i + 1, depth);
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const dirs = entries.filter((e) => e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.'));
    if (seg === '**') {
      walk(dir, i + 1, depth); // zero folders
      if (depth < 4) for (const e of dirs) walk(path.join(dir, e.name), i, depth + 1);
      return;
    }
    const re = toRegex(seg);
    for (const e of dirs) if (re.test(e.name)) walk(path.join(dir, e.name), i + 1, depth);
  };
  walk(path.resolve(base), 0, 0);
  return out;
}
