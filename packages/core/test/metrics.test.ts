import { describe, it, expect } from 'vitest';
import { analyzeProject, computeHotspots, unusedExports } from '../src/index.js';
import { makeProject } from './helpers.js';

const complexityOf = async (code: string) => {
  const r = await analyzeProject(makeProject({ 'a.ts': code }));
  return Object.fromEntries(r.functions.map((f) => [f.name, f.complexity]));
};

describe('cyclomatic complexity', () => {
  it('scores a function with no branches as 1, whatever its arithmetic', async () => {
    expect(await complexityOf('export function simple(a: number, b: number) {\n  const x = a + b;\n  let z = x * 2 - 1;\n  z = z / 3;\n  return x + z;\n}\n')).toEqual({ simple: 1 });
  });

  it('counts each decision point once', async () => {
    const c = await complexityOf(`
export function oneIf(a: boolean, b: boolean) { if (a && b) { return 1; } return 0; }
export function sw(x: number) { switch (x) { case 1: return 'a'; case 2: return 'b'; case 3: return 'c'; default: return 'z'; } }
export function rest(x?: { y?: number }, list: number[] = []) {
  for (const n of list) { while (n > 0) { break; } }
  try { return x?.y ?? (list.length > 0 ? 1 : 2); } catch { return -1; }
}
`);
    // rest: for-of, while, ??, ?: and catch = 1 + 5
    expect(c).toEqual({ oneIf: 3, sw: 4, rest: 6 });
  });

  it('scores named inner functions separately and folds inline callbacks into their parent', async () => {
    const c = await complexityOf(`
export function outer(xs: number[]) {
  const inner = (n: number) => (n > 1 ? n : 0);
  return xs.filter((x) => x > 0 && x < 9);
}
`);
    // outer: 1 + the && inside its inline filter callback. inner: 1 + ?:
    expect(c).toEqual({ outer: 2, inner: 2 });
  });

  it('measures class methods, constructors and accessors', async () => {
    const r = await analyzeProject(
      makeProject({
        'svc.ts': `
export class Svc {
  private n = 0;
  constructor(seed?: number) { if (seed) this.n = seed; }
  get value() { return this.n > 0 ? this.n : 0; }
  run(x: number) { if (x > 1) { return 1; } return 2; }
  handler = (e: string) => { if (!e) return; this.n++; };
}
`,
      }),
    );
    const byName = Object.fromEntries(r.functions.map((f) => [f.name, [f.kind, f.complexity]]));
    expect(byName).toEqual({
      'Svc.constructor': ['constructor', 2],
      'Svc.value': ['getter', 2],
      'Svc.run': ['method', 2],
      'Svc.handler': ['method', 2],
    });
  });
});

describe('cycles', () => {
  it('reports every strongly connected group, with a shortest example', async () => {
    const r = await analyzeProject(
      makeProject({
        'a.ts': "import './b';\nimport './c';\nexport const a = 1;\n",
        'b.ts': "import './c';\nimport './a';\nexport const b = 1;\n",
        'c.ts': "import './a';\nimport './b';\nexport const c = 1;\n",
        'x.ts': "import './y';\nexport const x = 1;\n",
        'y.ts': "import './x';\nexport const y = 1;\n",
        'self.ts': "import './self';\nexport const s = 1;\n",
        'free.ts': "import './a';\nexport const f = 1;\n",
      }),
    );
    expect(r.dependencyGraph.cycleGroups.map((g) => g.files)).toEqual([['a.ts', 'b.ts', 'c.ts'], ['x.ts', 'y.ts'], ['self.ts']]);
    expect(r.dependencyGraph.cycleGroups[0].example).toEqual(['a.ts', 'b.ts']);
  });

  it('ignores type-only and lazy imports, which cannot cause load-order cycles', async () => {
    const r = await analyzeProject(
      makeProject({
        'a.ts': "import type { B } from './b';\nexport const a = (b: B) => b;\nexport type A = number;\n",
        'b.ts': "import { a } from './a';\nexport type B = number;\nexport const b = a;\n",
        'c.ts': "export const load = () => import('./d');\n",
        'd.ts': "import { load } from './c';\nexport const d = load;\n",
      }),
    );
    expect(r.dependencyGraph.cycleGroups).toEqual([]);
  });
});

describe('duplicates', () => {
  const longFile = (n: number, mode: string) =>
    `export const name = 'service-config-module';\nexport const endpoint = "https://api.example.com/v1"; export const retries = ${n}; export const mode = '${mode}';\nexport function build() { return { name, endpoint, retries, mode }; }\n`;

  it('does not group files that differ only after a URL', async () => {
    const r = await analyzeProject(makeProject({ 'a.ts': longFile(3, 'prod'), 'b.ts': longFile(99, 'DEV') }));
    expect(r.duplicates).toEqual([]);
  });

  it('says whether a duplicate is byte-for-byte or only the same code', async () => {
    const r = await analyzeProject(
      makeProject({
        'a.ts': longFile(3, 'prod'),
        'b.ts': longFile(3, 'prod'),
        'c.ts': '// a comment\n' + longFile(3, 'prod').replace(/; /g, ';\n  '),
      }),
    );
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0].match).toBe('tokens');
    expect(r.duplicates[0].items.map((i) => i.file)).toEqual(['a.ts', 'b.ts', 'c.ts']);

    const same = await analyzeProject(makeProject({ 'a.ts': longFile(1, 'x'), 'b.ts': longFile(1, 'x') }));
    expect(same.duplicates[0].match).toBe('bytes');
  });
});

