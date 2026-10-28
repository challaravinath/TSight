/**
 * Evidence builders. Each returns the exact list a number on screen was counted from.
 */
import type { Evidence, EvidenceItem } from './evidence';
import { blastLevels, fmt, plural, type Model } from './model';
import { to } from './router';

const p = (m: Model, i: number) => m.files[i].path;

export function importLine(syntax: string, spec: string, typeOnly: boolean): string {
  const t = typeOnly ? 'type ' : '';
  switch (syntax) {
    case 'export': return `export ${t}… from '${spec}'`;
    case 'dynamic': return `import('${spec}')`;
    case 'require': return `require('${spec}')`;
    case 'glob': return `import.meta.glob('${spec}')`;
    default: return `import ${t}… from '${spec}'`;
  }
}

export const fileItem = (m: Model, i: number, extra: Partial<EvidenceItem> = {}): EvidenceItem => ({
  key: String(i),
  label: p(m, i),
  href: to.file(p(m, i)),
  ...extra,
});

export function importersOf(m: Model, i: number): Evidence {
  const rows = m.importsTo[i]
    .map((k) => m.s.imports[k])
    .filter((imp) => imp.from !== i)
    .sort((a, b) => p(m, a.from).localeCompare(p(m, b.from)) || a.line - b.line);
  const tests = [...m.importers[i]].filter((f) => m.files[f].role === 'test').length;
  return {
    kind: 'Dependents',
    title: `Files that import ${p(m, i)}`,
    definition: (
      <>
        <span>
          {plural(m.importers[i].size, 'file')} import this file directly
          {tests ? `, ${plural(tests, 'test file')} among them` : ''}. Each import statement is listed with its line.
        </span>
      </>
    ),
    items: rows.map((imp, k) => ({
      key: `${k}`,
      label: `${p(m, imp.from)}:${imp.line}`,
      href: to.file(p(m, imp.from)),
      right: m.files[imp.from].role === 'test' ? 'test' : undefined,
      code: importLine(imp.syntax, imp.specifier, imp.typeOnly),
    })),
    empty: 'No file in the project imports this one.',
  };
}

export function importsOf(m: Model, i: number): Evidence {
  const rows = m.importsFrom[i].map((k) => m.s.imports[k]).sort((a, b) => a.line - b.line);
  return {
    kind: 'Imports',
    title: `Project files imported by ${p(m, i)}`,
    definition: <span>Imports that resolve to another file in this project. Packages from npm are not included.</span>,
    items: rows.map((imp, k) => ({
      key: `${k}`,
      label: p(m, imp.to),
      href: to.file(p(m, imp.to)),
      right: `line ${imp.line}`,
      code: importLine(imp.syntax, imp.specifier, imp.typeOnly),
    })),
    empty: 'This file imports nothing from the project.',
  };
}

export function blastOf(m: Model, i: number): Evidence {
  const levels = blastLevels(m, i);
  const total = levels.reduce((a, l) => a + l.length, 0);
  return {
    kind: 'Reach',
    title: `Files that depend on ${p(m, i)}, directly or through other files`,
    definition: (
      <span>
        Follows imports backwards until nothing new turns up: {plural(total, 'file')} in {plural(levels.length, 'step')}. A change to the
        exports of this file can affect any of them. Imports TSight could not resolve are not followed.
      </span>
    ),
    items: levels.flatMap((files, d) =>
      files.map((f) => fileItem(m, f, { key: `${d}-${f}`, right: d === 0 ? 'direct' : `${d + 1} steps away` })),
    ),
    empty: 'Nothing depends on this file.',
  };
}

export function functionsOf(m: Model, i: number): Evidence {
  const fns = [...m.fns[i]].sort((a, b) => b.complexity - a.complexity || a.line - b.line);
  return {
    kind: 'Complexity',
    title: `Functions in ${p(m, i)}`,
    definition: (
      <span>
        Cyclomatic complexity counts the paths through a function: 1, plus one for each if, loop, case, catch, ?:, ?? and each && or ||.
        Callbacks written inline count toward the function that contains them.
      </span>
    ),
    items: fns.map((f, k) => ({
      key: `${k}`,
      label: `${f.name}()`,
      right: `complexity ${f.complexity}`,
      sub: `line ${f.line}, ${plural(f.lines, 'line')}, ${plural(f.params, 'parameter')}`,
    })),
    empty: 'No functions found in this file.',
  };
}

