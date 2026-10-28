import { useState } from 'react';
import { Proof, type Evidence } from '../evidence';
import { fmt, isStatic, plural, type DiffReport, type Model } from '../model';
import { to } from '../router';

// Kept across page visits so a slow comparison is not run twice.
let last: { base: string; report: DiffReport } | null = null;

export function Changes({ m }: { m: Model }) {
  const staticDiff = isStatic() ? window.__TSIGHT_DIFF__ ?? null : undefined;
  const [base, setBase] = useState(last?.base ?? 'main');
  const [report, setReport] = useState<DiffReport | null>(staticDiff ?? last?.report ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`api/diff?base=${encodeURIComponent(base.trim())}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      last = { base: base.trim(), report: body };
      setReport(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>Changes</h1>
        <p>
          What your uncommitted and unmerged work changes compared with a branch: which files it reaches, who knows that code, and whether it
          adds a dependency loop. The same facts <span className="mono">tsight diff</span> prints for a pull request.
        </p>
      </div>

      {staticDiff === undefined ? (
        <form className="panel" onSubmit={run} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 260px', maxWidth: 360 }}>
            <label htmlFor="base">Compare with</label>
            <input id="base" value={base} onChange={(e) => setBase(e.target.value)} placeholder="main" spellCheck={false} />
            <span className="hint">A branch, tag or commit. The working copy is compared with where it split from this.</span>
          </div>
          <button className="btn primary" style={{ marginTop: 26 }} disabled={busy || !base.trim()}>{busy ? 'Comparing…' : 'Compare'}</button>
          {error && <p className="error" role="alert" style={{ flexBasis: '100%', margin: 0 }}>{error}</p>}
        </form>
      ) : staticDiff === null ? (
        <p className="panel empty">
          This report was made without a comparison. Run <span className="mono">tsight report --base main</span> to include one.
        </p>
      ) : null}

      {report && <Report m={m} d={report} />}
    </>
  );
}

function Report({ m, d }: { m: Model; d: DiffReport }) {
  const [limit, setLimit] = useState(40);
  const fnProof = (): Evidence => ({
    kind: 'Complexity change',
    title: 'Functions whose complexity changed',
    definition: <span>Cyclomatic complexity before and after, for functions in the changed files. New functions have no before, removed ones no after.</span>,
    items: d.complexity.functions.map((f, k) => ({
      key: `${k}`,
      label: `${f.file}`,
      href: m.byPath.has(f.file) ? to.file(f.file) : undefined,
      right: `${f.before ?? 'new'} → ${f.after ?? 'removed'}`,
      sub: `${f.name}()`,
    })),
    empty: 'No function changed complexity.',
  });
  const entryProof = (): Evidence => ({
    kind: 'Entry points',
    title: 'Entry points this change can reach',
    definition: <span>Files started by something other than an import (package.json, scripts, framework conventions) that depend on a changed file.</span>,
    items: d.blastRadius.entryPoints.map((f) => ({ key: f, label: f, href: m.byPath.has(f) ? to.file(f) : undefined })),
  });
  const reachProof = (): Evidence => ({
    kind: 'Reach',
    title: 'Files that depend on what changed',
    definition: <span>Files outside this change that import a changed file, directly or through other files, after the change.</span>,
    items: (d.blastRadius.reached ?? []).map((f) => ({ key: f, label: f, href: m.byPath.has(f) ? to.file(f) : undefined })),
  });
  const ownerProof = (): Evidence => ({
    kind: 'Owners',
    title: 'Who wrote the lines this change touches',
    definition: <span>From git blame at the merge base, for the changed and deleted files. Bot commits are left out.</span>,
    items: d.owners.map((o) => ({ key: o.author, label: o.author, right: `${o.percent}%`, sub: plural(o.lines, 'line') })),
    empty: 'Only new files, so nobody wrote these lines before.',
  });
  const source = d.files.filter((f) => f.role === 'source').length;
  const net = d.complexity.net;

  return (
    <>
      <p className="note">
        Comparing {d.head === 'working tree' ? 'the working tree' : <span className="mono">{d.head}</span>} with <span className="mono">{d.base}</span> from merge base <span className="mono">{d.mergeBase.slice(0, 10)}</span>.{' '}
        {plural(d.totals.files, 'file')} changed, +{fmt(d.totals.added)} −{fmt(d.totals.removed)} lines.
        {d.shallowHistory && ' This is a shallow clone, so authorship and co-change counts only cover the history that is there.'}
      </p>

      {d.newCycles.length > 0 && (
        <section className="panel" style={{ borderColor: 'var(--bad)' }}>
          <h2 style={{ color: 'var(--bad)' }}>New or larger dependency cycles</h2>
          <div className="sub" style={{ marginBottom: 8 }}>After this change, these files import each other in a loop.</div>
          {d.newCycles.map((c, k) => (
            <div key={k} className="codebox" style={{ marginTop: 8 }}>
              {[...c.example, c.example[0]].join(' → ')}
            </div>
          ))}
        </section>
      )}

      <section className="grid-3">
        <div className="panel answer risk">
          <h2>Reach</h2>
          <div className="big">
            {d.blastRadius.reached ? <Proof of={reachProof}>{fmt(d.blastRadius.files)}</Proof> : fmt(d.blastRadius.files)}{' '}
            <small>other files depend on what changed</small>
          </div>
          <div className="formula">
            <span>{d.blastRadius.percent}% of the project, including <Proof of={entryProof}>{plural(d.blastRadius.entryPoints.length, 'entry point')}</Proof></span>
          </div>
          <div className="next">From {plural(source, 'changed source file')}, following imports backwards.</div>
        </div>
        <div className="panel answer people">
          <h2>Who knows this code</h2>
          {d.owners.length ? (
            <>
              <div className="big" style={{ fontSize: 24 }}>{d.owners[0].author}</div>
              <div className="formula">
                <span>
                  wrote <Proof of={ownerProof}>{d.owners[0].percent}%</Proof> of the existing lines this change touches
                </span>
              </div>
              <div className="next">{d.owners.length > 1 ? `${plural(d.owners.length - 1, 'other person', 'other people')} wrote the rest.` : 'Nobody else wrote any of them.'}</div>
            </>
          ) : (
            <p className="empty">Only new files, so nobody wrote these lines before.</p>
          )}
        </div>
        <div className="panel answer">
          <h2>Complexity</h2>
          <div className="big">
            <Proof of={fnProof}>{net > 0 ? `+${net}` : net}</Proof> <small>net change</small>
          </div>
          <div className="formula">
            <span>Sum of function complexity in the changed files, after minus before.</span>
          </div>
          <div className="next">
            {d.newCycles.length === 0 ? 'No new dependency cycles.' : plural(d.newCycles.length, 'new cycle group')}
            {d.removedCycles > 0 ? ` ${plural(d.removedCycles, 'cycle group')} removed.` : ''}
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Changed files</h2>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="data">
            <thead>
              <tr>
                <th>File</th>
                <th>Status</th>
                <th className="num">Lines</th>
                <th className="num">Complexity</th>
                <th className="num">Dependents</th>
                <th>Mostly written by</th>
              </tr>
            </thead>
            <tbody>
              {d.files.slice(0, limit).map((f) => (
                <tr key={f.path}>
                  <td>
                    {m.byPath.has(f.path) ? <a className="mono" href={to.file(f.path)}>{f.path}</a> : <span className="mono">{f.path}</span>}
                    {f.oldPath && <div className="note mono">from {f.oldPath}</div>}
                    {f.role === 'test' && <span className="chip" style={{ marginLeft: 8 }}>test</span>}
                  </td>
                  <td>{f.status}</td>
                  <td className="num">+{fmt(f.added)} −{fmt(f.removed)}</td>
                  <td className="num">
                    {f.complexityBefore ?? 'new'} → {f.complexityAfter ?? 'removed'}
                  </td>
                  <td className="num">{fmt(f.directDependents)}</td>
                  <td>
                    {f.topAuthor ?? <span className="muted">{f.status === 'added' ? 'new file' : 'not known'}</span>}
                    {f.onlyAuthor && <span className="chip" style={{ marginLeft: 8, color: 'var(--people)' }}>only author</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.files.length > limit && (
          <button className="btn" style={{ marginTop: 12 }} onClick={() => setLimit(d.files.length)}>
            Show all {fmt(d.files.length)} files
          </button>
        )}
      </section>

      <section className="panel">
        <h2>Usually changed with these</h2>
        <div className="sub" style={{ marginBottom: 8 }}>
          Files that changed together with a file in this change in past commits, but are not part of it. Worth a look before merging.
        </div>
        {d.partners.length === 0 ? (
          <p className="empty">None. No file outside this change has a strong history of changing with it.</p>
        ) : (
          <div className="list">
            {d.partners.map((p, k) => (
              <div className="list-row" key={k}>
                <span className="main">
                  {m.byPath.has(p.file) ? <a className="path" href={to.file(p.file)}>{p.file}</a> : <span className="path">{p.file}</span>}
                  <span className="detail">
                    changed with {p.partnerOf} in {p.together} of its {p.commitsOfChanged} commits{p.hidden ? '; no import between them' : ''}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