describe('hotspots', () => {
  it('includes files that contain classes', async () => {
    const heavy = (name: string) =>
      `export function ${name}(a: number) {\n` +
      Array.from({ length: 8 }, (_, i) => `  if (a > ${i}) { a++; }`).join('\n') +
      '\n  return a;\n}\n';
    const r = await analyzeProject(
      makeProject({
        'svc.ts': heavy('heavy') + 'export class Svc { run() { return heavy(1); } }\n',
        'plain.ts': heavy('heavy2'),
        ...Object.fromEntries(
          [1, 2, 3].map((i) => [`u${i}.ts`, "import { Svc } from './svc';\nimport { heavy2 } from './plain';\nexport const u = [Svc, heavy2];\n"]),
        ),
      }),
    );
    const h = computeHotspots(r);
    // svc.ts: heavy (9) + Svc.run (1) = 10, the listing threshold. plain.ts: 9, below it.
    expect(h.map((x) => [x.file, x.complexity, x.dependents, x.riskScore])).toEqual([['svc.ts', 10, 3, 30]]);
    expect(h.every((x) => Number.isFinite(x.riskScore))).toBe(true);
  });
});

describe('entry points and files without importers', () => {
  it('uses package.json and framework rules, and says "no importers found" for the rest', async () => {
    const r = await analyzeProject(
      makeProject({
        'package.json': JSON.stringify({ name: 'web', main: 'dist/index.js', dependencies: { next: '14.0.0' } }),
        'src/index.ts': "export * from './lib';\n",
        'src/lib.ts': 'export const lib = 1;\n',
        'app/layout.tsx': 'export default function Layout() { return null; }\n',
        'middleware.ts': 'export function middleware() {}\n',
        'vite.config.ts': 'export default {};\n',
        'src/orphan.ts': 'export const orphan = 1;\n',
        'src/fixtures.ts': 'export const fixture = 1;\n',
        'src/fixtures.test.ts': "import { fixture } from './fixtures';\nexport const t = fixture;\n",
      }),
    );
    const reasons = Object.fromEntries(r.entryPoints.map((e) => [e.file, e.reason]));
    expect(reasons['src/index.ts']).toBe('package index file');
    expect(reasons['app/layout.tsx']).toBe('Next.js app router file');
    expect(reasons['middleware.ts']).toBe('Next.js special file');
    expect(reasons['vite.config.ts']).toBe('tool config file');

    const flagged = r.issues.filter((i) => i.type === 'dead-code').map((i) => [i.file, i.message]);
    expect(flagged).toEqual([
      ['src/fixtures.ts', 'Only imported by tests (1 test file)'],
      ['src/orphan.ts', 'No importers found'],
    ]);
  });

  it('reports unused exports by name, skipping files reached through export *', async () => {
    const r = await analyzeProject(
      makeProject({
        'index.ts': "import { used } from './a';\nimport def from './b';\nexport const x = [used, def];\n",
        'a.ts': 'export const used = 1;\nexport const notUsed = 2;\n',
        'b.ts': 'export default function b() {}\nexport function alsoNotUsed() {}\n',
        'barrel.ts': "export * from './c';\n",
        'c.ts': 'export const reachedByStar = 1;\n',
      }),
    );
    const u = unusedExports(r).unusedExports.map((e) => `${e.file}:${e.name}`).sort();
    expect(u).toEqual(['a.ts:notUsed', 'b.ts:alsoNotUsed', 'index.ts:x']);
  });
});

describe('structural twins', () => {
  const loader = (fn: string, list: string, key: string, url: string) => `
export async function ${fn}(id: string, retries = 3) {
  const ${list}: string[] = [];
  for (let i = 0; i < retries; i++) {
    const res = await fetch('${url}' + id);
    if (!res.ok) { ${list}.push('${key}:' + res.status); continue; }
    const body = await res.json();
    return { id, body, errors: ${list} };
  }
  throw new Error(${list}.join(', '));
}
`;

  it('pairs functions whose syntax is identical apart from names, and says what differs', async () => {
    const r = await analyzeProject(
      makeProject({
        'users.ts': loader('loadUser', 'errors', 'user', '/api/users/'),
        'orders.ts': loader('loadOrder', 'failures', 'order', '/api/orders/'),
        'copy.ts': loader('loadUserAgain', 'errors', 'user', '/api/users/'),
      }),
    );
    expect(r.structuralTwins).toHaveLength(2);
    const byB = Object.fromEntries(r.structuralTwins.map((t) => [t.functionB.name, [t.verdict, t.criteria.filter((c) => !c.matched).map((c) => c.name)]]));
    // Sorted by file: copy.ts is the reference, then orders.ts and users.ts.
    expect(byB).toEqual({
      loadUser: ['structural-twin', []],
      loadOrder: ['worth-reviewing', ['Literal values', 'Names']],
    });
  });

  it('does not pair functions that merely share coarse features', async () => {
    const r = await analyzeProject(
      makeProject({
        'a.ts': loader('loadUser', 'errors', 'user', '/u/'),
        'b.ts': `export async function save(id: string, retries = 3) {
  const out: string[] = [];
  while (out.length < retries) { out.push(id); if (out.length > 1) { break; } }
  try { await fetch('/s/' + id, { method: 'POST' }); } catch (e) { out.push(String(e)); }
  return { id, out };
}
`,
      }),
    );
    expect(r.structuralTwins).toEqual([]);
  });
});
