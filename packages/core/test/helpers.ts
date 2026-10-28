import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

/** Write a small project to a new temp folder. Keys are relative paths. */
export function makeProject(files: Record<string, string>, parentName = 'tsight-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), parentName));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

export function gitIn(dir: string, args: string[], author?: string): string {
  const env = { ...process.env };
  if (author) {
    env.GIT_AUTHOR_NAME = author;
    env.GIT_AUTHOR_EMAIL = `${author.replace(/\W/g, '')}@example.com`;
    env.GIT_COMMITTER_NAME = author;
    env.GIT_COMMITTER_EMAIL = env.GIT_AUTHOR_EMAIL;
  }
  return execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' });
}

export function writeFile(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
