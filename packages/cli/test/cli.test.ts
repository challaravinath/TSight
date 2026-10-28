import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

// These run the built command, so `npm run build` has to come first (CI does that).
const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist/cli.js');
const built = fs.existsSync(cli) && fs.existsSync(path.join(path.dirname(cli), 'web/index.html'));

function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsight-cli-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'Alice', GIT_AUTHOR_EMAIL: 'a@example.com', GIT_COMMITTER_NAME: 'Alice', GIT_COMMITTER_EMAIL: 'a@example.com' },
  });
const run = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });

describe.skipIf(!built)('tsight command', () => {
  it('analyze prints a snapshot', () => {
    const dir = project({ 'src/a.ts': "import { b } from './b';\nexport const a = b;\n", 'src/b.ts': 'export const b = 1;\n' });
    const r = run(dir, 'analyze', '.');
    expect(r.status).toBe(0);
    const snap = JSON.parse(r.stdout);
    expect(snap.schema).toBe(1);
    expect(snap.imports).toHaveLength(1);
  });

  it('report writes one self-contained file and escapes the embedded data', () => {
    const dir = project({
      'src/a.ts': "import x from './missing</script><script>alert(1)</script>';\nexport const a = x;\n",
    });
    const out = path.join(dir, 'report.html');
    const r = run(dir, 'report', '.', '--out', out);
    expect(r.status).toBe(0);
    const html = fs.readFileSync(out, 'utf8');
    expect(html).toContain('window.__TSIGHT_SNAPSHOT__=');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toMatch(/<script[^>]+src=/); // scripts are inlined
    expect(html).not.toMatch(/<link[^>]+stylesheet/); // styles are inlined
    expect(html).not.toMatch(/(src|href)=["']https?:/); // nothing loads from the network
  });

  it('report keeps $ sequences in the data as they are', () => {
    const dir = project({ 'src/a.ts': "export function $$store() {}\nexport const $after = \"$'\";\n" });
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'add', '.');
    execFileSync('git', ['commit', '-q', '-m', 'start'], {
      cwd: dir,
      env: { ...process.env, GIT_AUTHOR_NAME: "Bob $`x", GIT_AUTHOR_EMAIL: 'b@example.com', GIT_COMMITTER_NAME: 'Bob', GIT_COMMITTER_EMAIL: 'b@example.com' },
    });
    const out = path.join(dir, 'report.html');
    expect(run(dir, 'report', '.', '--out', out).status).toBe(0);
    const html = fs.readFileSync(out, 'utf8');
    const data = html.slice(html.indexOf('window.__TSIGHT_SNAPSHOT__='), html.indexOf('</script>', html.indexOf('window.__TSIGHT_SNAPSHOT__=')));
    const snap = JSON.parse(data.slice('window.__TSIGHT_SNAPSHOT__='.length, data.indexOf(';window.__TSIGHT_DIFF__')));
    expect(snap.files[0].exports).toEqual(['$$store', '$after']);
    expect(Object.keys(snap.git.authorLastActive)).toEqual(['Bob $`x']);
    expect(data).toContain(';window.__TSIGHT_DIFF__=null;');
  });

  it('diff exits with 1 when --fail-on new-cycle matches', () => {
    const dir = project({ 'src/a.ts': "import { b } from './b';\nexport const a = () => b;\n", 'src/b.ts': 'export const b = 1;\n' });
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'start');
    fs.writeFileSync(path.join(dir, 'src/b.ts'), "import { a } from './a';\nexport const b = 1;\nexport const c = a;\n");
    const r = run(dir, 'diff', 'main', '--fail-on', 'new-cycle');
    expect(r.stdout).toContain('New or larger dependency cycles | 1');
    expect(r.status).toBe(1);
    const ok = run(dir, 'diff', 'main');
    expect(ok.status).toBe(0);
  });

  it('rejects unknown options with a clear message', () => {
    const r = run(os.tmpdir(), 'diff', 'main', '--fail-on', 'everything');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Unknown --fail-on value');
  });
});
