/**
 * Cases from an independent review of the engine. Each one produced a
 * wrong number before it was fixed.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyzeProject, unusedExports, readGitHistory, ownership } from '../src/index.js';
import { makeProject, gitIn, writeFile } from './helpers.js';

const edges = (r: Awaited<ReturnType<typeof analyzeProject>>) =>
  r.imports.map((i) => `${i.from} -> ${i.to} [${i.kind}]`).sort();

describe('resolution edge cases', () => {
  it('follows tsconfig references (the Vite react-ts layout)', async () => {
    const r = await analyzeProject(
      makeProject({
        'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './tsconfig.app.json' }, { path: './tsconfig.node.json' }] }),
        'tsconfig.app.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] }, moduleResolution: 'bundler', module: 'esnext' }, include: ['src'] }),
        'tsconfig.node.json': JSON.stringify({ compilerOptions: { moduleResolution: 'bundler', module: 'esnext' }, include: ['vite.config.ts'] }),
        'src/main.ts': "import { util } from '@/lib/util';\nconsole.log(util);\n",
        'src/lib/util.ts': 'export const util = 1;\n',
      }),
    );
    expect(edges(r)).toEqual(['src/main.ts -> src/lib/util.ts [internal]']);
  });

  it('never calls an @/ or ~/ specifier a package', async () => {
    const r = await analyzeProject(makeProject({ 'a.ts': "import x from '@/nowhere';\nimport y from '~/also-nowhere';\nexport default [x, y];\n" }));
    expect(r.resolution.unresolved).toBe(2);
    expect(r.externalPackages).toEqual([]);
  });

  it('prefers the source file over a .d.ts next to it', async () => {
    const r = await analyzeProject(
      makeProject({
        'src/index.js': "import { help } from './helper';\nexport default help;\n",
        'src/helper.js': 'export const help = 1;\n',
        'src/helper.d.ts': 'export declare const help: number;\n',
      }),
    );
    expect(edges(r)).toEqual(['src/index.js -> src/helper.js [internal]']);
  });

  it('maps a built workspace package back to its source, whether or not dist exists', async () => {
    const files = {
      'package.json': JSON.stringify({ private: true, workspaces: ['packages/*'] }),
      'packages/core/package.json': JSON.stringify({ name: '@x/core', main: 'dist/index.js', types: 'dist/index.d.ts' }),
      'packages/core/src/index.ts': 'export const core = 1;\n',
      'packages/app/package.json': JSON.stringify({ name: '@x/app' }),
      'packages/app/src/main.ts': "import { core } from '@x/core';\nexport const app = core;\n",
    };
    const root = makeProject(files);
    const before = edges(await analyzeProject(root));
    // Simulate a build and an installed workspace link.
    writeFile(root, 'packages/core/dist/index.d.ts', 'export declare const core: number;\n');
    fs.mkdirSync(path.join(root, 'node_modules', '@x'), { recursive: true });
    fs.symlinkSync(path.join(root, 'packages', 'core'), path.join(root, 'node_modules', '@x', 'core'), 'dir');
    const after = edges(await analyzeProject(root));
    expect(before).toEqual(['packages/app/src/main.ts -> packages/core/src/index.ts [internal]']);
    expect(after).toEqual(before);
  });

  it('resolves code files whose names look like assets (vanilla-extract)', async () => {
    const r = await analyzeProject(
      makeProject({
        'src/index.ts': "import { button } from './button.css';\nimport './real.css';\nexport default button;\n",
        'src/button.css.ts': 'export const button = 1;\n',
      }),
    );
    expect(edges(r)).toEqual(['src/index.ts -> ./real.css [asset]', 'src/index.ts -> src/button.css.ts [internal]']);
  });

  it('gives the same graph when the root is reached through a symlink', async () => {
    const real = makeProject({
      'package.json': JSON.stringify({ private: true, workspaces: ['packages/*'] }),
      'packages/b/package.json': JSON.stringify({ name: 'b' }),
      'packages/b/src/index.ts': 'export const b = 1;\n',
      'packages/a/src/index.ts': "import { b } from 'b';\nexport const a = b;\n",
    });
    fs.mkdirSync(path.join(real, 'node_modules'), { recursive: true });
    fs.symlinkSync(path.join(real, 'packages', 'b'), path.join(real, 'node_modules', 'b'), 'dir');
    const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tsight-link-')), 'project');
    fs.symlinkSync(real, link, 'dir');
    expect(edges(await analyzeProject(link))).toEqual(['packages/a/src/index.ts -> packages/b/src/index.ts [internal]']);
  });

  it('expands workspace globs with a prefix, like packages/plugin-*', async () => {
    const r = await analyzeProject(
      makeProject({
        'pnpm-workspace.yaml': "packages:\n  - 'packages/plugin-*'\n",
        'packages/plugin-foo/package.json': JSON.stringify({ name: '@x/plugin-foo' }),
        'packages/plugin-foo/src/index.ts': 'export const foo = 1;\n',
        'app/main.ts': "import { foo } from '@x/plugin-foo';\nexport default foo;\n",
      }),
    );
    expect(edges(r)).toEqual(['app/main.ts -> packages/plugin-foo/src/index.ts [internal]']);
  });

  it('treats export { type A } from as type-only, so it cannot form a cycle', async () => {
    const r = await analyzeProject(
      makeProject({
        'a.ts': "export { type B } from './b';\nexport const a = 1;\n",
        'b.ts': "import { a } from './a';\nexport type B = number;\nexport const b = a;\n",
      }),
    );
    expect(r.dependencyGraph.cycleGroups).toEqual([]);
  });
});

describe('discovery inside git', () => {
  it('lists exactly what git tracks, including a src/build folder and negated ignores', async () => {
    const root = makeProject({
      '.gitignore': 'gen/*\n',
      'gen/.gitignore': '!keep.ts\n',
      'gen/keep.ts': 'export const keep = 1;\n',
      'gen/drop.ts': 'export const drop = 1;\n',
      'src/build/steps.ts': 'export const steps = 1;\n',
    });
    gitIn(root, ['init', '-q']);
    gitIn(root, ['add', '-f', '.gitignore', 'gen/.gitignore', 'gen/keep.ts', 'src/build/steps.ts']);
    gitIn(root, ['commit', '-q', '-m', 'init'], 'Dev');
    const r = await analyzeProject(root);
    expect(r.files.map((f) => f.path)).toEqual(['gen/keep.ts', 'src/build/steps.ts']);
  });
});

describe('metric edge cases', () => {
  it('does not treat // inside template literals or JSX text as a comment', async () => {
    const pad = 'export const a1 = 1; export const a2 = 2; export const a3 = 3; export const a4 = 4;\n';
    const r = await analyzeProject(
      makeProject({
        'a.ts': pad + 'export const url = (host: string) => `https://${host}//api/v1/users/delete`;\n',
        'b.ts': pad + 'export const url = (host: string) => `https://${host}//admin/drop-all-tables?confirm=yes`;\n',
        'c.tsx': pad + 'export const T = () => <p>See https://example.com/terms for details</p>;\n',
        'd.tsx': pad + 'export const T = () => <p>See https://evil.example/other for details</p>;\n',
      }),
    );
    expect(r.duplicates).toEqual([]);
  });

  it('does not pair functions that differ in an operator or in a nested handler', async () => {
    const counter = (name: string, op: string) => `
export function ${name}(state: { n: number; log: string[] }, by: number) {
  let i = 0;
  while (i < by) { ${op}; i++; }
  state.log.push('changed ' + state.n);
  if (state.log.length > 100) { state.log.shift(); }
  return { value: state.n, entries: state.log.length, last: state.log[state.log.length - 1] };
}
`;
    const button = (name: string, body: string) => `
export function ${name}(props: any) {
  const meta = { at: Date.now(), by: props.user.name, reason: props.reason, source: props.source };
  props.history.push(meta);
  console.log(meta.at, meta.by, meta.reason, meta.source, props.history.length);
  const onClick = () => { ${body} };
  return <button className="btn" onClick={onClick} disabled={props.busy}>{props.label}</button>;
}
`;
    const r = await analyzeProject(
      makeProject({
        'inc.ts': counter('increment', 'state.n++'),
        'dec.ts': counter('decrement', 'state.n--'),
        'save.tsx': button('SaveButton', 'props.api.save(props.doc); props.close();'),
        'del.tsx': button('DeleteButton', "if (confirm('sure?')) { props.api.deleteAll(props.user, { force: true }); window.location.href = '/'; }"),
      }),
    );
    expect(r.structuralTwins).toEqual([]);
  });

  it('scores functions passed to a call at the top level of a file', async () => {
    const r = await analyzeProject(
      makeProject({
        'index.tsx': `import { forwardRef } from 'react';
export const Button = forwardRef((p: any, ref: any) => (p.big ? (p.round ? 1 : 2) : p.x && 3));
export default memo(function Card(p: any) { return p.a || null; });
export const handler = withAuth(async (req: any) => { if (!req.user) return 401; return req.ok ? 200 : 500; });
app.get('/', (req: any, res: any) => { if (req.q) res.send(1); });
`,
      }),
    );
    expect(r.functions.map((f) => [f.name, f.complexity])).toEqual([
      ['Button', 4],
      ['default', 2],
      ['handler', 3],
      ['app.get callback', 2],
    ]);
  });

  it('reads <script src="/..."> relative to the HTML file\'s folder', async () => {
    const r = await analyzeProject(
      makeProject({
        'apps/web/index.html': '<script type="module" src="/src/main.tsx"></script>',
        'apps/web/src/main.tsx': 'export const main = 1;\n',
      }),
    );
    expect(r.entryPoints).toEqual([{ file: 'apps/web/src/main.tsx', reason: '<script> in apps/web/index.html' }]);
  });

  it('reports the declaration line of each unused export', async () => {
    const r = await analyzeProject(
      makeProject({
        'index.ts': "import { used } from './lib';\nexport default used;\n",
        'lib.ts': [
          'export const used = 1;',
          '',
          'export const UNUSED = 2;',
          'export type Unused = number;',
          'export enum Color { Red }',
          'function local() {}',
          'export { local as renamed };',
          '',
        ].join('\n'),
      }),
    );
    const lines = Object.fromEntries(unusedExports(r).unusedExports.filter((u) => u.file === 'lib.ts').map((u) => [u.name, u.line]));
    expect(lines).toEqual({ UNUSED: 3, Unused: 4, Color: 5, renamed: 6 });
  });

  it('counts lines the way an editor does', async () => {
    const r = await analyzeProject(makeProject({ 'a.ts': 'a;\nb;\n', 'b.ts': 'a;\nb;', 'c.ts': '' }));
    expect(Object.fromEntries(r.files.map((f) => [f.path, f.lines]))).toEqual({ 'a.ts': 2, 'b.ts': 2, 'c.ts': 0 });
  });
});

describe('git edge cases', () => {
  it('does not give a new file the history of a deleted file at the same path', async () => {
    const root = makeProject({});
    gitIn(root, ['init', '-q']);
    writeFile(root, 'util.ts', 'export const v = 1;\n');
    gitIn(root, ['add', '.']);
    gitIn(root, ['commit', '-q', '-m', 'add'], 'Alice');
    writeFile(root, 'util.ts', 'export const v = 2;\n');
    gitIn(root, ['commit', '-qam', 'edit'], 'Alice');
    gitIn(root, ['rm', '-q', 'util.ts']);
    gitIn(root, ['commit', '-q', '-m', 'delete'], 'Alice');
    writeFile(root, 'util.ts', 'export const fresh = true;\n');
    gitIn(root, ['add', '.']);
    gitIn(root, ['commit', '-q', '-m', 'new'], 'Bob');

    const h = await readGitHistory(root);
    if (!h.available) throw new Error(h.reason);
    const o = ownership(h.commits, ['util.ts'], 'all').ownership;
    expect(o.map((x) => [x.file, x.authors, x.totalCommits])).toEqual([['util.ts', ['Bob'], 1]]);
  });
});
