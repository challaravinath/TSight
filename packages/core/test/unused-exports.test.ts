import { describe, it, expect } from 'vitest';
import { analyzeProject, buildSnapshot } from '../src/index.js';
import { makeProject } from './helpers.js';

const unused = async (files: Record<string, string>) => {
  const r = await analyzeProject(makeProject(files));
  return {
    r,
    list: r.unusedExports.map((u) => `${u.file}:${u.name}${u.kind === 'type' ? ' (type)' : ''}${u.onlyTests ? ' (tests only)' : ''}`),
  };
};

// Every case needs a file that something loads, so it starts at an entry point.
const pkg = JSON.stringify({ name: 'app', main: 'src/main.ts' });

describe('unused exports', () => {
  it('follows a name through a barrel to the file that declares it', async () => {
    const { list } = await unused({
      'package.json': pkg,
      'src/main.ts': "import { used } from './lib';\nconsole.log(used);\n",
      'src/lib/index.ts': "export { used, unused } from './values';\n",
      'src/lib/values.ts': 'export const used = 1;\nexport const unused = 2;\n',
    });
    expect(list).toEqual(['src/lib/values.ts:unused']);
  });

  it('follows renames on both sides', async () => {
    const { list } = await unused({
      'package.json': pkg,
      'src/main.ts': "import { shown as local } from './barrel';\nconsole.log(local);\n",
      'src/barrel.ts': "export { real as shown, other as alsoShown } from './real';\n",
      'src/real.ts': 'export const real = 1;\nexport const other = 2;\n',
    });
    expect(list).toEqual(['src/real.ts:other']);
  });

  it('looks up names in export * files, but never passes a default export through it', async () => {
    const { list } = await unused({
      'package.json': pkg,
      'src/main.ts': "import { a } from './all';\nimport def from './all';\nconsole.log(a, def);\n",
      'src/all.ts': "export * from './a';\nexport default 1;\n",
      'src/a.ts': 'export const a = 1;\nexport const b = 2;\nexport default 3;\n',
    });
    expect(list).toEqual(['src/a.ts:b', 'src/a.ts:default']);
  });

  it('counts import * and export * as ns as using every export', async () => {
    const { list } = await unused({
      'package.json': pkg,
      'src/main.ts': "import * as one from './one';\nimport { ns } from './two';\nconsole.log(one, ns);\n",
      'src/one.ts': 'export const x = 1;\nexport const y = 2;\n',
      'src/two.ts': "export * as ns from './three';\nexport const unusedHere = 1;\n",
      'src/three.ts': 'export const z = 1;\n',
    });
    expect(list).toEqual(['src/two.ts:unusedHere']);
  });

  it('counts dynamic imports and require() as using every export', async () => {
    const { list } = await unused({
      'package.json': pkg,
      'src/main.ts': "const a = await import('./lazy');\nconst b = require('./old');\nconsole.log(a, b);\n",
      'src/lazy.ts': 'export const p = 1;\nexport const q = 2;\n',
      'src/old.ts': 'export const r = 1;\n',
    });
    expect(list).toEqual([]);
  });

  it("treats an entry point's exports as public, including what it re-exports", async () => {
    const { list } = await unused({
      'package.json': JSON.stringify({ name: 'lib', main: 'src/index.ts' }),
      'src/index.ts': "export { parse } from './parse';\nexport * from './format';\n",
      'src/parse.ts': 'export const parse = 1;\nexport const helper = 2;\n',
      'src/format.ts': 'export const format = 1;\n',
    });
    expect(list).toEqual(['src/parse.ts:helper']);
  });

  it('makes only the types public when a package exports a file as .d.ts alone', async () => {
    const { list } = await unused({
      'package.json': JSON.stringify({ name: 'lib', main: 'src/main.ts', exports: { './*': { types: './dist/types/*.d.ts' } } }),
      'src/main.ts': "import { run } from './api';\nrun();\n",
      'src/api.ts': "export function run() {}\nexport function helper() {}\nexport interface Options { a: number }\nexport * from './more';\n",
      'src/more.ts': 'export type Extra = string;\nexport const extraValue = 1;\n',
    });
    expect(list).toEqual(['src/api.ts:helper', 'src/more.ts:extraValue']);
  });

  it('marks types, and exports only tests use', async () => {
    const { list } = await unused({
      'package.json': pkg,
      'src/main.ts': "import { run } from './api';\nrun();\n",
      'src/api.ts': 'export function run() {}\nexport function forTests() {}\nexport interface Options { a: number }\ntype Local = string;\nexport type { Local };\n',
      'src/api.test.ts': "import { forTests } from './api';\nforTests();\n",
    });
    expect(list).toEqual(['src/api.ts:forTests (tests only)', 'src/api.ts:Options (type)', 'src/api.ts:Local (type)']);
  });

  it('counts a type-only import as a use', async () => {
    const { list } = await unused({
      'package.json': pkg,
      'src/main.ts': "import type { Shape } from './types';\nexport const s: Shape = { n: 1 };\n",
      'src/types.ts': 'export interface Shape { n: number }\n',
    });
    expect(list).toEqual([]);
  });

  it("counts import('./x').Name in a type as using that name only", async () => {
    const { list } = await unused({
      'package.json': pkg,
      'src/main.ts': "let c: import('./config').Config;\nlet all: typeof import('./other');\nconsole.log(c, all);\n",
      'src/config.ts': 'export interface Config { a: 1 }\nexport interface Unrelated { b: 1 }\n',
      'src/other.ts': 'export const x = 1;\n',
    });
    expect(list).toEqual(['src/config.ts:Unrelated (type)']);
  });

  it('reads JSDoc types in JavaScript files', async () => {
    const { list } = await unused({
      'package.json': JSON.stringify({ name: 'app', main: 'src/main.js' }),
      'src/main.js': "import { run } from './run.js';\n/** @type {import('./types.js').Options} */\nconst o = {};\nrun(o);\n",
      'src/run.js': 'export function run() {}\n',
      'src/types.ts': 'export interface Options { a: 1 }\nexport interface Unused { b: 1 }\n',
    });
    expect(list).toEqual(['src/types.ts:Unused (type)']);
  });

  it('counts what a hand-written .d.ts file uses, and leaves out .d.ts files in build folders', async () => {
    const { r, list } = await unused({
      'package.json': pkg,
      'src/main.ts': 'console.log(1);\n',
      'virtual.d.ts': "declare module 'virtual:config' {\n  const c: import('./src/config.js').Config;\n  export default c;\n}\n",
      'src/config.ts': 'export interface Config { a: 1 }\nexport interface Unrelated { b: 1 }\n',
      'dist/index.d.ts': "export * from '../src/built';\n",
      'src/built.ts': 'export const fromDist = 1;\n',
      'src/helper.ts': "export const used = 1;\nexport const other = 2;\n",
      'src/globals.d.ts': "import type { used } from './helper';\ndeclare global { const g: typeof used }\n",
    });
    expect(list).toEqual(['src/config.ts:Unrelated (type)', 'src/helper.ts:other']);
    const nothingImports = r.issues.filter((i) => i.type === 'dead-code').map((i) => i.file);
    expect(nothingImports).toEqual(['src/built.ts']);
  });

  it('stops on barrels that re-export each other in a loop', async () => {
    const { list } = await unused({
      'package.json': pkg,
      'src/main.ts': "import { a } from './x';\nconsole.log(a);\n",
      'src/x.ts': "export * from './y';\n",
      'src/y.ts': "export * from './x';\nexport const a = 1;\nexport const b = 2;\n",
    });
    expect(list).toEqual(['src/y.ts:b']);
  });

  it('leaves out files nothing imports, test files and component files', async () => {
    const { list } = await unused({
      'package.json': pkg,
      'src/main.ts': "import Card from './Card.svelte';\nconsole.log(Card);\n",
      'src/orphan.ts': 'export const nobody = 1;\n',
      'src/Card.svelte': '<script>\n  export let title = "";\n</script>\n',
      'src/util.test.ts': 'export const helper = 1;\n',
    });
    expect(list).toEqual([]);
  });

  it('puts unused exports in the snapshot with file indexes and lines', async () => {
    const { r } = await unused({
      'package.json': pkg,
      'src/main.ts': "import { a } from './a';\nconsole.log(a);\n",
      'src/a.ts': 'export const a = 1;\n\nexport const b = 2;\n',
    });
    const s = buildSnapshot(r, null);
    expect(s.unusedExports).toEqual([{ file: s.files.findIndex((f) => f.path === 'src/a.ts'), name: 'b', line: 3, kind: 'value', onlyTests: false }]);
    expect(s.exportStats.totalExports).toBe(2);
  });
});
