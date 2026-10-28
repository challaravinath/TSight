/**
 * Git history for the analyzed folder, read in one `git log` pass.
 *
 * - Paths are relative to the analyzed folder (git's --relative), so
 *   analyzing a subfolder of a repository lines up with the analysis.
 * - Author names go through .mailmap (%aN), so one person with two
 *   spellings counts once when the repo maps them.
 * - Renames are followed: history recorded under an old name is credited
 *   to the file's current name. Not available in partial clones, where
 *   git would have to download old file contents to detect renames.
 * - Merge commits are skipped; their changes are counted in the commits
 *   that were merged.
 * - When a file is deleted and a new one is later created at the same
 *   path, the new file does not inherit the old one's history.
 * - Commits by automation accounts (names ending in [bot], such as
 *   dependabot[bot]) are kept in the history but left out of churn,
 *   ownership, bus factor and co-change: they say nothing about people.
 * - Only files that exist in the analysis are reported.
 */
import { execFile } from 'child_process';

export interface GitCommit {
  hash: string;
  author: string;
  /** Author is an automation account (GitHub marks them with a [bot] suffix). */
  bot: boolean;
  date: string; // ISO 8601, author date
  files: string[]; // current paths, relative to the analyzed folder
}

export type GitHistory =
  | {
      available: true;
      head: string;
      shallow: boolean;
      renamesFollowed: boolean;
      commits: GitCommit[]; // newest first
    }
  | { available: false; reason: string };

function git(cwd: string, args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

export async function readGitHistory(root: string): Promise<GitHistory> {
  try {
    const inside = (await git(root, ['rev-parse', '--is-inside-work-tree'])).trim();
    if (inside !== 'true') return { available: false, reason: 'Not a git repository' };
  } catch {
    return { available: false, reason: 'Not a git repository, or git is not installed' };
  }

  let head = '';
  try {
    head = (await git(root, ['rev-parse', 'HEAD'])).trim();
  } catch {
    return { available: false, reason: 'The repository has no commits yet' };
  }

  const shallow = (await git(root, ['rev-parse', '--is-shallow-repository']).catch(() => 'false')).trim() === 'true';
  const promisor = (await git(root, ['config', '--get', 'remote.origin.promisor']).catch(() => '')).trim() === 'true';
  const renamesFollowed = !promisor;

  const raw = await git(root, [
    '-c', 'core.quotepath=off',
    'log',
    '--no-merges',
    '--topo-order',
    renamesFollowed ? '-M' : '--no-renames',
    '--name-status',
    '-z',
    '--relative',
    '--format=%x1e%H%x1f%aN%x1f%aI',
    '--',
    '.',
  ]);

  return { available: true, head, shallow, renamesFollowed, commits: parseLog(raw) };
}

/** Parse the output of the log command above. Exported for tests. */
export function parseLog(raw: string): GitCommit[] {
  const commits: GitCommit[] = [];
  // Path at that point in history -> the file's current path, or null when
  // the file that had this path was later deleted (so its history must not
  // be credited to a new file created at the same path).
  const currentName = new Map<string, string | null>();
  const resolveName = (p: string): string | null => (currentName.has(p) ? currentName.get(p)! : p);

  for (const record of raw.split('\x1e')) {
    if (!record) continue;
    const headerEnd = record.indexOf('\0');
    const header = headerEnd === -1 ? record : record.slice(0, headerEnd);
    const [hash, author, date] = header.split('\x1f');
    if (!hash) continue;

    const body = headerEnd === -1 ? '' : record.slice(headerEnd + 1);
    const fields = body.split('\0').map((f) => f.replace(/^\n+/, '')).filter((f) => f.length > 0);
    const files = new Set<string>();

    for (let i = 0; i < fields.length; i++) {
      const status = fields[i];
      const code = status[0];
      if (code === 'R' || code === 'C') {
        const oldPath = fields[++i];
        const newPath = fields[++i];
        if (newPath === undefined) break;
        const current = resolveName(newPath);
        if (current !== null) files.add(current);
        if (code === 'R' && oldPath !== undefined) currentName.set(oldPath, current);
      } else {
        const p = fields[++i];
        if (p === undefined) break;
        if (code === 'D') {
          // Older commits on this path belong to the deleted file.
          currentName.set(p, null);
          continue;
        }
        const current = resolveName(p);
        if (current !== null) files.add(current);
      }
    }

    const name = author ?? '';
    commits.push({ hash, author: name, bot: /\[bot\]$/i.test(name), date: date ?? '', files: Array.from(files) });
  }
  return commits;
}

// ============================================================================
// VIEWS OVER HISTORY
// ============================================================================

export type TimeWindow = 'all' | '6months' | '3months';

export function windowStart(window: TimeWindow, now = new Date()): Date | null {
  if (window === 'all') return null;
  const d = new Date(now);
  d.setMonth(d.getMonth() - (window === '6months' ? 6 : 3));
  return d;
}

/** Human commits since a date (all human commits when since is null). */
function commitsSince(commits: GitCommit[], since: Date | null): GitCommit[] {
  const t = since ? since.getTime() : -Infinity;
  return commits.filter((c) => !c.bot && Date.parse(c.date) >= t);
}

/** Per current file: commits that touched it, by author. */
function authorCounts(commits: GitCommit[], current: Set<string>): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const c of commits) {
    for (const f of c.files) {
      if (!current.has(f)) continue;
      if (!out.has(f)) out.set(f, new Map());
      const m = out.get(f)!;
      m.set(c.author, (m.get(c.author) ?? 0) + 1);
    }
  }
  return out;
}

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** Commits per file in the last `days` days. */
export function churn(commits: GitCommit[], currentFiles: string[], days: number, now = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const current = new Set(currentFiles);
  const map = new Map<string, { changes: number; authors: Set<string>; lastChanged: string }>();
  for (const c of commitsSince(commits, since)) {
    for (const f of c.files) {
      if (!current.has(f)) continue;
      const e = map.get(f) ?? { changes: 0, authors: new Set<string>(), lastChanged: '' };
      e.changes++;
      e.authors.add(c.author);
      const day = c.date.slice(0, 10);
      if (day > e.lastChanged) e.lastChanged = day;
      map.set(f, e);
    }
  }
  const rows = Array.from(map, ([file, d]) => ({
    file,
    name: base(file),
    changes: d.changes,
    authors: d.authors.size,
    authorNames: Array.from(d.authors).sort(),
    lastChanged: d.lastChanged,
  })).sort((a, b) => b.changes - a.changes || a.file.localeCompare(b.file));
  return { days, churn: rows, totalChanges: rows.reduce((s, r) => s + r.changes, 0) };
}

