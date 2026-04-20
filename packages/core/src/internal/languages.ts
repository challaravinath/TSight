import { FileInfo, LanguageBreakdown } from '../types.js';

export function calculateLanguages(files: FileInfo[]): LanguageBreakdown[] {
  const langMap: Record<string, { count: number; lines: number; color: string }> = {
    '.ts': { count: 0, lines: 0, color: '#3178c6' },
    '.tsx': { count: 0, lines: 0, color: '#61dafb' },
    '.js': { count: 0, lines: 0, color: '#f7df1e' },
    '.jsx': { count: 0, lines: 0, color: '#61dafb' },
  };

  const langNames: Record<string, string> = {
    '.ts': 'TypeScript',
    '.tsx': 'React TSX',
    '.js': 'JavaScript',
    '.jsx': 'React JSX',
  };

  let totalLines = 0;

  for (const file of files) {
    if (langMap[file.extension]) {
      langMap[file.extension].count++;
      langMap[file.extension].lines += file.lines;
      totalLines += file.lines;
    }
  }

  return Object.entries(langMap)
    .filter(([, data]) => data.count > 0)
    .map(([ext, data]) => ({
      language: langNames[ext],
      extension: ext,
      fileCount: data.count,
      lines: data.lines,
      percentage: Math.round((data.lines / totalLines) * 100),
      color: data.color,
    }))
    .sort((a, b) => b.percentage - a.percentage);
}
