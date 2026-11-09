import { describe, it, expect } from 'vitest';
import { analyzeProject } from '../src/index.js';
import { componentScript } from '../src/internal/framework.js';
import { makeProject } from './helpers.js';

const analyze = async (files: Record<string, string>) => {
  const r = await analyzeProject(makeProject(files));
  const edges = r.imports.filter((i) => i.kind === 'internal').map((i) => `${i.from} -> ${i.to}`).sort();
  const entries = Object.fromEntries(r.entryPoints.map((e) => [e.file, e.reason]));
  const noImporters = r.issues.filter((i) => i.type === 'dead-code').map((i) => i.file).sort();
  return { r, edges, entries, noImporters };
};

describe('component files', () => {
  it('keeps the length and line numbers of the file and blanks everything outside the scripts', () => {
    const vue = '<template>\n  <div>{{ a }}</div>\n</template>\n<script setup lang="ts">\nimport { a } from "./a";\n</script>\n<style>\n.x { color: red }\n</style>\n';
    const { text } = componentScript('C.vue', vue);
    expect(text.length).toBe(vue.length);
    expect(text.split('\n')[4]).toBe('import { a } from "./a";');
    expect(text).not.toContain('template');
    expect(text).not.toContain('color');
  });

  it('skips script tags that hold data, like JSON-LD', () => {
    const { text } = componentScript('P.astro', '<script type="application/ld+json">{"@type":"Thing"}</script>\n');
    expect(text.trim()).toBe('');
  });

  it('follows imports in Vue script blocks, including <script setup> and the @ alias from tsconfig', async () => {
    const { edges, noImporters, r } = await analyze({
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } }),
      'index.html': '<script type="module" src="/src/main.ts"></script>',
      'src/main.ts': "import App from './App.vue';\nexport default App;\n",
      'src/App.vue': '<template><Button /></template>\n<script setup lang="ts">\nimport Button from "@/components/Button.vue";\nimport { useCount } from "./composables/count";\n</script>\n',
      'src/components/Button.vue': '<template><button /></template>\n<script>\nexport default { name: "Button" };\n</script>\n',
      'src/composables/count.ts': 'export function useCount() { return 1; }\n',
      'src/components/Unused.vue': '<template><p /></template>\n',
    });
    expect(edges).toEqual([
      'src/App.vue -> src/components/Button.vue',
      'src/App.vue -> src/composables/count.ts',
      'src/main.ts -> src/App.vue',
    ]);
    expect(noImporters).toEqual(['src/components/Unused.vue']);
    expect(r.files.find((f) => f.path === 'src/App.vue')?.lines).toBe(5);
    expect(r.languages.map((l) => l.language)).toContain('Vue');
  });

  it('resolves $lib in SvelteKit without the generated .svelte-kit folder, and knows route files', async () => {
    const { edges, entries, noImporters } = await analyze({
      'package.json': JSON.stringify({ name: 'app', devDependencies: { '@sveltejs/kit': '^2.0.0' } }),
      'svelte.config.js': 'export default {};\n',
      'src/routes/+page.svelte': '<script lang="ts">\n  import Card from "$lib/Card.svelte";\n  import { format } from "$lib/format";\n</script>\n<Card />\n',
      'src/routes/blog/+page.server.ts': 'export function load() { return {}; }\n',
      'src/lib/Card.svelte': '<script>\n  export let title = "";\n</script>\n<h1>{title}</h1>\n',
      'src/lib/format.ts': 'export const format = (s: string) => s;\n',
      'src/hooks.server.ts': 'export async function handle() {}\n',
    });
    expect(edges).toEqual(['src/routes/+page.svelte -> src/lib/Card.svelte', 'src/routes/+page.svelte -> src/lib/format.ts']);
    expect(entries['src/routes/+page.svelte']).toBe('SvelteKit route file');
    expect(entries['src/routes/blog/+page.server.ts']).toBe('SvelteKit route file');
    expect(entries['src/hooks.server.ts']).toBe('SvelteKit hooks file');
    expect(noImporters).toEqual([]);
  });

  it('counts $lib as an unresolved alias, not a package, when there is no svelte.config', async () => {
    const { r } = await analyze({ 'src/a.ts': 'import x from "$lib/x";\nexport default x;\n' });
    expect(r.imports.find((i) => i.specifier === '$lib/x')?.kind).toBe('unresolved');
  });

  it('reads imports in Astro frontmatter and client scripts', async () => {
    const { edges, entries } = await analyze({
      'package.json': JSON.stringify({ name: 'site', dependencies: { astro: '^4.0.0' } }),
      'src/pages/index.astro': '---\nimport Layout from "../layouts/Layout.astro";\nconst title = "Home";\n---\n<Layout title={title} />\n<script>\n  import { track } from "../lib/track";\n  track();\n</script>\n',
      'src/layouts/Layout.astro': '---\nconst { title } = Astro.props;\n---\n<html><title>{title}</title></html>\n',
      'src/lib/track.ts': 'export function track() {}\n',
    });
    expect(edges).toEqual(['src/pages/index.astro -> src/layouts/Layout.astro', 'src/pages/index.astro -> src/lib/track.ts']);
    expect(entries['src/pages/index.astro']).toBe('Astro page');
  });

  it('reads the entry files of each project in angular.json', async () => {
    const { entries, noImporters } = await analyze({
      'angular.json': JSON.stringify({
        projects: {
          app: {
            architect: {
              build: { options: { browser: 'src/main.ts', server: 'src/main.server.ts', polyfills: ['zone.js'], ssr: { entry: 'server.ts' } } },
              test: { options: { main: 'src/test.ts' } },
            },
          },
        },
      }),
      'src/main.ts': 'export {};\n',
      'src/main.server.ts': 'export {};\n',
      'server.ts': 'export {};\n',
      'src/test.ts': 'export {};\n',
    });
    expect(entries['src/main.ts']).toBe('"browser" in angular.json');
    expect(entries['src/main.server.ts']).toBe('"server" in angular.json');
    expect(entries['server.ts']).toBe('"ssr.entry" in angular.json');
    expect(entries['src/test.ts']).toBe('"main" in angular.json');
    expect(noImporters).toEqual([]);
  });

  it('marks Nuxt auto-imported folders as used, and says that no import was checked', async () => {
    const { entries } = await analyze({
      'package.json': JSON.stringify({ name: 'n', devDependencies: { nuxt: '^3.0.0' } }),
      'nuxt.config.ts': 'export default {};\n',
      'app.vue': '<template><NuxtPage /></template>\n',
      'components/Hello.vue': '<template><p /></template>\n',
      'composables/useX.ts': 'export const useX = () => 1;\n',
      'pages/index.vue': '<script setup>\nimport { helper } from "~/lib/helper";\n</script>\n',
      'lib/helper.ts': 'export const helper = 1;\n',
    });
    expect(entries['app.vue']).toBe('Nuxt app file');
    expect(entries['components/Hello.vue']).toBe('Nuxt auto-import (no import statement to check)');
    expect(entries['composables/useX.ts']).toBe('Nuxt auto-import (no import statement to check)');
    expect(entries['pages/index.vue']).toBe('Nuxt file convention');
    expect(entries['lib/helper.ts']).toBeUndefined();
  });

  it('resolves ~ in Nuxt to the project folder', async () => {
    const { edges } = await analyze({
      'package.json': JSON.stringify({ name: 'n', devDependencies: { nuxt: '^3.0.0' } }),
      'nuxt.config.ts': 'export default {};\n',
      'pages/index.vue': '<script setup>\nimport { helper } from "~/lib/helper";\n</script>\n',
      'lib/helper.ts': 'export const helper = 1;\n',
    });
    expect(edges).toEqual(['pages/index.vue -> lib/helper.ts']);
  });

  it('leaves components out of whole-file duplicates, since only their scripts are parsed', async () => {
    const script = '<script>\n' + Array.from({ length: 20 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n</script>\n';
    const { r } = await analyze({ 'A.vue': '<template><a /></template>\n' + script, 'B.vue': '<template><b /></template>\n' + script });
    expect(r.duplicates.filter((d) => d.type === 'exact-file')).toEqual([]);
  });
});

