import { Proof } from '../evidence';
import { blastLevels, fmt, plural, type Model } from '../model';
import * as P from '../proofs';
import { to } from '../router';

export function File({ m, path }: { m: Model; path: string }) {
  const i = m.byPath.get(path);
  if (i === undefined) {
    return (
      <div className="page-head">
        <h1>File not found</h1>
        <p>
          <span className="mono">{path}</span> is not part of this analysis. It may be ignored by git, a declaration file, or outside the
          analyzed folder. <a href={to.files}>Browse all files</a>
        </p>
      </div>
    );
  }
  const f = m.files[i];
  const g = m.git.get(i);
  const hs = m.hotspot.get(i);
  const reach = blastLevels(m, i).reduce((a, l) => a + l.length, 0);
  const fns = [...m.fns[i]].sort((a, b) => b.complexity - a.complexity || a.line - b.line);
  const importers = [...m.importers[i]].sort((a, b) => m.files[a].path.localeCompare(m.files[b].path));
  const imports = [...new Set(m.importsFrom[i].map((k) => m.s.imports[k].to))].filter((t) => t !== i).sort((a, b) => m.files[a].path.localeCompare(m.files[b].path));
  const ext = [...new Set(m.s.externalImports.filter((e) => e.from === i).map((e) => e.package))].sort();
  const partners = (m.s.git?.coChanges ?? []).filter((c) => c.a === i || c.b === i);
  const copies = P.copies(m, path).items.length;
  const cycle = m.cycleOf.get(i);
  const none = m.s.noImporters.find((x) => x.file === i);
  const solo = m.soloAuthor.get(i);

  return (
    <>
      <div className="page-head">
        <nav className="crumbs" aria-label="Path" style={{ marginBottom: 6 }}>
          <a href={to.files}>Files</a>
        </nav>
        <h1 className="mono" style={{ fontSize: 22, overflowWrap: 'anywhere' }}>{f.path}</h1>
        <p style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {f.role === 'test' && <span className="chip">test file</span>}
          {f.entry && <span className="chip ok">entry point: {f.entry}</span>}
          {cycle !== undefined && (
            <span className="chip bad">
              <Proof of={() => P.cycleGroup(m, cycle)}>in a dependency cycle of {plural(m.s.cycleGroups[cycle].files.length, 'file')}</Proof>
            </span>
          )}
          {none && <span className="chip risk">{none.onlyTests ? 'only imported by tests' : 'nothing imports this file'}</span>}
          {solo && <span className="chip" style={{ color: 'var(--people)' }}>only {solo} has changed it{m.inactive(solo) ? ', inactive 6+ months' : ''}</span>}
        </p>
      </div>

      <section className="facts" aria-label="Facts">
        <Fact label="Lines" value={fmt(f.lines)} />
        <Fact label="Dependents" value={<Proof of={() => P.importersOf(m, i)}>{fmt(m.importers[i].size)}</Proof>} />
        <Fact label="Reach" value={<Proof of={() => P.blastOf(m, i)}>{fmt(reach)}</Proof>} />
        <Fact label="Highest complexity" value={<Proof of={() => P.functionsOf(m, i)}>{fmt(f.maxComplexity)}</Proof>} />
        {m.s.git && <Fact label="Commits, 90 days" value={fmt(g?.commits90 ?? 0)} />}
        {m.s.git && <Fact label="Hotspot score" value={hs && hs.score > 0 ? <Proof of={() => P.hotspots(m)}>{fmt(hs.score)}</Proof> : '0'} />}
      </section>

      <div className="row">
        <section className="panel grow">
          <div className="panel-head">
            <div>
              <h2>Functions</h2>
              <div className="sub">{plural(fns.length, 'function')}, most complex first</div>
            </div>
          </div>
          {fns.length === 0 ? (
            <p className="empty">No functions in this file.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Function</th>
                    <th className="num">Line</th>
                    <th className="num">Lines</th>
                    <th className="num">Parameters</th>
                    <th className="num">Complexity</th>
                  </tr>
                </thead>
                <tbody>
                  {fns.slice(0, 15).map((fn, k) => (
                    <tr key={k}>
                      <td className="mono" style={{ overflowWrap: 'anywhere' }}>{fn.name}()</td>
                      <td className="num">{fn.line}</td>
                      <td className="num">{fmt(fn.lines)}</td>
                      <td className="num">{fn.params}</td>
                      <td className="num">
                        <strong style={{ color: fn.complexity >= 20 ? 'var(--risk-ink)' : undefined }}>{fn.complexity}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {fns.length > 15 && (
                <p className="note">
                  Showing 15 of {fns.length}. <Proof of={() => P.functionsOf(m, i)}>See all</Proof>
                </p>
              )}
            </div>
          )}
        </section>

        <section className="panel side">
          <h2>History</h2>
          {!m.s.git ? (
            <p className="empty">No git history.</p>
          ) : !g ? (
            <p className="empty">No commits touch this file in the history TSight read.</p>
          ) : (
            <>
              <p className="sub" style={{ marginBottom: 10 }}>
                {plural(g.commits, 'commit')} in total, last on {g.lastChanged}
              </p>
              <div className="list">
                {g.authors.slice(0, 8).map((a) => (
                  <div className="list-row" key={a.name}>
                    <span className="main">
                      <span style={{ display: 'block' }}>{a.name}</span>
                      <span className="detail">
                        {m.inactive(a.name) ? `no commits since ${m.s.git!.authorLastActive[a.name] ?? 'unknown'}` : 'active in the last 6 months'}
                      </span>
                    </span>
                    <span className="val">{fmt(a.commits)}</span>
                  </div>
                ))}
              </div>
              {g.authors.length > 8 && <p className="note">and {plural(g.authors.length - 8, 'more author')}</p>}
            </>
          )}
        </section>
      </div>

      <section className="grid-3">
        <FileList m={m} title="Imported by" sub="Files that import this one" files={importers} proof={() => P.importersOf(m, i)} empty="Nothing imports this file." />
        <FileList m={m} title="Imports" sub="Project files this one imports" files={imports} proof={() => P.importsOf(m, i)} empty="No project imports." />
        <div className="panel">
          <h2>Changes with</h2>
          <div className="sub" style={{ marginBottom: 8 }}>Files that usually change in the same commits</div>
          {!m.s.git ? (
            <p className="empty">No git history.</p>
          ) : partners.length === 0 ? (
            <p className="empty">No file changes with this one often enough to list.</p>
          ) : (
            <div className="list">
              {partners.slice(0, 8).map((c, k) => {
                const o = c.a === i ? c.b : c.a;
                return (
                  <a className="list-row" key={k} href={to.file(m.files[o].path)}>
                    <span className="main">
                      <span className="path">{m.files[o].path}</span>
                      <span className="detail">
                        {c.together} commits together{c.hidden ? ', no import between them' : ''}
                      </span>
                    </span>
                    <span className="val">{Math.round(c.confidence * 100)}%</span>
                  </a>
                );
              })}
              {partners.length > 8 && <Proof of={() => P.coupling(m, { file: i })}>See all {partners.length}</Proof>}
            </div>
          )}
        </div>
      </section>

      <section className="grid-3">
        <div className="panel">
          <h2>Packages</h2>
          <div className="sub" style={{ marginBottom: 8 }}>npm packages and Node built-ins this file imports</div>
          {ext.length === 0 ? <p className="empty">None.</p> : <div className="codebox">{ext.join('\n')}</div>}
        </div>
        <div className="panel">
          <h2>Exports</h2>
          <div className="sub" style={{ marginBottom: 8 }}>{plural(f.exports.length, 'name')} exported</div>
          {f.exports.length === 0 ? <p className="empty">Exports nothing.</p> : <div className="codebox">{f.exports.slice(0, 80).join(', ')}{f.exports.length > 80 ? ', …' : ''}</div>}
        </div>
        <div className="panel">
          <h2>Copied code</h2>
          <div className="sub" style={{ marginBottom: 8 }}>Code here that also appears elsewhere</div>
          {copies === 0 ? <p className="empty">None found.</p> : <Proof of={() => P.copies(m, path)}>{plural(copies, 'match', 'matches')}</Proof>}
        </div>
      </section>
    </>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="fact">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

function FileList({ m, title, sub, files, proof, empty }: { m: Model; title: string; sub: string; files: number[]; proof: () => import('../evidence').Evidence; empty: string }) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      <div className="sub" style={{ marginBottom: 8 }}>{sub}</div>
      {files.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <div className="list">
          {files.slice(0, 8).map((f) => (
            <a className="list-row" key={f} href={to.file(m.files[f].path)}>
              <span className="main">
                <span className="path">{m.files[f].path}</span>
              </span>
              {m.files[f].role === 'test' && <span className="chip">test</span>}
            </a>
          ))}
          {files.length > 8 && (
            <div style={{ paddingTop: 8 }}>
              <Proof of={proof}>See all {fmt(files.length)}</Proof>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
