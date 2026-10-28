/**
 * A one-paragraph description of a file built only from facts: what it
 * exports, who imports it, what it imports, and whether an entry-point
 * rule covers it. No guessing at roles from the file name.
 */
export function generateFileCrux(input: {
  exportNames: string[];
  importedBy: string[]; // distinct files
  internalImports: string[]; // distinct files
  externalPackages: string[]; // distinct package names
  entryReason?: string;
  role: 'source' | 'test';
}): string {
  const parts: string[] = [];

  if (input.role === 'test') parts.push('Test file.');
  if (input.entryReason) parts.push(`Entry point (${input.entryReason}).`);

  const ex = input.exportNames;
  if (ex.length === 0) {
    parts.push('Exports nothing.');
  } else {
    const shown = ex.slice(0, 3).join(', ');
    parts.push(`Exports ${shown}${ex.length > 3 ? ` and ${ex.length - 3} more` : ''}.`);
  }

  const n = input.importedBy.length;
  parts.push(n === 0 ? 'No analyzed file imports it.' : `Imported by ${n} file${n === 1 ? '' : 's'}.`);

  const i = input.internalImports.length;
  const p = input.externalPackages.length;
  if (i > 0 || p > 0) {
    const bits: string[] = [];
    if (i > 0) bits.push(`${i} project file${i === 1 ? '' : 's'}`);
    if (p > 0) bits.push(`${p} package${p === 1 ? '' : 's'}`);
    parts.push(`Imports ${bits.join(' and ')}.`);
  }

  return parts.join(' ');
}