describe('files loaded from docs, HTML, configs and package exports', () => {
  it('counts components imported in MDX pages and in <script> blocks of Markdown pages', async () => {
    const { entries, noImporters } = await analyze({
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '~/*': ['./src/*'] } } }),
      'docs/guide.mdx': "import Card from '~/components/Card.astro';\n\n# Guide\n\n<Card />\n",
      'docs/blog.md': '<script setup>\nimport BlogIndex from "../src/components/BlogIndex.vue"\n</script>\n\n# Blog\n',
      'docs/example.md': '# Example\n\n```ts\nimport { Fake } from "../src/components/Fake";\n```\n',
      'src/components/Card.astro': '<div />\n',
      'src/components/BlogIndex.vue': '<template><div /></template>\n',
      'src/components/Fake.ts': 'export const Fake = 1;\n',
    });
    expect(entries['src/components/Card.astro']).toBe('imported in docs/guide.mdx');
    expect(entries['src/components/BlogIndex.vue']).toBe('imported in docs/blog.md');
    // An import inside a fenced code block is an example, not a use.
    expect(noImporters).toEqual(['src/components/Fake.ts']);
  });

  it('counts files imported by inline module scripts in HTML', async () => {
    const { entries } = await analyze({
      'play/index.html': '<script type="module">\n  import "./setup.ts";\n  import "/main.ts";\n</script>\n',
      'play/setup.ts': 'export {};\n',
      'play/main.ts': 'export {};\n',
    });
    expect(entries['play/setup.ts']).toBe('<script> in play/index.html');
    expect(entries['play/main.ts']).toBe('<script> in play/index.html');
  });

  it('expands * patterns in package.json exports', async () => {
    const { entries, noImporters } = await analyze({
      'pkg/package.json': JSON.stringify({ name: 'pkg', exports: { './components/*': './components/*' } }),
      'pkg/components/Banner.astro': '<div />\n',
      'pkg/other/Hidden.ts': 'export const h = 1;\n',
    });
    expect(entries['pkg/components/Banner.astro']).toBe('package.json "exports" pattern ./components/*');
    expect(noImporters).toEqual(['pkg/other/Hidden.ts']);
  });

  it('counts files a framework config names by path, but not an alias to a folder', async () => {
    const { entries } = await analyze({
      'package.json': JSON.stringify({ name: 'n', devDependencies: { nuxt: '^3.0.0' } }),
      'nuxt.config.ts': "export default { modules: ['~/tools/purge'], alias: { '@x': './lib' } };\n",
      'tools/purge.ts': 'export default {};\n',
      'lib/index.ts': 'export {};\n',
    });
    expect(entries['tools/purge.ts']).toBe('named in nuxt.config.ts');
    expect(entries['lib/index.ts']).toBeUndefined();
  });

  it('resolves #shared and treats Nuxt-generated modules as coming from nuxt', async () => {
    const { edges, r } = await analyze({
      'package.json': JSON.stringify({ name: 'n', devDependencies: { nuxt: '^4.0.0' } }),
      'nuxt.config.ts': 'export default {};\n',
      'app/pages/index.vue': '<script setup lang="ts">\nimport type { User } from "#shared/types";\nimport { ref } from "#imports";\n</script>\n',
      'shared/types.ts': 'export interface User { id: string }\n',
    });
    expect(edges).toEqual(['app/pages/index.vue -> shared/types.ts']);
    expect(r.imports.find((i) => i.specifier === '#imports')?.kind).toBe('external');
  });

  it('knows the folders that installed Vue plugins load', async () => {
    const { entries } = await analyze({
      'package.json': JSON.stringify({ name: 'v', devDependencies: { 'unplugin-vue-components': '1', 'unplugin-vue-router': '1', 'vite-plugin-vue-layouts': '1' } }),
      'src/components/TheFooter.vue': '<template><footer /></template>\n',
      'src/pages/index.vue': '<template><main /></template>\n',
      'src/layouts/default.vue': '<template><RouterView /></template>\n',
    });
    expect(entries['src/components/TheFooter.vue']).toBe('auto-imported by unplugin-vue-components (no import statement to check)');
    expect(entries['src/pages/index.vue']).toBe('page route (unplugin-vue-router)');
    expect(entries['src/layouts/default.vue']).toBe('layout (vite-plugin-vue-layouts)');
  });

  it('resolves ./test.astro to a code file named test.astro.js', async () => {
    const { edges } = await analyze({ 'index.js': "const { astro } = require('./test.astro');\nmodule.exports = astro;\n", 'test.astro.js': 'module.exports = { astro: 1 };\n' });
    expect(edges).toEqual(['index.js -> test.astro.js']);
  });
});

