import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyzeProject, Analyzer, blastRadius, fileDetail } from '../src/index.js';
import { makeProject } from './helpers.js';

const internalEdges = (r: Awaited<ReturnType<typeof analyzeProject>>) =>
  r.imports.filter((i) => i.kind === 'internal').map((i) => `${i.from} -> ${i.to}`).sort();

describe('import resolution', () => {
  it('resolves ESM-style .js specifiers to .ts files', async () => {
    const root = makeProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext' } }),
      'src/a.ts': "import { b } from './b.js';\nexport const a = b;\n",
      'src/b.ts': 'export const b = 1;\n',
      'src/c.ts': "export * from './a.js';\n",
    });
    const r = await analyzeProject(root);
    expect(internalEdges(r)).toEqual(['src/a.ts -> src/b.ts', 'src/c.ts -> src/a.ts']);
    expect(r.resolution.unresolved).toBe(0);
  });

  it('resolves tsconfig path aliases instead of calling them packages', async () => {
    const root = makeProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./*'] } } }),
      'lib/utils.ts': 'export const cn = () => 1;\n',
      'components/button.tsx': "import { cn } from '@/lib/utils';\nexport const Button = () => cn();\n",
      'app/page.tsx': "import { cn } from '@/lib/utils';\nimport React from 'react';\nexport default function Page() { return cn(); }\n",
    });
    const r = await analyzeProject(root);
    expect(internalEdges(r)).toEqual(['app/page.tsx -> lib/utils.ts', 'components/button.tsx -> lib/utils.ts']);
    expect(r.externalPackages.map((p) => p.name)).toEqual(['react']);
  });

  it('counts an alias that resolves to nothing as unresolved, not as a package', async () => {
    const root = makeProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } }),
      'src/a.ts': "import { x } from '@/missing';\nimport { y } from './gone';\nexport const a = 1;\n",
    });
    const r = await analyzeProject(root);
    expect(r.resolution.unresolved).toBe(2);
    expect(r.externalPackages).toEqual([]);
    expect(r.resolution.unresolvedImports.map((u) => u.specifier).sort()).toEqual(['./gone', '@/missing']);
  });

  it('maps workspace packages to their source folders without node_modules', async () => {
    const root = makeProject({
      'package.json': JSON.stringify({ name: 'mono', private: true, workspaces: ['packages/*'] }),
      'packages/ui/package.json': JSON.stringify({ name: '@acme/ui', main: 'dist/index.js' }),
      'packages/ui/src/index.ts': "export * from './button';\n",
      'packages/ui/src/button.ts': 'export const Button = 1;\n',
      'packages/app/package.json': JSON.stringify({ name: '@acme/app' }),
      'packages/app/src/main.ts': "import { Button } from '@acme/ui';\nimport { Button as B } from '@acme/ui/button';\nexport const x = [Button, B];\n",
    });
    const r = await analyzeProject(root);
    expect(internalEdges(r)).toEqual([
      'packages/app/src/main.ts -> packages/ui/src/button.ts',
      'packages/app/src/main.ts -> packages/ui/src/index.ts',
      'packages/ui/src/index.ts -> packages/ui/src/button.ts',
    ]);
    expect(r.imports.filter((i) => i.resolvedBy === 'workspace')).toHaveLength(2);
  });

  it('finds re-exports, dynamic imports, require calls and type-only imports', async () => {
    const root = makeProject({
      'index.ts': "export * from './a';\nexport { b } from './b';\n",
      'a.ts': "import type { T } from './types';\nexport const a = 1 as unknown as T;\n",
      'b.ts': "export const b = () => import('./lazy');\n",
      'c.js': "const d = require('./d');\nmodule.exports = d;\n",
      'd.js': 'module.exports = 1;\n',
      'lazy.ts': 'export default 1;\n',
      'types.ts': 'export type T = number;\n',
    });
    const r = await analyzeProject(root);
    const bySyntax = (s: string) => r.imports.filter((i) => i.syntax === s && i.kind === 'internal').map((i) => i.to).sort();
    expect(bySyntax('export')).toEqual(['a.ts', 'b.ts']);
    expect(bySyntax('dynamic')).toEqual(['lazy.ts']);
    expect(bySyntax('require')).toEqual(['d.js']);
    expect(r.imports.find((i) => i.to === 'types.ts')?.typeOnly).toBe(true);
  });

  it('treats stylesheets and images as assets, not unresolved code', async () => {
    const root = makeProject({
      'a.tsx': "import './a.scss';\nimport logo from './logo.svg';\nimport raw from './x.ts?raw';\nexport default [logo, raw];\n",
      'a.scss': 'a {}',
    });
    const r = await analyzeProject(root);
    expect(r.resolution.asset).toBe(3);
    expect(r.resolution.unresolved).toBe(0);
  });
});

describe('discovery', () => {
  it('works when the project lives under a folder named build, dist or e2e', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'tsight-'));
    const root = path.join(parent, 'my-builds', 'dist-e2e-project');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a = 1;\n');
    const r = await analyzeProject(root);
    expect(r.files.map((f) => f.path)).toEqual(['src/a.ts']);
  });

  it('skips build output and .gitignore entries by whole name, and keeps lookalike folders', async () => {
    const root = makeProject({
      '.gitignore': 'generated/\n*.local.ts\n',
      'src/builders/make.ts': 'export const make = 1;\n',
      'src/distance.ts': 'export const d = 1;\n',
      'dist/out.js': 'module.exports = 1;\n',
      'generated/api.ts': 'export const g = 1;\n',
      'src/secret.local.ts': 'export const s = 1;\n',
      'src/types.d.ts': 'declare const x: number;\n',
    });
    const r = await analyzeProject(root);
    expect(r.files.map((f) => f.path).sort()).toEqual(['src/builders/make.ts', 'src/distance.ts']);
  });

  it('keeps test files and tags them', async () => {
    const root = makeProject({
      'src/a.ts': 'export const a = 1;\n',
      'src/a.test.ts': "import { a } from './a';\nexport const t = a;\n",
      'src/__tests__/b.ts': 'export const b = 1;\n',
    });
    const r = await analyzeProject(root);
    const roles = Object.fromEntries(r.files.map((f) => [f.path, f.role]));
    expect(roles).toEqual({ 'src/a.ts': 'source', 'src/a.test.ts': 'test', 'src/__tests__/b.ts': 'test' });
    expect(r.stats.totalFiles).toBe(1);
    expect(r.stats.testFiles).toBe(2);
  });

  it('does not carry files from one analysis into the next', async () => {
    const one = makeProject({ 'one.ts': 'export const one = 1;\n' });
    const two = makeProject({ 'two.ts': 'export const two = 2;\n' });
    const analyzer = new Analyzer();
    await analyzer.analyze(one);
    const r = await analyzer.analyze(two);
    expect(r.files.map((f) => f.path)).toEqual(['two.ts']);
  });
});

describe('dependents and blast radius', () => {
  const project = () =>
    makeProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } }),
      'src/api.ts': 'export const api = 1;\n',
      'src/apiHelpers.ts': 'export const helper = 1;\n',
      'src/lib/utils.ts': 'export const cn = 1;\n',
      'src/a.ts': "import { cn } from '@/lib/utils';\nimport { helper } from './apiHelpers';\nexport const a = cn + helper;\n",
      'src/b.ts': "import { cn } from './lib/utils';\nexport const b = cn;\n",
      'src/c.ts': "import { a } from './a';\nexport const c = a;\n",
    });

  it('counts aliased importers and never calls a used file safe', async () => {
    const r = await analyzeProject(project());
    const br = blastRadius(r, 'src/lib/utils.ts')!;
    expect(br.directImpact).toBe(2);
    expect(br.indirectImpact).toBe(1);
    expect(br.levels.map((l) => l.files.map((f) => f.file))).toEqual([['src/a.ts', 'src/b.ts'], ['src/c.ts']]);
    expect(br.summary).not.toMatch(/safe/i);
  });

  it('matches importers by exact path, not by prefix', async () => {
    const r = await analyzeProject(project());
    expect(fileDetail(r, 'src/api.ts')!.importedBy).toEqual([]);
    expect(fileDetail(r, 'src/apiHelpers.ts')!.importedBy.map((i) => i.file)).toEqual(['src/a.ts']);
  });

  it('mentions unresolved imports when it reports no importers', async () => {
    const root = makeProject({ 'a.ts': "import x from './missing';\nexport default x;\n", 'b.ts': 'export const b = 1;\n' });
    const r = await analyzeProject(root);
    expect(blastRadius(r, 'b.ts')!.summary).toMatch(/1 import in the project could not be resolved/);
  });
});
