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
  docFiles: string[] = [],
  /** The analyzed file an import specifier points to, resolved the way imports in code are. */
  importTarget: (specifier: string, fromRel: string) => string | null = () => null,
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
  const frameworks = new Set<string>();
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
    if ('@sveltejs/kit' in deps) frameworks.add('sveltekit');
    if ('nuxt' in deps || 'nuxt3' in deps) frameworks.add('nuxt');
    if ('astro' in deps) frameworks.add('astro');
    if (Object.keys(deps).some((d) => d.startsWith('@remix-run/') || d === '@react-router/dev')) frameworks.add('remix');
    for (const plugin of ['unplugin-vue-components', 'vite-plugin-pages', 'unplugin-vue-router', 'vite-plugin-vue-layouts', 'vite-plugin-vue-layouts-next']) {
      if (plugin in deps) frameworks.add(plugin);
    }

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
    for (const v of stringsIn(pkg.exports)) {
      if (!v.includes('*')) {
        entryField(v, 'package.json "exports"');
        continue;
      }
      // "./components/*": every file the pattern matches can be imported by other packages.
      const pattern = join(v);
      const [before, after] = [pattern.slice(0, pattern.indexOf('*')), pattern.slice(pattern.indexOf('*') + 1)];
      for (const f of files) {
        if (f.path.startsWith(before) && f.path.endsWith(after) && f.path.length >= before.length + after.length) {
          add(f.path, `package.json "exports" pattern ${v}`);
        }
      }
    }

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
    } else if (name === 'angular.json') {
      for (const [file, field] of angularEntries(text)) add(relFrom(dirAbs, file), `${field} in ${rel}`);
    } else if (rel.startsWith('.github/workflows/')) {
      for (const p of codePathsIn(text)) add(relFrom(root, p), `run by ${rel}`);
    }
  }

  // 4. HTML pages.
  for (const htmlRel of htmlFiles) {
    const html = read(htmlRel);
    if (!html) continue;
    const dir = path.posix.dirname(htmlRel) === '.' ? '' : path.posix.dirname(htmlRel);
    // Inline <script type="module"> blocks import files directly.
    for (const m of html.matchAll(/<script\b(?![^>]*\ssrc=)[^>]*\btype=["']module["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
      for (const spec of importSpecifiers(m[1])) {
        const target = importTarget(spec.startsWith('/') ? `./${spec.slice(1)}` : spec, htmlRel);
        if (target) add(target, `<script> in ${htmlRel}`);
      }
    }
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

  // 5. Markdown and MDX pages that import components: MDX import lines, and
  // <script> blocks in VitePress and mdsvex pages.
  for (const docRel of docFiles) {
    const text = read(docRel);
    if (!text || !/(^|\n)\s*import\s|<script/.test(text)) continue;
    const code = text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '');
    const specs = new Set(importSpecifiers(code));
    for (const m of code.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) for (const s of importSpecifiers(m[1])) specs.add(s);
    for (const spec of specs) {
      const target = importTarget(spec, docRel);
      if (target) add(target, `imported in ${docRel}`);
    }
  }

  // 6. What a Vite config sets up: Vue Router's file-based routing, and the folders
  // unplugin-auto-import makes available everywhere (its `dirs` option).
  const autoImportDirs: string[] = [];
  for (const f of files) {
    if (!/^vite\.config\.[cm]?[jt]s$/.test(f.name)) continue;
    const text = read(f.path);
    if (!text) continue;
    if (/from\s+["'](vue-router\/vite|unplugin-vue-router\/vite)["']/.test(text)) frameworks.add('unplugin-vue-router');
    const base = path.posix.dirname(f.path) === '.' ? '' : path.posix.dirname(f.path) + '/';
    const dirs = text.match(/AutoImport\(\{[\s\S]*?\bdirs:\s*\[([^\]]*)\]/);
    if (dirs) {
      for (const m of dirs[1].matchAll(/["']([^"']+)["']/g)) autoImportDirs.push(base + m[1].replace(/^\.\//, '').replace(/\/?\*\*.*$/, '').replace(/\/$/, ''));
    }
  }

  // 7. File conventions and test runner configs.
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
    if (/\.(bench|benchmark)\.[cm]?[jt]sx?$/.test(f.name)) add(p, 'benchmark file (run by vitest bench)');
    if (/(^|\/)public\//.test(p)) add(p, 'static file in public/ (served as is)');
    const autoDir = autoImportDirs.find((d) => p.startsWith(d + '/'));
    if (autoDir) add(p, `auto-imported from ${autoDir} by unplugin-auto-import (no import statement to check)`);
    for (const [framework, rules] of FRAMEWORK_FILES) {
      if (!frameworks.has(framework)) continue;
      const rule = rules.find((r) => r.test.test(p));
      if (rule) add(p, rule.reason);
    }
    if (usesNext) {
      if (/(^|\/)app\//.test(p) && NEXT_APP_FILES.test(p)) add(p, 'Next.js app router file');
      if (/(^|\/)pages\//.test(p)) add(p, 'Next.js pages router file');
      if (/(^|\/)(src\/)?(middleware|instrumentation)\.[cm]?[jt]s$/.test(p)) add(p, 'Next.js special file');
    }
  }

  // 8. Files a tool config names by path: Nuxt modules, Vite plugins, a Playwright
  // reporter. Only strings that resolve to an analyzed file count. This runs last,
  // so a more specific reason found above wins.
  for (const f of files) {
    if (!/\.config\.[cm]?[jt]s$/.test(f.name) && !/(^|\/)\.vitepress\/config\.[cm]?[jt]s$/.test(f.path)) continue;
    const text = read(f.path);
    if (!text) continue;
    // Imports and require() calls are already edges in the graph; only other mentions count here.
    const imported = new Set([...importSpecifiers(text), ...Array.from(text.matchAll(/\brequire\(\s*["']([^"'\n]+)["']\s*\)/g), (m) => m[1])]);
    for (const m of text.matchAll(/["'`]((?:\.{1,2}|~|@)\/[^"'`\s]+)["'`]/g)) {
      if (imported.has(m[1])) continue;
      // A bare top-level folder ('./src', '@/') is how aliases are written; it does not load src/index.
      if (/^(?:\.{1,2}|~|@)\/[^/]*\/?$/.test(m[1]) && !/\.[cm]?[jt]sx?$|\.(vue|svelte|astro)$/.test(m[1])) continue;
      const target = importTarget(m[1], f.path);
      if (target && target !== f.path) add(target, `named in ${f.path}`);
    }
  }

  return Array.from(found, ([file, reason]) => ({ file, reason })).sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Files a framework loads by their name and folder, never through an import.
 * The folders are each framework's documented defaults. Nuxt also imports
 * everything in components/, composables/ and utils/ automatically, so those
 * count as used without an import; the reason says so.
 */
const FRAMEWORK_FILES: Array<[string, Array<{ test: RegExp; reason: string }>]> = [
  ['sveltekit', [
    { test: /(^|\/)src\/routes\/(.*\/)?\+(page|layout|error|server)(@[^./]*)?(\.server)?\.(svelte|[cm]?[jt]s)$/, reason: 'SvelteKit route file' },
    { test: /(^|\/)src\/hooks(\.(server|client|universal))?\.[cm]?[jt]s$/, reason: 'SvelteKit hooks file' },
    { test: /(^|\/)src\/service-worker(\/index)?\.[cm]?[jt]s$/, reason: 'SvelteKit service worker' },
    { test: /(^|\/)src\/params\/[^/]+\.[cm]?[jt]s$/, reason: 'SvelteKit param matcher' },
  ]],
  ['nuxt', [
    { test: /(^|\/)(app\/)?(app|error)\.vue$/, reason: 'Nuxt app file' },
    { test: /(^|\/)(app\/)?(pages|layouts|middleware|plugins)\//, reason: 'Nuxt file convention' },
    { test: /(^|\/)(app\/)?(components|composables|utils)\//, reason: 'Nuxt auto-import (no import statement to check)' },
    { test: /(^|\/)server\/(api|routes|middleware|plugins|utils)\//, reason: 'Nuxt server file convention' },
    { test: /(^|\/)(app\/)?app\.config\.[cm]?[jt]s$/, reason: 'Nuxt app config' },
    { test: /(^|\/)modules\/([^/]+|[^/]+\/index)\.[cm]?[jt]s$/, reason: 'Nuxt local module (loaded from modules/)' },
  ]],
  ['astro', [
    { test: /(^|\/)src\/pages\//, reason: 'Astro page' },
    { test: /(^|\/)src\/middleware(\/index)?\.[cm]?[jt]s$/, reason: 'Astro middleware' },
    { test: /(^|\/)src\/(content\/config|content\.config)\.[cm]?[jt]s$/, reason: 'Astro content config' },
    { test: /(^|\/)src\/actions\/index\.[cm]?[jt]s$/, reason: 'Astro actions' },
  ]],
  ['unplugin-vue-components', [
    { test: /(^|\/)src\/components\/.+\.(vue|[cm]?[jt]sx?)$/, reason: 'auto-imported by unplugin-vue-components (no import statement to check)' },
  ]],
  ['vite-plugin-pages', [{ test: /(^|\/)src\/pages\//, reason: 'page route (vite-plugin-pages)' }]],
  ['unplugin-vue-router', [{ test: /(^|\/)src\/pages\//, reason: 'page route (unplugin-vue-router)' }]],
  ['vite-plugin-vue-layouts', [{ test: /(^|\/)src\/layouts\//, reason: 'layout (vite-plugin-vue-layouts)' }]],
  ['vite-plugin-vue-layouts-next', [{ test: /(^|\/)src\/layouts\//, reason: 'layout (vite-plugin-vue-layouts-next)' }]],
  ['remix', [
    { test: /(^|\/)app\/(root|routes|entry\.client|entry\.server)\.[cm]?[jt]sx?$/, reason: 'Remix / React Router app file' },
    { test: /(^|\/)app\/routes\//, reason: 'Remix / React Router route' },
  ]],
];

/** Code files an angular.json names for each project: main, browser, server, polyfills and the SSR entry. */
function angularEntries(text: string): Array<[string, string]> {
  let json: { projects?: Record<string, { architect?: Record<string, { options?: Record<string, unknown> }>; targets?: Record<string, { options?: Record<string, unknown> }> }> };
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  const out: Array<[string, string]> = [];
  for (const project of Object.values(json.projects ?? {})) {
    for (const target of Object.values(project.architect ?? project.targets ?? {})) {
      const options = target.options ?? {};
      for (const field of ['main', 'browser', 'server', 'polyfills']) {
        for (const v of stringsIn(options[field])) if (/\.[cm]?[jt]s$/.test(v)) out.push([v, `"${field}"`]);
      }
      const ssr = options.ssr;
      if (ssr && typeof ssr === 'object' && typeof (ssr as { entry?: unknown }).entry === 'string') {
        out.push([(ssr as { entry: string }).entry, '"ssr.entry"']);
      }
    }
  }
  return out;
}

/** Module specifiers in import statements and import() calls with a literal string. */
function importSpecifiers(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/^\s*(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\sfrom\s*)?["']([^"'\n]+)["']/gm)) out.push(m[1]);
  for (const m of code.matchAll(/\bimport\(\s*["']([^"'\n]+)["']\s*\)/g)) out.push(m[1]);
  return out;
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