describe('what a Vite or Nuxt setup loads without an import', () => {
  it('reads Vue Router file routing and unplugin-auto-import dirs from vite.config', async () => {
    const { entries, noImporters } = await analyze({
      'vite.config.ts': "import VueRouter from 'vue-router/vite'\nimport AutoImport from 'unplugin-auto-import/vite'\nexport default { plugins: [VueRouter(), AutoImport({ imports: ['vue'], dirs: ['src/composables', './src/stores/**'] })] }\n",
      'src/pages/index.vue': '<template><main /></template>\n',
      'src/composables/dark.ts': 'export const isDark = true;\n',
      'src/stores/user.ts': 'export const useUser = () => 1;\n',
      'src/other/loose.ts': 'export const loose = 1;\n',
    });
    expect(entries['src/pages/index.vue']).toBe('page route (unplugin-vue-router)');
    expect(entries['src/composables/dark.ts']).toBe('auto-imported from src/composables by unplugin-auto-import (no import statement to check)');
    expect(entries['src/stores/user.ts']).toBe('auto-imported from src/stores by unplugin-auto-import (no import statement to check)');
    expect(noImporters).toEqual(['src/other/loose.ts']);
  });

  it('knows Nuxt loads modules/ by itself', async () => {
    const { entries } = await analyze({
      'package.json': JSON.stringify({ name: 'n', devDependencies: { nuxt: '^3.0.0' } }),
      'nuxt.config.ts': 'export default {};\n',
      'modules/purge.ts': 'export default {};\n',
      'modules/pwa/index.ts': 'export default {};\n',
      'modules/pwa/runtime/helper.ts': 'export const h = 1;\n',
    });
    expect(entries['modules/purge.ts']).toBe('Nuxt local module (loaded from modules/)');
    expect(entries['modules/pwa/index.ts']).toBe('Nuxt local module (loaded from modules/)');
    expect(entries['modules/pwa/runtime/helper.ts']).toBeUndefined();
  });

  it('treats SvelteKit route types as generated, not as a missing file', async () => {
    const { r } = await analyze({
      'svelte.config.js': 'export default {};\n',
      'src/routes/+page.ts': "import type { PageLoad } from './$types';\nexport const load: PageLoad = () => ({});\n",
    });
    expect(r.imports.find((i) => i.specifier === './$types')?.kind).toBe('external');
    expect(r.resolution.unresolved).toBe(0);
  });
});

