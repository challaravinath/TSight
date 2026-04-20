import * as path from 'path';

export function toRelative(rootPath: string, filePath: string): string {
  return path.relative(rootPath, filePath).replace(/\\/g, '/');
}
