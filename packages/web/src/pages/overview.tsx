import { useMemo, useState } from 'react';
import { Proof } from '../evidence';
import { blastLevels, buildTree, fmt, METRICS, plural, RAMP, type MetricKey, type Model } from '../model';
import * as P from '../proofs';
import { to } from '../router';
import { Treemap } from '../treemap';

export function Overview({ m }: { m: Model }) {
  const s = m.s;
  const hasGit = !!s.git;
  const [metricKey, setMetricKey] = useState<MetricKey>(hasGit ? 'hotspot' : 'complexity');
  const [folder, setFolder] = useState('');
  const metric = METRICS[metricKey];
  const tree = useMemo(() => buildTree(m), [m]);

  const ranked = useMemo(
    () =>
      m.sourceIdx
        .filter((i) => metric.value(m, i) > 0)
        .sort((a, b) => metric.value(m, b) - metric.value(m, a) || m.files[b].lines - m.files[a].lines)
        .slice(0, 12),
    [m, metric],
  );

  return (
    <>
      <div className="page-head">
        <h1>{s.project.name}</h1>
        <p>
          <Proof of={() => P.sourceFiles(m)}>{plural(s.stats.totalFiles, 'source file')}</Proof>, {fmt(s.stats.totalLines)} lines and{' '}
          {plural(s.stats.testFiles, 'test file')}
          {hasGit ? `, with ${plural(s.git!.commits, 'commit')} of history` : ''}. Underlined numbers open the list they were counted from.
        </p>
      </div>

      <section className="grid-3" aria-label="Summary">
        <RiskAnswer m={m} />
        <PeopleAnswer m={m} />
        <SafeAnswer m={m} />
      </section>

      <div className="row">
        <section className="panel grow" aria-labelledby="map-title">
          <div className="panel-head">
            <div>
              <h2 id="map-title">Codebase map</h2>
              <div className="sub">Each rectangle is a source file, sized by lines. Color shows {metric.formula}.</div>
            </div>
            <div className="seg" role="group" aria-label="Color by">
              {Object.values(METRICS).map((mt) => (
                <button
                  key={mt.key}
                  aria-pressed={mt.key === metricKey}
                  disabled={mt.needsGit && !hasGit}
                  title={mt.needsGit && !hasGit ? 'Needs git history' : undefined}
                  onClick={() => setMetricKey(mt.key)}
                >
                  {mt.label}
                </button>
              ))}
            </div>
          </div>
          <Treemap m={m} tree={tree} metric={metric} folder={folder} setFolder={setFolder} />
          <div className="legend" style={{ marginTop: 12 }}>
            {metric.legend.map((l, k) =>
              l ? (
                <span key={k}>
                  <span className="swatch" style={{ background: RAMP[k] }} />
                  {l}
                </span>
              ) : null,
            )}
          </div>
        </section>

        <section className="panel side" aria-labelledby="top-title">
          <div className="panel-head">
            <div>
              <h2 id="top-title">Highest {metric.label.toLowerCase()}</h2>
              <div className="sub">{metric.formula}</div>
            </div>
          </div>
          {ranked.length === 0 && <p className="empty">No file scores above zero.</p>}
          <div className="list">
            {ranked.map((i) => (
              <a key={i} className="list-row" href={to.file(m.files[i].path)}>
                <span className="bar" style={{ background: RAMP[metric.bucket(metric.value(m, i))] }} />
                <span className="main">
                  <span className="path">
                    {m.files[i].path.split('/').pop()} <span className="muted">{m.files[i].path.split('/').slice(0, -1).join('/')}</span>
                  </span>
                  <span className="detail">{metric.detail(m, i)}</span>
                </span>
                <span className="val">{metricKey === 'solo' ? '' : metric.show(m, i).replace(/^max /, '')}</span>
              </a>
            ))}
          </div>
        </section>
      </div>

      <section className="grid-3" aria-label="Structure">
        <div className="panel">
          <h2>Dependency cycles</h2>
          <p className="big-line">
            <Proof of={() => P.cycles(m)}>{plural(s.cycleGroups.length, 'group')}</Proof> of files import each other in a loop
            {s.cycleGroups.length > 0 && (
              <>
                , the largest with {plural(Math.max(...s.cycleGroups.map((g) => g.files.length)), 'file')}
              </>
            )}
            .
          </p>
          <p className="note">Runtime imports only. Loops through type-only or dynamic imports are left out.</p>
          <a href={to.deps}>See dependencies</a>
        </div>
        <div className="panel">
          <h2>Copied code</h2>
          <p className="big-line">
            <Proof of={() => P.copies(m)}>{plural(s.duplicates.length + s.twins.length, 'place')}</Proof> where code appears more than once
            {copyParts(m).length ? `: ${copyParts(m).join(', ')}.` : '.'}
          </p>
          <p className="note">Compared {plural(s.twinStats.functionsCompared, 'function')} of at least 80 syntax nodes.</p>
        </div>
        <div className="panel">
          <h2>Hidden coupling</h2>
          {hasGit ? (
            <>
              <p className="big-line">
                <Proof of={() => P.coupling(m, { hidden: true })}>
                  {plural(s.git!.coChanges.filter((c) => c.hidden).length, 'pair')}
                </Proof>{' '}
                of files keep changing in the same commits without importing each other.
              </p>
              <p className="note">At least 5 commits together, and 80% of the commits to the less-changed file.</p>
            </>
          ) : (
            <p className="empty">Needs git history.</p>
          )}
        </div>
      </section>
    </>
  );
}

