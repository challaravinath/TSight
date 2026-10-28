import { describe, it, expect, beforeAll } from 'vitest';
import { analyzeProject, readGitHistory, changeHotspots, coChanges, analyzeDiff, diffToMarkdown, parseNumstat } from '../src/index.js';
import { makeProject, gitIn, writeFile } from './helpers.js';

const branchy = (n: number) =>
  `export function pay(a: number) {\n` + Array.from({ length: n }, (_, i) => `  if (a > ${i}) { a++; }`).join('\n') + '\n  return a;\n}\n';

let repo: string;

beforeAll(() => {
  repo = makeProject({});
  gitIn(repo, ['init', '-q', '-b', 'main']);
  writeFile(repo, 'src/payment.ts', branchy(4));
  writeFile(repo, 'src/orders.ts', 'export const orders = 1;\n');
  writeFile(repo, 'src/cart.ts', "import { pay } from './payment';\nexport const cart = pay;\n");
  writeFile(repo, 'src/ui.ts', "import { cart } from './cart';\nexport const ui = cart;\n");
  writeFile(repo, 'index.html', '<script type="module" src="/src/ui.ts"></script>');
  gitIn(repo, ['add', '.']);
  gitIn(repo, ['commit', '-q', '-m', 'start'], 'Alice');
  // payment.ts and orders.ts change together six times, with no import between them.
  for (let i = 0; i < 6; i++) {
    writeFile(repo, 'src/payment.ts', branchy(4) + `// ${i}\n`);
    writeFile(repo, 'src/orders.ts', `export const orders = ${i};\n`);
    gitIn(repo, ['commit', '-qam', `change ${i}`], i % 2 ? 'Alice' : 'Bob');
  }
  // The change under review, on a branch.
  gitIn(repo, ['checkout', '-q', '-b', 'feature']);
  writeFile(repo, 'src/payment.ts', "import { retry } from './retry';\n" + branchy(7) + 'export const again = retry;\n');
  writeFile(repo, 'src/retry.ts', "import { pay } from './payment';\nexport const retry = (n: number) => (n > 0 ? pay(n) : 0);\n");
  gitIn(repo, ['add', '.']);
  gitIn(repo, ['commit', '-q', '-m', 'retries'], 'Dana');
});

describe('change hotspots and co-change', () => {
  it('scores files by recent commits times their most complex function', async () => {
    const r = await analyzeProject(repo);
    const h = await readGitHistory(repo);
    if (!h.available) throw new Error(h.reason);
    const hot = changeHotspots(r, h.commits, 90);
    expect(hot[0]).toMatchObject({ file: 'src/payment.ts', commits: 8, maxComplexity: 8, topFunction: 'pay', score: 64 });
  });

  it('finds files that change together without importing each other', async () => {
    const r = await analyzeProject(repo);
    const h = await readGitHistory(repo);
    if (!h.available) throw new Error(h.reason);
    const pairs = coChanges(r, h.commits);
    expect(pairs).toEqual([
      { a: 'src/orders.ts', b: 'src/payment.ts', together: 7, commitsA: 7, commitsB: 8, confidence: 1, hidden: true },
    ]);
  });
});

describe('diff', () => {
  it('reports what a change touches, compared with the merge base', async () => {
    const report = await analyzeDiff(repo, { base: 'main' });
    expect(report.files.map((f) => [f.path, f.status, f.complexityBefore, f.complexityAfter])).toEqual([
      ['src/payment.ts', 'modified', 5, 8],
      ['src/retry.ts', 'added', null, 2],
    ]);
    expect(report.complexity.net).toBe(5);
    expect(report.newCycles.map((c) => c.files)).toEqual([['src/payment.ts', 'src/retry.ts']]);
    expect(report.blastRadius).toEqual({ files: 2, percent: 40, entryPoints: ['src/ui.ts'], reached: ['src/cart.ts', 'src/ui.ts'] });
    // The function list adds up to the net change, so the number and its list agree.
    expect(report.complexity.functions.reduce((s, f) => s + (f.after ?? 0) - (f.before ?? 0), 0)).toBe(report.complexity.net);
    // History before the change only: the commit under review is not counted.
    expect(report.partners).toEqual([{ file: 'src/orders.ts', partnerOf: 'src/payment.ts', together: 7, commitsOfChanged: 7, hidden: true }]);
    // Bob's edits were all overwritten before the merge base, so git blame credits Alice alone.
    expect(report.owners).toEqual([{ author: 'Alice', lines: 8, percent: 100 }]);
    const md = diffToMarkdown(report);
    expect(md).toContain('New or larger dependency cycles | 1');
    expect(md).toContain('`src/orders.ts` changed in 7 of the 7 commits that touched `src/payment.ts` (no import between them)');
  });

  it('leaves the working copy and the worktree list as they were', async () => {
    const before = gitIn(repo, ['worktree', 'list']);
    await analyzeDiff(repo, { base: 'main' });
    expect(gitIn(repo, ['worktree', 'list'])).toBe(before);
    expect(gitIn(repo, ['status', '--porcelain'])).toBe('');
  });

  it('parses numstat output including renames', () => {
    const m = parseNumstat('3\t1\tsrc/a.ts\u00002\t0\t\u0000src/old.ts\u0000src/new.ts\u0000-\t-\tlogo.png\u0000');
    expect(Object.fromEntries(m)).toEqual({ 'src/a.ts': { added: 3, removed: 1 }, 'src/new.ts': { added: 2, removed: 0 }, 'logo.png': { added: 0, removed: 0 } });
  });
});
