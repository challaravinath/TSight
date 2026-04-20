import { Project, SourceFile, ScriptTarget, ModuleKind } from 'ts-morph';
import * as fs from 'fs';
import * as path from 'path';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

const EXCLUDE_PATTERNS = [
  'node_modules',
  'dist',
  'build',
  '.git',
  'coverage',
  '__tests__',
  '__mocks__',
  '*.test.',
  '*.spec.',
  '.d.ts',
  'integration-tests',
  'e2e',
];

export function createProject(): Project {
  return new Project({
    compilerOptions: {
      target: ScriptTarget.ESNext,
      module: ModuleKind.ESNext,
      jsx: 2, // React
      allowJs: true,
      skipLibCheck: true,
      noEmit: true,
    },
    skipAddingFilesFromTsConfig: true,
  });
}

export function addSourceFiles(project: Project, projectPath: string): SourceFile[] {
  const files: string[] = [];
  walkDir(projectPath, files, SOURCE_EXTENSIONS, EXCLUDE_PATTERNS);

  for (const file of files) {
    try {
      project.addSourceFileAtPath(file);
    } catch (e) {
      // Skip files that can't be parsed
    }
  }

  return project.getSourceFiles();
}

function walkDir(
  dir: string,
  files: string[],
  extensions: string[],
  exclude: string[],
): void {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (exclude.some((ex) => entry.name.includes(ex) || fullPath.includes(ex))) {
        continue;
      }

      if (entry.isDirectory()) {
        walkDir(fullPath, files, extensions, exclude);
      } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
        files.push(fullPath);
      }
    }
  } catch (e) {
    // Skip inaccessible directories
  }
}