function RiskAnswer({ m }: { m: Model }) {
  const hs = m.s.git?.changeHotspots ?? [];
  const top = hs[0];
  if (top) {
    const f = top.file;
    const reach = blastLevels(m, f).reduce((a, l) => a + l.length, 0);
    return (
      <div className="panel answer risk">
        <h2>Riskiest file to change</h2>
        <div>
          <a className="mono" href={to.file(m.files[f].path)} style={{ fontSize: 15, fontWeight: 600, overflowWrap: 'anywhere' }}>
            {m.files[f].path}
          </a>
        </div>
        <div className="formula">
          <span>{plural(top.commits, 'commit')} in 90 days × complexity {top.maxComplexity} =</span>
          <strong>
            <Proof of={() => P.hotspots(m)}>{fmt(top.score)}</Proof>
          </strong>
          {top.topFunction && <span className="muted" style={{ flexBasis: '100%', overflowWrap: 'anywhere' }}>highest in {top.topFunction}()</span>}
        </div>
        <div className="next">
          Imported by <Proof of={() => P.importersOf(m, f)}>{plural(m.importers[f].size, 'file')}</Proof>. A change to its exports can reach{' '}
          <Proof of={() => P.blastOf(m, f)}>{plural(reach, 'file')}</Proof>.
        </div>
      </div>
    );
  }
  const byCx = [...m.sourceIdx].sort((a, b) => m.files[b].maxComplexity - m.files[a].maxComplexity)[0];
  return (
    <div className="panel answer risk">
      <h2>Hardest file to follow</h2>
      {byCx === undefined ? (
        <p className="empty">No source files.</p>
      ) : (
        <>
          <div>
            <a className="mono" href={to.file(m.files[byCx].path)} style={{ fontSize: 15, fontWeight: 600, overflowWrap: 'anywhere' }}>
              {m.files[byCx].path}
            </a>
          </div>
          <div className="formula">
            <span>highest function complexity</span>
            <strong>
              <Proof of={() => P.functionsOf(m, byCx)}>{m.files[byCx].maxComplexity}</Proof>
            </strong>
            {m.files[byCx].topFunction && <span>in {m.files[byCx].topFunction}()</span>}
          </div>
          <div className="next">No git history was found, so this ranks by complexity alone. Change frequency needs the commit log.</div>
        </>
      )}
    </div>
  );
}

function PeopleAnswer({ m }: { m: Model }) {
  const g = m.s.git;
  if (!g) {
    return (
      <div className="panel answer people">
        <h2>Knowledge held by one person</h2>
        <p className="empty">No git history was found. Analyze a git checkout to see who changed what.</p>
      </div>
    );
  }
  const solo = g.windows.all.singleAuthor;
  const quiet = solo.filter((x) => m.inactive(x.author)).length;
  const byAuthor = new Map<string, number>();
  for (const x of solo) byAuthor.set(x.author, (byAuthor.get(x.author) ?? 0) + 1);
  const [lead, leadCount] = [...byAuthor].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  return (
    <div className="panel answer people">
      <h2>Knowledge held by one person</h2>
      <div className="big">
        <Proof of={() => P.soloFiles(m)}>{fmt(solo.length)}</Proof> <small>of {plural(g.windows.all.filesWithActivity, 'file')} with history</small>
      </div>
      <div className="formula">
        <span>
          Every commit came from one person. For <Proof of={() => P.soloFiles(m, 'inactive')}>{plural(quiet, 'file')}</Proof>, that person
          has no commits in the last 6 months.
        </span>
      </div>
      <div className="next">
        {lead ? (
          <>
            Most of these belong to {lead}: <Proof of={() => P.soloFiles(m, lead)}>{plural(leadCount, 'file')}</Proof>.{' '}
            <a href={to.people}>See people</a>
          </>
        ) : (
          'Every file with history has more than one author.'
        )}
      </div>
    </div>
  );
}

function SafeAnswer({ m }: { m: Model }) {
  const none = m.s.noImporters.filter((x) => !x.onlyTests).length;
  const tests = m.s.noImporters.length - none;
  return (
    <div className="panel answer safe">
      <h2>Files nothing imports</h2>
      <div className="big">
        <Proof of={() => P.noImporters(m, false)}>{fmt(none)}</Proof> <small>{none === 1 ? 'source file' : 'source files'}</small>
      </div>
      <div className="formula">
        <span>
          No import and no entry-point rule points at them. <Proof of={() => P.unresolved(m)}>{m.s.resolution.percentResolved}%</Proof> of
          project imports resolved, so check before deleting.
        </span>
      </div>
      <div className="next">
        <Proof of={() => P.noImporters(m, true)}>{plural(tests, 'more file')}</Proof> {tests === 1 ? 'is' : 'are'} only imported by tests.
      </div>
    </div>
  );
}

function copyParts(m: Model): string[] {
  const s = m.s;
  const files = s.duplicates.filter((d) => d.type === 'exact-file').length;
  const fns = s.duplicates.length - files;
  return [
    files ? plural(files, 'set of identical files', 'sets of identical files') : '',
    fns ? plural(fns, 'repeated function') : '',
    s.twins.length ? `${plural(s.twins.length, 'pair')} of functions with the same structure` : '',
  ].filter(Boolean);
}
