import { useMemo, useState } from 'react';
import { Proof, type Evidence } from '../evidence';
import { fmt, plural, type Model } from '../model';
import * as P from '../proofs';

type Window = 'all' | '6months' | '3months';
const WINDOWS: Array<[Window, string]> = [['all', 'All time'], ['6months', 'Last 6 months'], ['3months', 'Last 3 months']];

export function People({ m }: { m: Model }) {
  const g = m.s.git;
  const [win, setWin] = useState<Window>('all');

  const authors = useMemo(() => {
    if (!g) return [];
    const by = new Map<string, { name: string; solo: number[]; touched: number }>();
    const get = (name: string) => by.get(name) ?? (by.set(name, { name, solo: [], touched: 0 }), by.get(name)!);
    for (const f of g.files) if (m.files[f.file]?.role === 'source') for (const a of f.authors) get(a.name).touched++;
    for (const x of g.windows[win].singleAuthor) get(x.author).solo.push(x.file);
    return [...by.values()]
      .filter((a) => a.solo.length > 0 || win === 'all')
      .sort((a, b) => b.solo.length - a.solo.length || b.touched - a.touched || a.name.localeCompare(b.name));
  }, [g, m, win]);

  if (!g) {
    return (
      <div className="page-head">
        <h1>People</h1>
        <p>No git history was found for this folder, so there is nothing to show about who changed what. Analyze a git checkout to see it.</p>
      </div>
    );
  }

  const w = g.windows[win];
  const label = WINDOWS.find((x) => x[0] === win)![1].toLowerCase();
  const soloProof = (name: string, files: number[]): Evidence => ({
    kind: 'Single author',
    title: `Files only ${name} changed, ${label}`,
    definition: <span>Every non-bot commit to these source files in this period came from {name}.</span>,
    items: files.map((f) => P.fileItem(m, f)),
  });
  const gapsProof = (): Evidence => ({
    kind: 'No recent commits',
    title: `Source files nobody changed, ${label}`,
    definition: <span>No commit touched these files in this period. That is not a problem by itself, but nobody has had a recent reason to read them.</span>,
    items: w.gaps.map((f) => P.fileItem(m, f, { sub: m.git.get(f) ? `last changed ${m.git.get(f)!.lastChanged}` : undefined })),
  });

  return (
    <>
      <div className="page-head">
        <h1>People</h1>
        <p>Who changed which files, from the git log. Commits by bots are left out. A file with one author is knowledge that lives in one head.</p>
      </div>

      {g.shallow && (
        <p className="panel note" role="note">
          This is a shallow clone, so only part of the history is here. Counts cover the {plural(g.commits, 'commit')} TSight could read.
        </p>
      )}

      <div className="seg" role="group" aria-label="Period">
        {WINDOWS.map(([k, l]) => (
          <button key={k} aria-pressed={k === win} onClick={() => setWin(k)}>{l}</button>
        ))}
      </div>

      <section className="facts" aria-label="People facts">
        <div className="fact"><div className="label">Files changed in this period</div><div className="value">{fmt(w.filesWithActivity)}</div></div>
        <div className="fact">
          <div className="label">Of those, one author only</div>
          <div className="value"><Proof of={() => (win === 'all' ? P.soloFiles(m) : soloProof('one person', w.singleAuthor.map((x) => x.file)))}>{fmt(w.singleAuthor.length)}</Proof></div>
        </div>
        {win !== 'all' && (
          <div className="fact"><div className="label">Not changed at all</div><div className="value"><Proof of={gapsProof}>{fmt(w.gaps.length)}</Proof></div></div>
        )}
        <div className="fact"><div className="label">People with commits</div><div className="value">{fmt(Object.keys(g.authorLastActive).length)}</div></div>
      </section>

      <section className="panel">
        <h2>Authors</h2>
        <div className="sub" style={{ marginBottom: 8 }}>Sorted by files only they changed, {label}</div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Author</th>
                <th className="num">Files only they changed</th>
                <th className="num">Source files touched, all time</th>
                <th>Last commit</th>
              </tr>
            </thead>
            <tbody>
              {authors.slice(0, 100).map((a) => (
                <tr key={a.name}>
                  <td>{a.name}</td>
                  <td className="num">{a.solo.length ? <Proof of={() => soloProof(a.name, a.solo)}>{fmt(a.solo.length)}</Proof> : 0}</td>
                  <td className="num">{fmt(a.touched)}</td>
                  <td>
                    {g.authorLastActive[a.name] ?? 'unknown'}
                    {m.inactive(a.name) && <span className="chip" style={{ marginLeft: 8 }}>inactive 6+ months</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {authors.length > 100 && <p className="note">Showing 100 of {authors.length}.</p>}
      </section>
    </>
  );
}
