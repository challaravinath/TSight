import {
  FileInfo,
  ClassInfo,
  FunctionInfo,
  InterfaceInfo,
  ImportInfo,
} from '../types.js';

/**
 * Generate a brief, plain-English description of what a file does, derived
 * purely from analysis facts (pattern, exports, usage, dependencies).
 */
export function generateFileCrux(
  file: FileInfo,
  classes: ClassInfo[],
  functions: FunctionInfo[],
  interfaces: InterfaceInfo[],
  imports: ImportInfo[],
  importedBy: ImportInfo[],
): string {
  const parts: string[] = [];

  // 1. Detect pattern type
  const pattern = detectFilePattern(file, classes, functions);
  parts.push(pattern);

  // 2. What it exports
  const exportCount =
    classes.filter((c) => c.exported).length +
    functions.filter((f) => f.exported).length +
    interfaces.filter((i) => i.exported).length;

  if (exportCount > 0) {
    const mainExports: string[] = [];
    classes
      .filter((c) => c.exported)
      .slice(0, 2)
      .forEach((c) => mainExports.push(`${c.name} class`));
    functions
      .filter((f) => f.exported)
      .slice(0, 2)
      .forEach((f) => mainExports.push(`${f.name}()`));

    if (mainExports.length > 0) {
      const more =
        exportCount > mainExports.length ? ` and ${exportCount - mainExports.length} more` : '';
      parts.push(`Exports ${mainExports.join(', ')}${more}.`);
    }
  }

  // 3. Usage status
  if (importedBy.length === 0) {
    if (file.path.toLowerCase().includes('test') || file.path.toLowerCase().includes('mock')) {
      parts.push('Test/mock utility - used by test files.');
    } else if (pattern.includes('Control') || pattern.includes('entry')) {
      parts.push('Entry point - loaded directly by framework.');
    } else {
      parts.push('Not imported by other files.');
    }
  } else if (importedBy.length >= 10) {
    parts.push(`Core file - imported by ${importedBy.length} files.`);
  } else if (importedBy.length >= 5) {
    parts.push(`Widely used - imported by ${importedBy.length} files.`);
  } else {
    parts.push(`Used by ${importedBy.length} file${importedBy.length > 1 ? 's' : ''}.`);
  }

  // 4. Key dependencies
  const internalImports = imports.filter((i) => !i.isExternal);
  if (internalImports.length > 0) {
    const keyDeps = internalImports.slice(0, 3).map((i) => {
      const segments = i.to.split('/');
      return segments[segments.length - 1].replace(/\.(ts|tsx)$/, '');
    });
    parts.push(
      `Depends on ${keyDeps.join(', ')}${internalImports.length > 3 ? ` +${internalImports.length - 3} more` : ''}.`,
    );
  }

  return parts.join(' ');
}

function detectFilePattern(
  file: FileInfo,
  classes: ClassInfo[],
  functions: FunctionInfo[],
): string {
  const name = file.name.toLowerCase();
  const path = file.path.toLowerCase();

  if (name.includes('control') && file.extension === '.tsx') return 'PCF Control';
  if (
    name.includes('control') &&
    classes.some((c) => c.methods.some((m) => m.name === 'init' || m.name === 'updateView'))
  )
    return 'PCF Control';
  if (name.startsWith('use') && functions.length > 0) return 'React Hook';
  if (name.includes('.hook')) return 'React Hook';
  if (name.includes('service')) return 'Service';
  if (name.includes('provider')) return 'Provider';
  if (name.includes('context')) return 'React Context';
  if (name.includes('util') || name.includes('helper')) return 'Utility file';
  if (name.includes('constant') || name.includes('config')) return 'Constants file';
  if (name.includes('type') || name.includes('interface')) return 'Type definitions';
  if (name.includes('mock') || path.includes('/mock')) return 'Mock/test utility';
  if (name.includes('test') || name.includes('spec')) return 'Test file';
  if (
    file.extension === '.tsx' &&
    functions.some((f) => f.name[0] === f.name[0].toUpperCase())
  )
    return 'React Component';
  if (classes.length > 0 && classes[0].decorators.length > 0) return 'Decorated class';
  if (classes.length > 0) return 'Class module';
  if (functions.length > 0) return 'Function module';
  if (file.extension === '.ts') return 'TypeScript module';

  return 'Module';
}
