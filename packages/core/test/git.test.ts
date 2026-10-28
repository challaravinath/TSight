import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
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
