import { SourceFile } from 'ts-morph';
import * as path from 'path';
import * as crypto from 'crypto';
import { DuplicateGroup } from '../types.js';
import { toRelative } from './paths.js';

/**
 * Find exact-file duplicates by hashing whitespace/comment-stripped content.
 * Earlier signature accepted classes/functions/interfaces from a richer
 * similarity-detection pass, but those produced false positives and were
 * removed. The orchestrator now only passes what we actually use.
 */
export function findDuplicates(
  rootPath: string,
  sourceFiles: SourceFile[],
): DuplicateGroup[] {
  const duplicates: DuplicateGroup[] = [];
  const fileHashes = new Map<string, Array<{ path: string; name: string }>>();

  for (const sf of sourceFiles) {
    const content = sf.getFullText();
    const normalized = normalizeCode(content);

    if (normalized.length < 50) continue;

    const hash = crypto.createHash('md5').update(normalized).digest('hex');
    const relativePath = toRelative(rootPath, sf.getFilePath());

    if (!fileHashes.has(hash)) {
      fileHashes.set(hash, []);
    }
    fileHashes.get(hash)!.push({
      path: relativePath,
      name: path.basename(relativePath),
    });
  }

  for (const [, files] of fileHashes) {
    if (files.length > 1) {
      duplicates.push({
        type: 'exact-file',
        items: files.map((f) => ({ file: f.path, name: f.name, line: 1 })),
        similarity: 100,
      });
    }
  }

  return duplicates;
}

function normalizeCode(code: string): string {
  return code
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}
