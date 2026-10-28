import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EvidenceProvider, Proof } from './evidence';
import { buildModel, fmt, isStatic, plural, type Model, type Snapshot } from './model';
import * as P from './proofs';
import { to, useRoute, type Route } from './router';
import { Changes } from './pages/changes';
import { Dependencies } from './pages/deps';
import { File } from './pages/file';
import { Files } from './pages/files';
import { Open } from './pages/open';
import { Overview } from './pages/overview';
import { People } from './pages/people';

export type Status =
  | { state: 'idle' }
  | { state: 'analyzing'; path: string; message: string; startedAt: number }
  | { state: 'ready'; path: string; name: string; analyzedAt: string }
  | { state: 'error'; path: string; message: string };

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(() => window.__TSIGHT_SNAPSHOT__ ?? null);
  const [status, setStatus] = useState<Status | null>(isStatic() ? { state: 'ready', path: '', name: '', analyzedAt: '' } : null);
  const [version, setVersion] = useState('');
  const loadedAt = useRef<string>('');
  const route = useRoute();

  // Poll the server until an analysis is ready, then load it.
  const poll = useCallback(async () => {
    try {
      const res = await fetch('api/status');
      const body = await res.json();
      setVersion(body.version ?? '');
      const st = body.status as Status;
      setStatus(st);
      if (st.state === 'ready' && st.analyzedAt !== loadedAt.current) {
        const snap = await fetch('api/snapshot').then((r) => r.json());
        loadedAt.current = st.analyzedAt;
        setSnapshot(snap);
        if (window.location.hash === to.open) window.location.hash = to.overview;
      }
      return st.state;
    } catch {
      setStatus({ state: 'error', path: '', message: 'Cannot reach the TSight server. Is it still running?' });
      return 'error';
    }
  }, []);

  const [polling, setPolling] = useState(!isStatic());
  useEffect(() => {
    if (!polling) return;
    let stop = false;
    const tick = async () => {
      const st = await poll();
      if (stop) return;
      if (st === 'analyzing') setTimeout(tick, 600);
      else setPolling(false);
    };
    tick();
    return () => { stop = true; };
  }, [polling, poll]);

  const model = useMemo(() => (snapshot ? buildModel(snapshot) : null), [snapshot]);
  useEffect(() => {
    document.title = model ? `${model.s.project.name}: TSight` : 'TSight';
  }, [model]);

  const start = async (kind: 'path' | 'github', value: string) => {
    const url = kind === 'path' ? 'api/analyze' : 'api/analyze/github';
    const req = fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(kind === 'path' ? { path: value } : { url: value }),
    });
    setStatus({ state: 'analyzing', path: value, message: kind === 'github' ? 'Cloning' : 'Starting', startedAt: Date.now() });
    // Start polling once the server has accepted the job.
    setTimeout(() => setPolling(true), 300);
    const res = await req.catch(() => null);
    if (res && !res.ok) {
      const body = await res.json().catch(() => ({}));
      setPolling(false);
      setStatus({ state: 'error', path: value, message: body.error ?? `Request failed (${res.status})` });
    } else if (res) {
      await poll();
    }
  };

  const showOpen = !isStatic() && (route.page === 'open' || !model || status?.state === 'analyzing');

  return (
    <EvidenceProvider>
      <div className="shell">
        <a className="sr-only" href="#main">Skip to content</a>
        <TopBar m={showOpen ? null : model} route={route} />
        {!showOpen && model && <Coverage m={model} />}
        <main id="main" className="page wrap">
          {status === null ? (
            <p className="empty">Connecting…</p>
          ) : showOpen ? (
            <Open status={status} onStart={start} canCancel={!!model && status.state !== 'analyzing'} />
          ) : model ? (
            <Page m={model} route={route} />
          ) : null}
        </main>
        <footer className="footer">
          <div className="wrap">
            <span>
              <strong>TSight{version || model?.s.tool.version ? ` ${version || model?.s.tool.version}` : ''}</strong>. Facts from the code and its git
              history. No AI, no guessing.
            </span>
            {model && (
              <span>
                Analyzed {new Date(model.s.project.analyzedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} in{' '}
                {(model.s.project.durationMs / 1000).toFixed(1)} s
              </span>
            )}
          </div>
        </footer>
      </div>
    </EvidenceProvider>
  );
}

function Page({ m, route }: { m: Model; route: Route }) {
  switch (route.page) {
    case 'files': return <Files m={m} />;
    case 'file': return <File key={route.path} m={m} path={route.path} />;
    case 'deps': return <Dependencies m={m} />;
    case 'people': return <People m={m} />;
    case 'changes': return <Changes m={m} />;
    default: return <Overview m={m} />;
  }
}

