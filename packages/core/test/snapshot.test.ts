import { describe, it, expect } from 'vitest';
import { analyzeProject, readGitHistory, buildSnapshot, SNAPSHOT_SCHEMA } from '../src/index.js';
import { makeProject, gitIn } from './helpers.js';

describe('snapshot', () => {
  it('holds everything the UI needs, with files referenced by index', async () => {
    const root = makeProject({
      'src/a.ts': "import { b } from './b';\nexport function a(x: number) { return x > 1 ? b : 0; }\n",
      'src/b.ts': 'export const b = 1;\n',
      'src/a.test.ts': "import { a } from './a';\na(1);\n",
    });
    gitIn(root, ['init', '-q']);
    gitIn(root, ['add', '.']);
    gitIn(root, ['commit', '-q', '-m', 'start'], 'Alice');
    const r = await analyzeProject(root);
    const s = buildSnapshot(r, await readGitHistory(root), { name: 'demo', version: '3.0.0' });

    expect(s.schema).toBe(SNAPSHOT_SCHEMA);
    expect(s.project.name).toBe('demo');
    const name = (i: number) => s.files[i].path;
    expect(s.imports.map((i) => `${name(i.from)} -> ${name(i.to)} @${i.line}`).sort()).toEqual([
      'src/a.test.ts -> src/a.ts @1',
      'src/a.ts -> src/b.ts @1',
    ]);
    const a = s.files.find((f) => f.path === 'src/a.ts')!;
    expect(a).toMatchObject({ role: 'source', complexity: 2, maxComplexity: 2, topFunction: 'a', exports: ['a'] });
    expect(s.git?.files.find((f) => name(f.file) === 'src/a.ts')).toMatchObject({ commits: 1, authors: [{ name: 'Alice', commits: 1 }] });
    expect(s.git?.windows.all.singleAuthor.map((x) => name(x.file)).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('works without git history', async () => {
    const r = await analyzeProject(makeProject({ 'a.ts': 'export const a = 1;\n' }));
    expect(buildSnapshot(r, null).git).toBeNull();
  });
});