/** Commit counts per author per file in the window; files with no commits in it are knowledge gaps. */
export function ownership(commits: GitCommit[], currentFiles: string[], window: TimeWindow, now = new Date()) {
  const current = new Set(currentFiles);
  const counts = authorCounts(commitsSince(commits, windowStart(window, now)), current);

  const rows = Array.from(counts, ([file, authors]) => {
    const sorted = Array.from(authors).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const total = sorted.reduce((s, [, n]) => s + n, 0);
    return {
      file,
      name: base(file),
      primaryOwner: sorted[0][0],
      ownerCommits: sorted[0][1],
      totalCommits: total,
      ownershipPercent: Math.round((sorted[0][1] / total) * 100),
      authorCount: sorted.length,
      authors: sorted.map(([a]) => a),
    };
  }).sort((a, b) => b.totalCommits - a.totalCommits || a.file.localeCompare(b.file));

  const knowledgeGaps =
    window === 'all'
      ? []
      : currentFiles.filter((f) => !counts.has(f)).sort().map((f) => ({ file: f, name: base(f) }));

  return {
    ownership: rows,
    knowledgeGaps,
    timeFilter: window,
    stats: { filesWithActivity: counts.size, filesWithoutActivity: knowledgeGaps.length, totalFiles: currentFiles.length },
  };
}

/** Files whose commits in the window all come from one author, grouped by author. */
export function busFactor(commits: GitCommit[], currentFiles: string[], window: TimeWindow, now = new Date()) {
  const counts = authorCounts(commitsSince(commits, windowStart(window, now)), new Set(currentFiles));
  const byAuthor = new Map<string, string[]>();
  let single = 0;
  for (const [file, authors] of counts) {
    if (authors.size !== 1) continue;
    single++;
    const author = authors.keys().next().value as string;
    if (!byAuthor.has(author)) byAuthor.set(author, []);
    byAuthor.get(author)!.push(file);
  }
  const rows = Array.from(byAuthor, ([author, files]) => ({ author, soloFiles: files.length, files: files.sort() })).sort(
    (a, b) => b.soloFiles - a.soloFiles || a.author.localeCompare(b.author),
  );
  return {
    totalSingleAuthorFiles: single,
    totalFiles: currentFiles.length,
    filesWithActivity: counts.size,
    riskPercent: counts.size > 0 ? Math.round((single / counts.size) * 100) : 0,
    busFactor: rows,
    timeFilter: window,
  };
}

/** Files whose most recent commit is older than `months` months. */
export function staleFiles(commits: GitCommit[], currentFiles: string[], months: number, now = new Date()) {
  const current = new Set(currentFiles);
  const last = new Map<string, string>();
  for (const c of commits) {
    if (c.bot) continue;
    for (const f of c.files) {
      if (current.has(f) && !last.has(f)) last.set(f, c.date.slice(0, 10)); // newest first
    }
  }
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffDay = cutoff.toISOString().slice(0, 10);
  const rows = Array.from(last)
    .filter(([, day]) => day < cutoffDay)
    .map(([file, day]) => ({
      file,
      name: base(file),
      lastChanged: day,
      monthsAgo: Math.floor((now.getTime() - Date.parse(day)) / (30.44 * 86_400_000)),
    }))
    .sort((a, b) => b.monthsAgo - a.monthsAgo || a.file.localeCompare(b.file));
  return { months, staleFiles: rows, count: rows.length };
}
