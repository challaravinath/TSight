import type { FileInfo, LanguageBreakdown } from '../types.js';

const LANGUAGES: Record<string, { name: string; color: string }> = {
  '.ts': { name: 'TypeScript', color: '#3178c6' },
  '.mts': { name: 'TypeScript', color: '#3178c6' },
  '.cts': { name: 'TypeScript', color: '#3178c6' },
  '.tsx': { name: 'TypeScript JSX', color: '#61dafb' },
  '.js': { name: 'JavaScript', color: '#f7df1e' },
  '.mjs': { name: 'JavaScript', color: '#f7df1e' },
  '.cjs': { name: 'JavaScript', color: '#f7df1e' },
  '.jsx': { name: 'JavaScript JSX', color: '#e8c72a' },
};

/** Share of lines by language, source files only. */
export function calculateLanguages(files: FileInfo[]): LanguageBreakdown[] {
  const byName = new Map<string, LanguageBreakdown>();
  let total = 0;
  for (const f of files) {
    if (f.role !== 'source') continue;
    const lang = LANGUAGES[f.extension.toLowerCase()];
    if (!lang) continue;
    const entry = byName.get(lang.name) ?? { language: lang.name, extension: f.extension, fileCount: 0, lines: 0, percentage: 0, color: lang.color };
    entry.fileCount++;
    entry.lines += f.lines;
    total += f.lines;
    byName.set(lang.name, entry);
  }
  return Array.from(byName.values())
    .map((l) => ({ ...l, percentage: total > 0 ? Math.round((l.lines / total) * 100) : 0 }))
    .sort((a, b) => b.lines - a.lines);
}