const NAV: Array<[Route['page'], string, string]> = [
  ['overview', 'Overview', to.overview],
  ['files', 'Files', to.files],
  ['deps', 'Dependencies', to.deps],
  ['people', 'People', to.people],
  ['changes', 'Changes', to.changes],
];

function TopBar({ m, route }: { m: Model | null; route: Route }) {
  const current = route.page === 'file' ? 'files' : route.page;
  return (
    <header className="topbar">
      <div className="wrap">
        <a className="brand" href={to.overview}>
          <Logo />
          TSight
        </a>
        {m && (
          <span className="project">
            <span className="name">{m.s.project.name}</span>
            {m.s.git?.head && <span className="pill">{m.s.git.head.slice(0, 7)}</span>}
            {!isStatic() && <a href={to.open} style={{ fontSize: 13 }}>Change</a>}
          </span>
        )}
        {m && (
          <nav className="nav" aria-label="Main">
            {NAV.map(([page, label, href]) => (
              <a key={page} href={href} aria-current={current === page ? 'page' : undefined}>{label}</a>
            ))}
          </nav>
        )}
        {m && <Search m={m} />}
      </div>
    </header>
  );
}

function Logo() {
  // A lens over a small graph: three nodes, two edges.
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="10" cy="10" r="7" />
      <path d="M15.5 15.5 21 21" />
      <circle cx="7.5" cy="8" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="10" cy="12.5" r="1.3" fill="currentColor" stroke="none" />
      <path d="M7.5 8 10 12.5 12.5 8" strokeWidth="1.2" />
    </svg>
  );
}

function Coverage({ m }: { m: Model }) {
  const r = m.s.resolution;
  const g = m.s.git;
  return (
    <div className="coverage" role="region" aria-label="What this analysis covers">
      <div className="wrap">
        <span>
          Resolved <strong>{fmt(r.internal)}</strong> of {fmt(r.projectImports)} project imports ({r.percentResolved}%)
          {r.unresolved > 0 && (
            <>
              , <Proof of={() => P.unresolved(m)}>{fmt(r.unresolved)} unresolved</Proof>
            </>
          )}
        </span>
        <span>
          <strong>{plural(m.s.entryPoints.length, 'entry point')}</strong> found
          {(() => {
            const t = m.s.entryPoints.filter((e) => e.reason === 'test file').length;
            return t ? `, ${fmt(t)} of them tests` : '';
          })()}
        </span>
        <span className="right">
          {g ? (
            <>
              {plural(g.commits, 'commit')} read{g.shallow ? ', shallow clone so history is partial' : ''}
              {!g.renamesFollowed ? ', renames not followed' : ''}
            </>
          ) : (
            'No git history, so people and change views are empty'
          )}
        </span>
      </div>
    </div>
  );
}

function Search({ m }: { m: Model }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const scored: Array<[number, number]> = [];
    for (let i = 0; i < m.files.length; i++) {
      const path = m.files[i].path.toLowerCase();
      const at = path.indexOf(needle);
      if (at < 0) continue;
      const name = path.lastIndexOf('/') + 1;
      scored.push([i, (at >= name ? 0 : 1000) + path.length + (m.files[i].role === 'test' ? 500 : 0)]);
    }
    return scored.sort((a, b) => a[1] - b[1]).slice(0, 12).map((x) => x[0]);
  }, [q, m]);

  const go = (i: number) => {
    window.location.hash = to.file(m.files[i].path);
    setQ('');
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div className="search">
      <label htmlFor="search" className="sr-only">Find a file</label>
      <input
        id="search"
        ref={input}
        value={q}
        placeholder="Find a file"
        autoComplete="off"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="search-results"
        onChange={(e) => { setQ(e.target.value); setSel(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          if (e.key === 'Enter' && results[sel] !== undefined) go(results[sel]);
          if (e.key === 'Escape') { setQ(''); input.current?.blur(); }
        }}
      />
      <kbd>{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}</kbd>
      {open && q.trim() && (
        <div className="search-results" id="search-results" role="listbox">
          {results.length === 0 && <p className="empty" style={{ padding: '8px 10px', margin: 0 }}>No file matches.</p>}
          {results.map((i, k) => (
            <button key={i} role="option" aria-selected={k === sel} onMouseDown={(e) => e.preventDefault()} onClick={() => go(i)}>
              <span className="mono" style={{ display: 'block', overflowWrap: 'anywhere' }}>{m.files[i].path}</span>
              <span className="note">
                {plural(m.files[i].lines, 'line')}, {plural(m.importers[i].size, 'dependent')}
                {m.files[i].role === 'test' ? ', test' : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
