import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { readGitHistory, ownership, busFactor, churn, analyzeProject, type GitCommit } from '../src/index.js';
import { makeProject, gitIn, writeFile } from './helpers.js';

let repo: string;

beforeAll(() => {
  repo = makeProject({});
  gitIn(repo, ['init', '-q', '-b', 'main']);
  writeFile(repo, 'src/svc.ts', 'export const svc = 1;\n');
  writeFile(repo, 'src/plain.ts', 'export const plain = 1;\n');
  gitIn(repo, ['add', '.']);
  gitIn(repo, ['commit', '-q', '-m', 'one'], 'Alice');

  writeFile(repo, 'src/old-name.ts', 'export const u1 = 1;\n');
  gitIn(repo, ['add', '.']);
  gitIn(repo, ['commit', '-q', '-m', 'two'], 'j.doe');

  writeFile(repo, 'Dockerfile', 'FROM node\n');
  writeFile(repo, 'src/u2.ts', 'export const u2 = 1;\n');
  gitIn(repo, ['add', '.']);
  gitIn(repo, ['commit', '-q', '-m', 'three'], 'Bob');

  gitIn(repo, ['mv', 'src/old-name.ts', 'src/new-name.ts']);
  gitIn(repo, ['commit', '-q', '-m', 'rename'], 'Bob');

  writeFile(repo, 'src/gone.ts', 'export const gone = 1;\n');
  gitIn(repo, ['add', '.']);
  gitIn(repo, ['commit', '-q', '-m', 'add gone'], 'Carol');
  gitIn(repo, ['rm', '-q', 'src/gone.ts']);
  gitIn(repo, ['commit', '-q', '-m', 'remove gone'], 'Carol');
});

const commitsOf = async (root: string): Promise<GitCommit[]> => {
  const h = await readGitHistory(root);
  if (!h.available) throw new Error(h.reason);
  return h.commits;
};

describe('git history', () => {
  it('credits each file to the right author, including names with dots', async () => {
    const r = await analyzeProject(repo);
    const files = r.files.map((f) => f.path);
    const own = ownership(await commitsOf(repo), files, 'all');
    const owners = Object.fromEntries(own.ownership.map((o) => [o.file, o.authors]));
    expect(owners).toEqual({
      'src/svc.ts': ['Alice'],
      'src/plain.ts': ['Alice'],
      'src/new-name.ts': ['Bob', 'j.doe'],
      'src/u2.ts': ['Bob'],
    });
  });

  it('never lists a file name as a person, and ignores deleted files', async () => {
    const r = await analyzeProject(repo);
    const bf = busFactor(await commitsOf(repo), r.files.map((f) => f.path), 'all');
    expect(bf.busFactor.map((b) => b.author).sort()).toEqual(['Alice', 'Bob']);
    expect(bf.filesWithActivity).toBe(4);
    expect(bf.totalSingleAuthorFiles).toBe(3);
  });

  it('lines up with the analysis when a subfolder is analyzed', async () => {
    const sub = path.join(repo, 'src');
    const r = await analyzeProject(sub);
    const files = r.files.map((f) => f.path);
    expect(files.sort()).toEqual(['new-name.ts', 'plain.ts', 'svc.ts', 'u2.ts']);
    const recent = ownership(await commitsOf(sub), files, '3months');
    expect(recent.knowledgeGaps).toEqual([]);
    expect(recent.stats.filesWithActivity).toBe(4);
    const c = churn(await commitsOf(sub), files, 90);
    expect(c.churn.find((x) => x.file === 'new-name.ts')?.changes).toBe(2);
  });

  it('says when a folder is not a git repository', async () => {
    const h = await readGitHistory(makeProject({ 'a.ts': '' }));
    expect(h.available).toBe(false);
  });
});

describe('automation accounts', () => {
  it('leaves [bot] commits out of ownership, bus factor and co-change', async () => {
    const { coChanges } = await import('../src/index.js');
    const root = makeProject({});
    gitIn(root, ['init', '-q']);
    writeFile(root, 'a.ts', 'export const a = 0;\n');
    writeFile(root, 'b.ts', 'export const b = 0;\n');
    gitIn(root, ['add', '.']);
    gitIn(root, ['commit', '-q', '-m', 'start'], 'Alice');
    for (let i = 1; i <= 6; i++) {
      writeFile(root, 'a.ts', `export const a = ${i};\n`);
      writeFile(root, 'b.ts', `export const b = ${i};\n`);
      gitIn(root, ['commit', '-qam', `bump ${i}`], 'release-bot[bot]');
    }
    const r = await analyzeProject(root);
    const h = await readGitHistory(root);
    if (!h.available) throw new Error(h.reason);
    expect(h.commits.filter((c) => c.bot)).toHaveLength(6);
    expect(ownership(h.commits, ['a.ts', 'b.ts'], 'all').ownership.map((o) => [o.file, o.authors])).toEqual([
      ['a.ts', ['Alice']],
      ['b.ts', ['Alice']],
    ]);
    expect(busFactor(h.commits, ['a.ts', 'b.ts'], 'all').busFactor).toEqual([{ author: 'Alice', soloFiles: 2, files: ['a.ts', 'b.ts'] }]);
    expect(coChanges(r, h.commits, { minTogether: 2 })).toEqual([]);
  });
});

describe('shallow clones', () => {
  it('leaves out the cut-off commit, which git shows as adding every file', async () => {
    const src = makeProject({ 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 1;\n' });
    gitIn(src, ['init', '-q', '-b', 'main']);
    gitIn(src, ['add', '.']);
    gitIn(src, ['commit', '-q', '-m', 'start'], 'Alice');
    writeFile(src, 'src/a.ts', 'export const a = 2;\n');
    gitIn(src, ['commit', '-qam', 'two'], 'Bob');
    writeFile(src, 'src/a.ts', 'export const a = 3;\n');
    gitIn(src, ['commit', '-qam', 'three'], 'Carol');
    const clone = makeProject({});
    gitIn(clone, ['clone', '-q', '--depth', '2', pathToFileURL(src).href, 'c']);
    const history = await readGitHistory(path.join(clone, 'c'));
    expect(history.available && history.shallow).toBe(true);
    if (!history.available) return;
    // Bob's commit is the cut-off: in the clone it seems to add both files. Only Carol's commit is real.
    expect(history.commits.map((c) => [c.author, c.files])).toEqual([['Carol', ['src/a.ts']]]);
  });
});
