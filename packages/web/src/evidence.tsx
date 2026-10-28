/**
 * The evidence drawer. Any number on screen can open the list it was counted from.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export interface EvidenceItem {
  key: string;
  label: string; // usually a file path
  right?: string;
  sub?: string;
  code?: string;
  href?: string;
}

export interface Evidence {
  kind: string;
  title: string;
  definition: ReactNode;
  items: EvidenceItem[];
  empty?: string;
}

const Ctx = createContext<(e: Evidence) => void>(() => {});
export const useEvidence = () => useContext(Ctx);

const PAGE = 200;

export function EvidenceProvider({ children }: { children: ReactNode }) {
  const [ev, setEv] = useState<Evidence | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = useCallback((e: Evidence) => {
    opener.current = document.activeElement as HTMLElement | null;
    setEv(e);
  }, []);
  const close = useCallback(() => {
    setEv(null);
    opener.current?.focus?.();
  }, []);
  return (
    <Ctx.Provider value={open}>
      {children}
      {ev && <Drawer ev={ev} onClose={close} />}
    </Ctx.Provider>
  );
}

function Drawer({ ev, onClose }: { ev: Evidence; onClose: () => void }) {
  const [shown, setShown] = useState(PAGE);
  const [copied, setCopied] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && panel.current) {
        // Keep focus inside the drawer while it is open.
        const f = panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = () => {
    const text = ev.items
      .map((i) => [i.label, i.right, i.sub, i.code].filter(Boolean).join('  '))
      .join('\n');
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, () => {});
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" ref={panel}>
        <header>
          <div>
            <div className="kind">{ev.kind}</div>
            <h2 id="drawer-title">{ev.title}</h2>
          </div>
          <button className="close" onClick={onClose} ref={closeBtn} aria-label="Close">
            ×
          </button>
        </header>
        <div className="definition">{ev.definition}</div>
        <div className="items">
          {ev.items.length === 0 && <p className="empty">{ev.empty ?? 'Nothing to list.'}</p>}
          {ev.items.slice(0, shown).map((i) => (
            <div className="item" key={i.key}>
              <div className="top">
                {i.href ? (
                  <a className="mono" href={i.href} onClick={onClose}>{i.label}</a>
                ) : (
                  <span className="mono">{i.label}</span>
                )}
                {i.right && <span className="muted" style={{ flex: 'none' }}>{i.right}</span>}
              </div>
              {i.sub && <span className="muted" style={{ fontSize: 12.5 }}>{i.sub}</span>}
              {i.code && <code>{i.code}</code>}
            </div>
          ))}
          {ev.items.length > shown && (
            <div style={{ padding: '12px 8px' }}>
              <button className="btn" onClick={() => setShown((s) => s + PAGE * 5)}>
                Show {Math.min(PAGE * 5, ev.items.length - shown).toLocaleString('en-US')} more
              </button>
            </div>
          )}
        </div>
        <footer>
          <span>
            {ev.items.length.toLocaleString('en-US')} {ev.items.length === 1 ? 'item' : 'items'}
          </span>
          {ev.items.length > 0 && (
            <button className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy list'}</button>
          )}
        </footer>
      </div>
    </>
  );
}

/** A number that opens its evidence. The evidence is built only when clicked. */
export function Proof({ of, children, label }: { of: () => Evidence; children: ReactNode; label?: string }) {
  const open = useEvidence();
  return (
    <button className="proof" onClick={() => open(of())} aria-haspopup="dialog" title={label ?? 'Show where this number comes from'}>
      {children}
    </button>
  );
}
