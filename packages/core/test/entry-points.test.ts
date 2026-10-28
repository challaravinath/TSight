import { describe, it, expect } from 'vitest';
import { analyzeProject } from '../src/index.js';
import { makeProject } from './helpers.js';

const reasons = async (files: Record<string, string>) => {
  const r = await analyzeProject(makeProject(files));
  return {
    entries: Object.fromEntries(r.entryPoints.map((e) => [e.file, e.reason])),
    noImporters: r.issues.filter((i) => i.type === 'dead-code').map((i) => i.file).sort(),
    r,
  };
};

describe('entry points from configs and conventions', () => {
  it('reads the main file of a Cloudflare worker from wrangler.toml and wrangler.jsonc', async () => {
    const { entries } = await reasons({
      'workers/a/wrangler.toml': 'name = "a"\nmain = "src/worker.ts"\n',
      'workers/a/src/worker.ts': 'export default {};\n',
      'workers/b/wrangler.jsonc': '{\n  // comment\n  "main": "./src/index.ts"\n}\n',
      'workers/b/src/index.ts': 'export default {};\n',
    });
    expect(entries['workers/a/src/worker.ts']).toBe('main in workers/a/wrangler.toml');
    expect(entries['workers/b/src/index.ts']).toBe('main in workers/b/wrangler.jsonc');
  });

  it('reads setupFiles from vitest and jest configs', async () => {
    const { entries, noImporters } = await reasons({
      'pkg/vitest.config.ts': "export default { test: { setupFiles: ['./setupVitest.js', '../shared/setup.ts'] } };\n",
      'pkg/setupVitest.js': 'globalThis.x = 1;\n',
      'shared/setup.ts': 'export {};\n',
      'pkg/setupTests.js': 'globalThis.y = 1;\n',
      'jest.config.js': "module.exports = { setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'] };\n",
      'jest.setup.ts': 'export {};\n',
    });
    expect(entries['pkg/setupVitest.js']).toBe('setup file in pkg/vitest.config.ts');
    expect(entries['shared/setup.ts']).toBe('setup file in pkg/vitest.config.ts');
    expect(entries['jest.setup.ts']).toBe('setup file in jest.config.js');
    // A setup file no config mentions is still reported.
    expect(noImporters).toEqual(['pkg/setupTests.js']);
  });

  it('treats files under public/ as served as is', async () => {
    const { entries } = await reasons({ 'app/public/sw.js': 'self.addEventListener("fetch", () => {});\n' });
    expect(entries['app/public/sw.js']).toBe('static file in public/ (served as is)');
  });

  it('follows scripts named in GitHub workflows', async () => {
    const { entries } = await reasons({
      '.github/workflows/release.yml': 'jobs:\n  r:\n    steps:\n      - run: yarn tsx internal/scripts/release.ts --dry\n',
      'internal/scripts/release.ts': 'console.log(1);\n',
    });
    expect(entries['internal/scripts/release.ts']).toBe('run by .github/workflows/release.yml');
  });

  it('maps a package entry in dist back to its source file', async () => {
    const { entries } = await reasons({
      'ext/package.json': JSON.stringify({ name: 'ext', main: './dist/web/extension.js', bin: { cli: 'dist/cli.js' } }),
      'ext/src/extension.ts': 'export function activate() {}\n',
      'ext/src/cli.ts': 'console.log(1);\n',
    });
    expect(entries['ext/src/extension.ts']).toBe('package.json "main" (built from src)');
    expect(entries['ext/src/cli.ts']).toBe('package.json "bin" (built from src)');
  });

  it('uses entryPoints declared in tsight.config.json', async () => {
    const { entries, noImporters } = await reasons({
      'tsight.config.json': JSON.stringify({ entryPoints: ['examples/**/*Example.tsx'] }),
      'examples/basic/BasicExample.tsx': 'export default function BasicExample() { return null; }\n',
      'examples/basic/helper.ts': 'export const h = 1;\n',
    });
    expect(entries['examples/basic/BasicExample.tsx']).toBe('tsight.config.json entryPoints');
    expect(noImporters).toEqual(['examples/basic/helper.ts']);
  });
});

describe('import.meta.glob', () => {
  it('turns each matched code file into an import, lazy unless eager', async () => {
    const { r, noImporters } = await reasons({
      'src/main.ts': "const pages = import.meta.glob('./pages/*.tsx');\nconst eager = import.meta.glob(['./widgets/*.ts', '!./widgets/skip.ts'], { eager: true });\nconst docs = import.meta.glob('./docs/*.md');\nexport default [pages, eager, docs];\n",
      'src/pages/Home.tsx': 'export default 1;\n',
      'src/pages/About.tsx': 'export default 2;\n',
      'src/widgets/a.ts': 'export default 1;\n',
      'src/widgets/skip.ts': 'export default 2;\n',
      'index.html': '<script type="module" src="/src/main.ts"></script>',
    });
    const globs = r.imports.filter((i) => i.syntax === 'glob').map((i) => `${i.to} ${i.kind}${i.lazy ? ' lazy' : ''}`).sort();
    expect(globs).toEqual(['./docs/*.md asset', 'src/pages/About.tsx internal lazy', 'src/pages/Home.tsx internal lazy', 'src/widgets/a.ts internal']);
    expect(noImporters).toEqual(['src/widgets/skip.ts']);
  });
});

describe('numbers that must agree', () => {
  // 4,001 files: slow to write and parse on Windows runners.
  it('never rounds the resolution rate up to 100%', { timeout: 180_000 }, async () => {
    const files: Record<string, string> = { 'missing.ts': "import x from './nope';\nexport default x;\n" };
    for (let i = 0; i < 2000; i++) files[`f${i}.ts`] = `import y from './g${i}';\nexport default y;\n`;
    for (let i = 0; i < 2000; i++) files[`g${i}.ts`] = 'export default 1;\n';
    const r = await analyzeProject(makeProject(files));
    const { codebaseFacts } = await import('../src/index.js');
    expect(codebaseFacts(r).resolution.percentResolved).toBe(99.9);
  });

  it('lists the same exports in the panel as it counts', async () => {
    const r = await analyzeProject(
      makeProject({ 'a.ts': 'export class A {}\nexport interface B {}\nexport type C = 1;\nexport const d = 1;\nexport function e() {}\n' }),
    );
    const { fileDetail } = await import('../src/index.js');
    const d = fileDetail(r, 'a.ts')!;
    expect(d.metrics.totalExports).toBe(5);
    expect(d.allExports.map((x) => `${x.name}:${x.type}`)).toEqual(['A:class', 'B:interface', 'C:export', 'd:export', 'e:function']);
  });
});
