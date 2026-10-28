import { ts } from 'ts-morph';
import * as crypto from 'crypto';
import * as path from 'path';
import type { DuplicateGroup } from '../types.js';
import type { Parsed } from './extract.js';

/** Files shorter than this many tokens are ignored (tiny barrels and stubs are often identical on purpose). */
export const MIN_DUPLICATE_TOKENS = 40;

/**
 * Whole-file duplicates.
 *
 * Two files are grouped when their token streams are identical, i.e. they
 * are the same code once whitespace and comments are ignored. Each group
 * says whether the files are also byte-for-byte identical.
 */
export function findDuplicates(parsed: Parsed[]): DuplicateGroup[] {
  const byTokens = new Map<string, Array<{ rel: string; bytes: string }>>();

  for (const { sf, rel } of parsed) {
    const text = sf.getFullText();
    const tokens = tokenize(text, rel);
    if (tokens.length < MIN_DUPLICATE_TOKENS) continue;
    const tokenHash = sha1(tokens.join('\u0000'));
    const bytesHash = sha1(text);
    if (!byTokens.has(tokenHash)) byTokens.set(tokenHash, []);
    byTokens.get(tokenHash)!.push({ rel, bytes: bytesHash });
  }

  const groups: DuplicateGroup[] = [];
  for (const members of byTokens.values()) {
    if (members.length < 2) continue;
    const sameBytes = members.every((m) => m.bytes === members[0].bytes);
    groups.push({
      type: 'exact-file',
      match: sameBytes ? 'bytes' : 'tokens',
      items: members.map((m) => ({ file: m.rel, name: path.posix.basename(m.rel), line: 1 })),
      similarity: 100,
    });
  }
  return groups.sort((a, b) => a.items[0].file.localeCompare(b.items[0].file));
}

export function tokenize(text: string, fileName: string): string[] {
  const isJsx = /\.[jt]sx$/i.test(fileName);
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ true,
    isJsx ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
    text,
  );
  const tokens: string[] = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    tokens.push(scanner.getTokenText());
  }
  return tokens;
}

function sha1(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex');
}
