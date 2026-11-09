import * as fs from 'fs';
import { Project, SourceFile, ts } from 'ts-morph';
import type { DiscoveredFile } from './discovery.js';
import { componentScript, isComponentFile } from './framework.js';

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
      noResolve: true,
    },
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
  });

  const out: Array<{ sf: SourceFile; file: DiscoveredFile }> = [];
  for (const file of files) {
    try {
      if (isComponentFile(file.rel)) {
        // Parse only the <script> blocks; the file keeps its own path, length and line numbers.
        const { text, scriptKind } = componentScript(file.rel, fs.readFileSync(file.abs, 'utf8'));
        out.push({ sf: project.createSourceFile(file.abs, text, { scriptKind, overwrite: true }), file });
      } else {
        out.push({ sf: project.addSourceFileAtPath(file.abs), file });
      }
    } catch {
      // Unreadable file: skipped and counted by the caller.
    }
  }
  return out;
}
