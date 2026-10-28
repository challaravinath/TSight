import { useEffect, useState } from 'react';
import type { Status } from '../shell';
import { to } from '../router';

export function Open({ status, onStart, canCancel }: {
  status: Status;
  onStart: (kind: 'path' | 'github', value: string) => void;
  canCancel: boolean;
}) {
  const [folder, setFolder] = useState('');
  const [repo, setRepo] = useState('');

  if (status.state === 'analyzing') return <Analyzing status={status} />;

  return (
    <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="page-head">
        <h1>Open a project</h1>
        <p>
          TSight reads the code and its git history, then shows how the files fit together. Nothing leaves this machine, and no AI is
          involved: every number links to the list it came from.
        </p>
      </div>

      {status.state === 'error' && (
        <p className="panel error" role="alert">
          Could not analyze {status.path ? <span className="mono">{status.path}</span> : 'the project'}: {status.message}
        </p>
      )}

      <form
        className="panel"
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (folder.trim()) onStart('path', folder.trim());
        }}
      >
        <div className="field">
          <label htmlFor="folder">Folder on this computer</label>
          <input id="folder" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="/home/me/projects/my-app" spellCheck={false} />
          <span className="hint">The folder with package.json or tsconfig.json. A git checkout also gets the people and change views.</span>
        </div>
        <div>
          <button className="btn primary" disabled={!folder.trim()}>Analyze folder</button>
        </div>
      </form>

      <form
        className="panel"
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (repo.trim()) onStart('github', repo.trim());
        }}
      >
        <div className="field">
          <label htmlFor="repo">Public GitHub repository</label>
          <input id="repo" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="https://github.com/owner/repo" spellCheck={false} />
          <span className="hint">Cloned into a temporary folder and removed when you open something else.</span>
        </div>
        <div>
          <button className="btn" disabled={!repo.trim()}>Clone and analyze</button>
        </div>
      </form>

      {canCancel && (
        <p>
          <a href={to.overview}>Back to the current project</a>
        </p>
      )}
    </div>
  );
}

function Analyzing({ status }: { status: Extract<Status, { state: 'analyzing' }> }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.round((now - status.startedAt) / 1000));
  return (
    <div style={{ maxWidth: 640 }} aria-live="polite">
      <div className="page-head">
        <h1>Analyzing</h1>
        <p className="mono" style={{ overflowWrap: 'anywhere' }}>{status.path}</p>
      </div>
      <div className="panel" style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="progress" aria-hidden="true"><span /></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>{status.message}</span>
          <span className="muted">{secs} s</span>
        </div>
        <p className="note" style={{ margin: 0 }}>Large projects take a minute or two. Parsing runs in the background, so this page stays responsive.</p>
      </div>
    </div>
  );
}
