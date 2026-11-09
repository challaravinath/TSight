import { ts } from 'ts-morph';

/** Component files whose code sits inside <script> blocks (and, for Astro, a frontmatter fence). */
export const COMPONENT_EXTENSIONS = ['.vue', '.svelte', '.astro'];

export function isComponentFile(rel: string): boolean {
  const lower = rel.toLowerCase();
  return COMPONENT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * The code of a .vue, .svelte or .astro file, ready to parse as TypeScript.
 *
 * Everything outside the code blocks is replaced with spaces, keeping every
 * line break, so the text has the same length and line numbers as the file.
 *
 * Imports used only in the template (no <script> import) are not seen. In
 * Vue and Svelte the template can only use what the script imports or what a
 * plugin registers globally, so this covers normal code.
 */
export function componentScript(rel: string, text: string): { text: string; scriptKind: ts.ScriptKind } {
  const ranges: Array<[number, number]> = [];
  let jsx = false;

  if (rel.toLowerCase().endsWith('.astro')) {
    // The frontmatter: a --- fence at the very start of the file.
    const fence = text.match(/^(﻿?\s*---[^\S\r\n]*\r?\n)([\s\S]*?)(\r?\n---)/);
    if (fence) {
      const start = fence[1].length;
      ranges.push([start, start + fence[2].length]);
    }
  }

  for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = m[1];
    // <script type="application/ld+json"> and similar are data, not code.
    const type = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1].toLowerCase();
    if (type && !/^(module|text\/javascript|text\/typescript|application\/javascript)$/.test(type)) continue;
    const lang = attrs.match(/\blang\s*=\s*["']([^"']+)["']/i)?.[1].toLowerCase();
    if (lang === 'tsx' || lang === 'jsx') jsx = true;
    const start = (m.index ?? 0) + m[0].indexOf('>') + 1;
    ranges.push([start, start + m[2].length]);
  }

  // <script src="./x"> loads a file the same way an import does. Write `import "./x";`
  // over the opening tag when it fits, so lengths and lines stay the same.
  const imports: Array<[number, string]> = [];
  for (const m of text.matchAll(/<script\b[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi)) {
    const src = m[1];
    if (/^(https?:)?\/\//.test(src) || src.includes('\n')) continue;
    const statement = `import ${JSON.stringify(src)};`;
    if (statement.length <= m[0].length) imports.push([m.index ?? 0, statement.padEnd(m[0].length, ' ')]);
  }

  let out = '';
  let pos = 0;
  for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
    if (start < pos) continue;
    out += blank(text.slice(pos, start)) + text.slice(start, end);
    pos = end;
  }
  out += blank(text.slice(pos));
  for (const [at, statement] of imports) out = out.slice(0, at) + statement + out.slice(at + statement.length);
  return { text: separateBlocks(out, ranges), scriptKind: jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS };
}

function blank(s: string): string {
  return s.replace(/[^\r\n]/g, ' ');
}

/** Put a ; in the first blanked character after each block, so blocks parse as separate statements. */
function separateBlocks(text: string, ranges: Array<[number, number]>): string {
  let chars: string[] | null = null;
  for (const [, end] of ranges) {
    if (end < text.length && text[end] === ' ') {
      chars ??= text.split('');
      chars[end] = ';';
    }
  }
  return chars ? chars.join('') : text;
}