describe('more ways a file gets loaded', () => {
  it('follows <script src> in Astro components', async () => {
    const { edges, r } = await analyze({
      'src/Page.astro': '---\nconst a = 1;\n---\n<div />\n<script src="../lib/persist"></script>\n',
      'lib/persist.ts': 'export {};\n',
    });
    expect(edges).toEqual(['src/Page.astro -> lib/persist.ts']);
    expect(r.imports.find((i) => i.to === 'lib/persist.ts')?.line).toBe(5);
  });

  it('counts benchmark files and files any tool config names by path', async () => {
    const { entries } = await analyze({
      'playwright.config.ts': "export default { reporter: [['./a11y/reporter.ts']] };\n",
      'a11y/reporter.ts': 'export default class R {}\n',
      'src/route.bench.ts': 'export {};\n',
    });
    expect(entries['a11y/reporter.ts']).toBe('named in playwright.config.ts');
    expect(entries['src/route.bench.ts']).toBe('benchmark file (run by vitest bench)');
  });

  it('does not count a normal import in a file that happens to end in .config.ts', async () => {
    const { entries, edges } = await analyze({
      'src/main.ts': "import { appConfig } from './app.config';\nexport default appConfig;\n",
      'src/app.config.ts': "import { api } from './api';\nexport const appConfig = { api };\n",
      'src/api.ts': 'export const api = 1;\n',
      'package.json': JSON.stringify({ name: 'a', main: 'src/main.ts' }),
    });
    expect(edges).toContain('src/app.config.ts -> src/api.ts');
    expect(entries['src/api.ts']).toBeUndefined();
  });
});
