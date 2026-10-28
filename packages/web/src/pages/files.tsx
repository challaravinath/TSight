import { useMemo, useState } from 'react';
import { fmt, type Model } from '../model';
import { to } from '../router';

type Col = 'path' | 'lines' | 'max' | 'deps' | 'c90' | 'authors' | 'last';

export function Files({ m }: { m: Model }) {
  const hasGit = !!m.s.git;
  const [q, setQ] = useState('');
  const [tests, setTests] = useState(false);
  const [sort, setSort] = useState<{ col: Col; desc: boolean }>({ col: hasGit ? 'c90' : 'deps', desc: true });
  const [limit, setLimit] = useState(200);

  const cols: Array<{ key: Col; label: string; num?: boolean; git?: boolean; get: (i: number) => number | string }> = [
    { key: 'path', label: 'File', get: (i) => m.files[i].path },
    { key: 'lines', label: 'Lines', num: true, get: (i) => m.files[i].lines },
    { key: 'max', label: 'Highest complexity', num: true, get: (i) => m.files[i].maxComplexity },
    { key: 'deps', label: 'Dependents', num: true, get: (i) => m.importers[i].size },
    { key: 'c90', label: 'Commits, 90 days', num: true, git: true, get: (i) => m.git.get(i)?.commits90 ?? 0 },
    { key: 'authors', label: 'Authors', num: true, git: true, get: (i) => m.git.get(i)?.authors.length ?? 0 },
    { key: 'last', label: 'Last changed', git: true, get: (i) => m.git.get(i)?.lastChanged ?? '' },
  ];
  const visible = cols.filter((c) => !c.git || hasGit);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const col = cols.find((c) => c.key === sort.col)!;
    const list = m.files
      .map((_, i) => i)
      .filter((i) => (tests || m.files[i].role === 'source') && (!needle || m.files[i].path.toLowerCase().includes(needle)));
    list.sort((a, b) => {
      const x = col.get(a), y = col.get(b);
      const d = typeof x === 'number' ? x - (y as number) : String(x).localeCompare(String(y));
      return (sort.desc ? -d : d) || m.files[a].path.localeCompare(m.files[b].path);
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, q, tests, sort]);

  const setCol = (col: Col) => setSort((s) => ({ col, desc: s.col === col ? !s.desc : col !== 'path' }));

  return (
    <>
      <div className="page-head">
        <h1>Files</h1>
        <p>Every file TSight analyzed. Click a column to sort, or a file to see its imports, functions and history.</p>
      </div>
      <section className="panel">
        <div className="panel-head">
          <div className="field" style={{ flex: '1 1 320px', maxWidth: 480 }}>
            <label htmlFor="file-filter">Filter by path</label>
            <input id="file-filter" value={q} onChange={(e) => { setQ(e.target.value); setLimit(200); }} placeholder="src/components" />
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', alignSelf: 'flex-end', minHeight: 40 }}>
            <input type="checkbox" checked={tests} onChange={(e) => setTests(e.target.checked)} /> Include test files
          </label>
        </div>
        <p className="note" style={{ margin: '0 0 8px' }}>{fmt(rows.length)} files</p>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                {visible.map((c) => (
                  <th
                    key={c.key}
                    className={c.num ? 'num' : undefined}
                    aria-sort={sort.col === c.key ? (sort.desc ? 'descending' : 'ascending') : undefined}
                  >
                    <button onClick={() => setCol(c.key)}>
                      {c.label}
                      {sort.col === c.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((i) => (
                <tr key={i}>
                  {visible.map((c) => (
                    <td key={c.key} className={c.num ? 'num' : undefined}>
                      {c.key === 'path' ? (
                        <>
                          <a className="mono" href={to.file(m.files[i].path)} style={{ overflowWrap: 'anywhere' }}>{m.files[i].path}</a>
                          {m.files[i].role === 'test' && <span className="chip" style={{ marginLeft: 8 }}>test</span>}
                          {m.files[i].entry && <span className="chip ok" style={{ marginLeft: 8 }} title={m.files[i].entry!}>entry point</span>}
                        </>
                      ) : c.num ? (
                        fmt(c.get(i) as number)
                      ) : (
                        c.get(i) || <span className="muted">none</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > limit && (
          <div style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => setLimit((l) => l + 500)}>Show {fmt(Math.min(500, rows.length - limit))} more</button>
          </div>
        )}
      </section>
    </>
  );
}
