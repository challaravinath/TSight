import { Project, SourceFile, ts } from 'ts-morph';
import type { DiscoveredFile } from './discovery.js';

/**
 * A fresh ts-morph Project for one analysis run. Only parsing is used here
 * (no type checking), so it stays fast and never pulls in node_modules.
 */
export function parseFiles(files: DiscoveredFile[]): Array<{ sf: SourceFile; file: DiscoveredFile }> {
  const project = new Project({
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
      allowJs: true,
      noEmit: true,
    },
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
  });

  const out: Array<{ sf: SourceFile; file: DiscoveredFile }> = [];
  for (const file of files) {
    try {
      out.push({ sf: project.addSourceFileAtPath(file.abs), file });
    } catch {
      // Unreadable file: skipped and counted by the caller.
    }
  }
  return out;
}