export function hotspots(m: Model): Evidence {
  const hs = m.s.git?.changeHotspots ?? [];
  return {
    kind: 'Change hotspots',
    title: 'Files that change often and are hard to follow',
    definition: (
      <span>
        Score = commits in the 90 days before the analysis × the highest complexity of any function in the file. Bot commits are not
        counted. The top {hs.length} are listed.
      </span>
    ),
    items: hs.map((h) =>
      fileItem(m, h.file, {
        right: fmt(h.score),
        sub: `${plural(h.commits, 'commit')} × complexity ${h.maxComplexity}${h.topFunction ? ` in ${h.topFunction}()` : ''}, ${plural(h.authors, 'author')}`,
      }),
    ),
    empty: 'No source file had commits in the last 90 days.',
  };
}

export function soloFiles(m: Model, only?: 'inactive' | string): Evidence {
  const rows = (m.s.git?.windows.all.singleAuthor ?? [])
    .filter((x) => (only === 'inactive' ? m.inactive(x.author) : only ? x.author === only : true))
    .sort((a, b) => a.author.localeCompare(b.author) || p(m, a.file).localeCompare(p(m, b.file)));
  return {
    kind: 'Single author',
    title:
      only === 'inactive'
        ? 'Single-author files whose author has gone quiet'
        : only
          ? `Files only ${only} has changed`
          : 'Files changed by one person only',
    definition: (
      <span>
        Every commit to these source files, over the whole history, came from the same person. Bot commits are ignored.
        {only === 'inactive' ? ' Listed here when that person has no commits in the 6 months before the analysis.' : ''}
      </span>
    ),
    items: rows.map((x) =>
      fileItem(m, x.file, { key: `${x.file}`, right: x.author, sub: m.inactive(x.author) ? `last commit ${m.s.git?.authorLastActive[x.author] ?? 'unknown'}` : undefined }),
    ),
  };
}

export function noImporters(m: Model, onlyTests: boolean): Evidence {
  const rows = m.s.noImporters.filter((x) => x.onlyTests === onlyTests).sort((a, b) => p(m, a.file).localeCompare(p(m, b.file)));
  return {
    kind: onlyTests ? 'Only used by tests' : 'No importers',
    title: onlyTests ? 'Source files only test files import' : 'Source files nothing imports',
    definition: (
      <span>
        {onlyTests
          ? 'The only files importing these are tests.'
          : 'No project file imports these, and no entry-point rule matches them (package.json fields, bin, exports, scripts, framework conventions, config files, tsight.config.json).'}{' '}
        {m.s.resolution.percentResolved}% of project imports resolved, so check the {plural(m.s.resolution.unresolved, 'unresolved import')} before deleting
        anything.
      </span>
    ),
    items: rows.map((x) => fileItem(m, x.file, { sub: `${plural(m.files[x.file].lines, 'line')}` })),
  };
}

export function unresolved(m: Model): Evidence {
  const r = m.s.resolution;
  return {
    kind: 'Unresolved imports',
    title: 'Imports that look like project code but could not be resolved',
    definition: (
      <span>
        TSight resolves imports the way TypeScript does, using the nearest tsconfig and its references. These relative or alias imports did
        not lead to a file. They are left out of every count, so dependents and reach can be a little low near them.
      </span>
    ),
    items: r.unresolvedImports.map((u, k) => ({
      key: `${k}`,
      label: `${u.from}:${u.line}`,
      href: m.byPath.has(u.from) ? to.file(u.from) : undefined,
      code: `'${u.specifier}'`,
    })),
    empty: 'Every project import resolved.',
  };
}

export function cycles(m: Model): Evidence {
  return {
    kind: 'Dependency cycles',
    title: 'Groups of files that import each other in a loop',
    definition: (
      <span>
        Each group is a set of files where every file can reach every other through runtime imports. Type-only and dynamic imports are left
        out because they do not cause load-order problems. One shortest loop is shown per group.
      </span>
    ),
    items: m.s.cycleGroups.map((g, k) => ({
      key: `${k}`,
      label: g.example[0],
      href: m.byPath.has(g.example[0]) ? to.file(g.example[0]) : undefined,
      right: plural(g.files.length, 'file'),
      code: [...g.example, g.example[0]].join('\n→ '),
    })),
    empty: 'No dependency cycles.',
  };
}

export function cycleGroup(m: Model, gi: number): Evidence {
  const g = m.s.cycleGroups[gi];
  return {
    kind: 'Dependency cycle',
    title: `${plural(g.files.length, 'file')} in one import loop`,
    definition: <code className="codebox" style={{ display: 'block' }}>{[...g.example, g.example[0]].join(' → ')}</code>,
    items: [...g.files].sort().map((f) => ({ key: f, label: f, href: m.byPath.has(f) ? to.file(f) : undefined })),
  };
}

