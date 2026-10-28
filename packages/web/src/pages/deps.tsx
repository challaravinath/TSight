import { useMemo } from 'react';
import { Proof, type Evidence } from '../evidence';
import { fmt, plural, type Model } from '../model';
import * as P from '../proofs';
import { to } from '../router';

export function Dependencies({ m }: { m: Model }) {
  const s = m.s;
  const r = s.resolution;

  const mostImported = useMemo(
    () => m.sourceIdx.filter((i) => m.importers[i].size > 0).sort((a, b) => m.importers[b].size - m.importers[a].size).slice(0, 12),
    [m],
  );
  const packages = useMemo(() => {
    const by = new Map<string, Array<{ from: number; line: number }>>();
    for (const e of s.externalImports) {
      const l = by.get(e.package) ?? [];
      l.push(e);
      by.set(e.package, l);
    }
    return [...by].map(([name, uses]) => ({ name, uses, files: new Set(uses.map((u) => u.from)).size })).sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));
  }, [s]);
  const reasons = useMemo(() => {
    const by = new Map<string, number>();
    for (const e of s.entryPoints) by.set(e.reason, (by.get(e.reason) ?? 0) + 1);
    return [...by].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [s]);

  const packageProof = (p: (typeof packages)[number]): Evidence => ({
    kind: 'Package',
    title: `Files that import ${p.name}`,
    definition: <span>Every file that imports this package, with the lines of its import statements.</span>,
    items: [...new Set(p.uses.map((u) => u.from))]
      .sort((a, b) => m.files[a].path.localeCompare(m.files[b].path))
      .map((f) => {
        const lines = p.uses.filter((u) => u.from === f).map((u) => u.line).sort((a, b) => a - b);
        return { key: `${f}`, label: m.files[f].path, href: to.file(m.files[f].path), sub: `${lines.length === 1 ? 'line' : 'lines'} ${lines.join(', ')}` };
      }),
  });

  return (
    <>
      <div className="page-head">
        <h1>Dependencies</h1>
        <p>How files import each other, where the loops are, and what starts the program.</p>
      </div>

      <section className="facts" aria-label="Import facts">
        <div className="fact"><div className="label">Project imports</div><div className="value">{fmt(r.projectImports)}</div></div>
        <div className="fact"><div className="label">Resolved</div><div className="value">{r.percentResolved}%</div></div>
        <div className="fact"><div className="label">Unresolved</div><div className="value"><Proof of={() => P.unresolved(m)}>{fmt(r.unresolved)}</Proof></div></div>
        <div className="fact"><div className="label">Cycle groups</div><div className="value"><Proof of={() => P.cycles(m)}>{fmt(s.cycleGroups.length)}</Proof></div></div>
        <div className="fact"><div className="label">Entry points</div><div className="value"><Proof of={() => P.entryPoints(m)}>{fmt(s.entryPoints.length)}</Proof></div></div>
        <div className="fact"><div className="label">Packages used</div><div className="value">{fmt(packages.length)}</div></div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Dependency cycles</h2>
            <div className="sub">Files that import each other in a loop through runtime imports, largest group first</div>
          </div>
        </div>
        {s.cycleGroups.length === 0 ? (
          <p className="empty">No dependency cycles. Every runtime import points one way.</p>
        ) : (
          <div className="list">
            {s.cycleGroups
              .map((g, gi) => ({ g, gi }))
              .sort((a, b) => b.g.files.length - a.g.files.length)
              .slice(0, 20)
              .map(({ g, gi }) => (
                <div className="list-row" key={gi} style={{ alignItems: 'flex-start' }}>
                  <span className="main">
                    <span className="codebox" style={{ display: 'block' }}>
                      {[...g.example, g.example[0]].map((f, k) => (
                        <span key={k}>
                          {k > 0 && <span className="muted"> → </span>}
                          {m.byPath.has(f) ? <a href={to.file(f)}>{f}</a> : f}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className="val" style={{ flex: 'none' }}>
                    <Proof of={() => P.cycleGroup(m, gi)}>{plural(g.files.length, 'file')}</Proof>
                  </span>
                </div>
              ))}
            {s.cycleGroups.length > 20 && <Proof of={() => P.cycles(m)}>See all {s.cycleGroups.length}</Proof>}
          </div>
        )}
      </section>

      <div className="row">
        <section className="panel grow">
          <h2>Most imported files</h2>
          <div className="sub" style={{ marginBottom: 8 }}>Changes here reach the most code directly</div>
          <div className="list">
            {mostImported.map((i) => (
              <div className="list-row" key={i}>
                <span className="main">
                  <a className="path" href={to.file(m.files[i].path)}>{m.files[i].path}</a>
                </span>
                <span className="val">
                  <Proof of={() => P.importersOf(m, i)}>{fmt(m.importers[i].size)}</Proof>
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel side">
          <h2>Packages</h2>
          <div className="sub" style={{ marginBottom: 8 }}>npm packages and Node built-ins, by number of files using them</div>
          {packages.length === 0 && <p className="empty">No package imports.</p>}
          <div className="list">
            {packages.slice(0, 15).map((p) => (
              <div className="list-row" key={p.name}>
                <span className="main"><span className="path">{p.name}</span></span>
                <span className="val"><Proof of={() => packageProof(p)}>{fmt(p.files)}</Proof></span>
              </div>
            ))}
          </div>
          {packages.length > 15 && <p className="note">and {plural(packages.length - 15, 'more package')}</p>}
        </section>
      </div>

      <div className="row">
        <section className="panel grow">
          <h2>Entry points</h2>
          <div className="sub" style={{ marginBottom: 8 }}>
            Files started by something other than an import. Add your own with an entryPoints list in tsight.config.json.
          </div>
          {reasons.length === 0 && <p className="empty">No entry points found.</p>}
          <div className="list">
            {reasons.map(([reason, n]) => (
              <div className="list-row" key={reason}>
                <span className="main">{reason}</span>
                <span className="val"><Proof of={() => P.entryPoints(m, reason)}>{fmt(n)}</Proof></span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel side">
          <h2>How imports were resolved</h2>
          <div className="sub" style={{ marginBottom: 8 }}>The same rules TypeScript uses, with these settings</div>
          <div className="list">
            <Row label="Resolved to a project file" value={fmt(r.internal)} />
            <Row label="Unresolved" value={fmt(r.unresolved)} />
            <Row label="Packages" value={fmt(r.external)} />
            <Row label="Assets (css, images, json)" value={fmt(r.asset)} />
            <Row label="Into ignored folders" value={fmt(r.excluded)} />
          </div>
          <p className="note" style={{ marginTop: 10 }}>
            tsconfig files used: {r.tsconfigs.length === 0 ? 'none, so defaults' : r.tsconfigs.slice(0, 6).join(', ') + (r.tsconfigs.length > 6 ? `, and ${r.tsconfigs.length - 6} more` : '')}
          </p>
        </section>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="list-row">
      <span className="main">{label}</span>
      <span className="val">{value}</span>
    </div>
  );
}
