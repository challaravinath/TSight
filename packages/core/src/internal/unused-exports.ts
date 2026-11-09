import type { EntryPoint, FileInfo, ImportInfo } from '../types.js';
import { isComponentFile } from './framework.js';

export interface UnusedExport {
  file: string;
  name: string;
  line: number;
  kind: 'value' | 'type';
  /** Only test files use it. */
  onlyTests: boolean;
}

/** A use of every type export of a file, but none of its values. */
const TYPES = '*type';

/** How a file can be used by name: what it declares, and what it passes on from other files. */
interface Surface {
  own: Set<string>;
  /** export { a as b } from './x': b -> [{ file: x, name: a }] */
  named: Map<string, Array<{ file: string; name: string }>>;
  /** export * as ns from './x': ns -> x */
  namespaces: Map<string, string>;
  /** export * from './x' */
  stars: string[];
}

/**
 * Exports that no file uses.
 *
 * Uses start at the imports and follow re-exports to the file that declares
 * the name: importing `b` from a barrel that does `export { a as b } from './x'`
 * uses `a` in x, and a name a barrel does not declare is looked up in each of
 * its `export *` files.
 *
 * Some imports can use any export of a file, so they count as using all of
 * them: `import * as ns`, `import()`, `require()` and `import.meta.glob`. The
 * exports of entry-point files are what the outside world loads, so they all
 * count as used, and so does everything they re-export.
 *
 * Not reported: files nothing imports (they are listed as a whole already),
 * test files, and .vue, .svelte and .astro files, whose `export` lines are
 * mostly component props and framework hooks rather than module exports.
 */
export function findUnusedExports(
  files: FileInfo[],
  imports: ImportInfo[],
  exportsByFile: Record<string, string[]>,
  exportLines: Record<string, Record<string, number>>,
  typeExports: Record<string, string[]>,
  entryPoints: EntryPoint[],
  filesWithoutImporters: Set<string>,
): { unused: UnusedExport[]; totalExports: number; filesUsedAsAWhole: number } {
  const role = new Map(files.map((f) => [f.path, f.role] as const));
  const surface = (file: string): Surface => {
    let s = surfaces.get(file);
    if (!s) {
      s = { own: new Set(exportsByFile[file] ?? []), named: new Map(), namespaces: new Map(), stars: [] };
      surfaces.set(file, s);
    }
    return s;
  };
  const surfaces = new Map<string, Surface>();

  const internal = imports.filter((i) => i.kind === 'internal' && i.from !== i.to);
  for (const imp of internal) {
    if (imp.syntax !== 'export') continue;
    const s = surface(imp.from);
    if (!imp.exportedAs) {
      s.stars.push(imp.to);
    } else if (imp.imports[0] === '*') {
      s.namespaces.set(imp.exportedAs[0], imp.to);
    } else {
      imp.imports.forEach((name, i) => {
        const as = imp.exportedAs![i] ?? name;
        const list = s.named.get(as) ?? [];
        list.push({ file: imp.to, name });
        s.named.set(as, list);
      });
    }
  }

  // 2 = used by non-test code, 1 = used only by tests. Kept per file and name; '*' means every export.
  const used = new Map<string, Map<string, number>>();
  const level = (file: string, name: string) => used.get(file)?.get(name) ?? 0;

  const queue: Array<[string, string, number]> = [];
  const use = (file: string, name: string, how: number) => {
    if (level(file, name) >= how) return;
    if (!used.has(file)) used.set(file, new Map());
    used.get(file)!.set(name, how);
    queue.push([file, name, how]);
  };

  for (const imp of internal) {
    if (imp.syntax === 'export') continue; // passing a name on is not a use
    const how = role.get(imp.from) === 'test' ? 1 : 2;
    // import('./a').Config in a type names what it uses; a runtime import() can use anything.
    const namedTypeImport = imp.syntax === 'dynamic' && imp.typeOnly;
    const whole = (imp.syntax !== 'import' && !namedTypeImport) || imp.imports.includes('*');
    if (whole) use(imp.to, '*', how);
    else for (const name of imp.imports) use(imp.to, name, how);
  }
  // TYPES ('*type') means every type export: what an entry point reached only through .d.ts files makes public.
  for (const e of entryPoints) use(e.file, e.typesOnly ? TYPES : '*', role.get(e.file) === 'test' ? 1 : 2);

  while (queue.length > 0) {
    const [file, name, how] = queue.shift()!;
    const s = surfaces.get(file);
    if (!s) continue;
    if (name === TYPES) {
      // A name re-exported by name passes on when it is a type, or when the next file doesn't
      // declare it either (another re-export, kind not known here, so it is kept as used).
      for (const targets of s.named.values()) {
        for (const t of targets) {
          const declared = exportsByFile[t.file]?.includes(t.name);
          if (!declared || typeExports[t.file]?.includes(t.name)) use(t.file, t.name, how);
        }
      }
      for (const target of s.namespaces.values()) use(target, TYPES, how);
      for (const target of s.stars) use(target, TYPES, how);
      continue;
    }
    if (name === '*') {
      for (const targets of s.named.values()) for (const t of targets) use(t.file, t.name, how);
      for (const target of s.namespaces.values()) use(target, '*', how);
      for (const target of s.stars) use(target, '*', how);
      continue;
    }
    if (s.own.has(name)) continue;
    const named = s.named.get(name);
    if (named) {
      for (const t of named) use(t.file, t.name, how);
      continue;
    }
    const ns = s.namespaces.get(name);
    if (ns) {
      use(ns, '*', how);
      continue;
    }
    // export * never passes on a default export.
    if (name !== 'default') for (const target of s.stars) use(target, name, how);
  }

  const unused: UnusedExport[] = [];
  let totalExports = 0;
  let filesUsedAsAWhole = 0;
  for (const [file, names] of Object.entries(exportsByFile)) {
    if (role.get(file) !== 'source' || isComponentFile(file) || filesWithoutImporters.has(file)) continue;
    totalExports += names.length;
    const whole = level(file, '*');
    if (whole === 2 && names.length > 0) filesUsedAsAWhole++;
    const types = new Set(typeExports[file] ?? []);
    const allTypes = level(file, TYPES);
    for (const name of names) {
      const how = Math.max(whole, level(file, name), types.has(name) ? allTypes : 0);
      if (how === 2) continue;
      unused.push({ file, name, line: exportLines[file]?.[name] ?? 1, kind: types.has(name) ? 'type' : 'value', onlyTests: how === 1 });
    }
  }
  unused.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name));
  return { unused, totalExports, filesUsedAsAWhole };
}