export function copies(m: Model, file?: string): Evidence {
  const dup = m.s.duplicates.filter((d) => !file || d.items.some((x) => x.file === file));
  const twins = m.s.twins.filter((t) => !file || t.functionA.file === file || t.functionB.file === file);
  const items: EvidenceItem[] = [
    ...dup.map((d, k) => ({
      key: `d${k}`,
      label: d.items.map((x) => (d.type === 'exact-file' ? x.file : `${x.file}:${x.line}`)).join('\n'),
      right: d.type === 'exact-file' ? (d.match === 'bytes' ? 'identical files' : 'same code') : 'same function',
      sub:
        d.type === 'exact-file'
          ? d.match === 'bytes' ? 'Byte for byte the same.' : 'The same once whitespace and comments are ignored.'
          : `${d.items.map((x) => x.name + '()').join(', ')}: the same once whitespace and comments are ignored.`,
    })),
    ...twins.map((t, k) => ({
      key: `t${k}`,
      label: `${t.functionA.file}:${t.functionA.line}\n${t.functionB.file}:${t.functionB.line}`,
      right: 'same structure',
      sub: `${t.functionA.name}() and ${t.functionB.name}(): ${t.summary}`,
    })),
  ];
  return {
    kind: 'Copied code',
    title: file ? `Code in ${file} that also appears elsewhere` : 'Code that appears more than once',
    definition: (
      <span>
        Same code: identical files or functions once whitespace and comments are ignored. Same structure: functions of at least 80 syntax
        nodes with the same shape, where only names or literal values differ.
      </span>
    ),
    items,
    empty: 'No copied code found.',
  };
}

export function coupling(m: Model, opts: { hidden?: boolean; file?: number } = {}): Evidence {
  const pairs = (m.s.git?.coChanges ?? []).filter(
    (c) => (opts.hidden === undefined || c.hidden === opts.hidden) && (opts.file === undefined || c.a === opts.file || c.b === opts.file),
  );
  return {
    kind: 'Changed together',
    title: opts.file !== undefined ? `Files that change with ${p(m, opts.file)}` : opts.hidden ? 'Files that change together without importing each other' : 'Files that change together',
    definition: (
      <span>
        Pairs changed in the same commit at least 5 times, where at least 80% of the commits to the less-changed file also touched the other.
        Commits that touch more than 30 files are skipped. Hidden means neither file imports the other.
      </span>
    ),
    items: pairs.map((c, k) => {
      const other = opts.file === c.a ? c.b : c.a;
      const main = opts.file !== undefined ? other : c.a;
      return {
        key: `${k}`,
        label: opts.file !== undefined ? p(m, main) : `${p(m, c.a)}\n${p(m, c.b)}`,
        href: to.file(p(m, main)),
        right: `${Math.round(c.confidence * 100)}%`,
        sub: `${c.together} commits together; ${p(m, c.a).split('/').pop()} has ${c.commitsA}, ${p(m, c.b).split('/').pop()} has ${c.commitsB}${c.hidden ? '. No import between them.' : ''}`,
      };
    }),
    empty: 'No pairs met the threshold.',
  };
}

export function entryPoints(m: Model, reason?: string): Evidence {
  const rows = m.s.entryPoints.filter((e) => !reason || e.reason === reason).sort((a, b) => a.file.localeCompare(b.file));
  return {
    kind: 'Entry points',
    title: reason ? `Entry points: ${reason}` : 'Files used from outside the import graph',
    definition: (
      <span>
        Files that are run or loaded by something other than an import: package.json fields, scripts, HTML pages, framework conventions,
        config files and the entryPoints list in tsight.config.json. They never count as unused.
      </span>
    ),
    items: rows.map((e) => ({ key: e.file, label: e.file, href: m.byPath.has(e.file) ? to.file(e.file) : undefined, right: reason ? undefined : e.reason })),
  };
}

export function sourceFiles(m: Model): Evidence {
  return {
    kind: 'Source files',
    title: 'Source files analyzed',
    definition: <span>TypeScript and JavaScript files tracked by git (or not ignored), without declaration files and tests.</span>,
    items: [...m.sourceIdx].sort((a, b) => p(m, a).localeCompare(p(m, b))).map((i) => fileItem(m, i, { right: fmt(m.files[i].lines) })),
  };
}
