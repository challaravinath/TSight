/**
 * The codebase map: every source file as a rectangle sized by lines and colored by a metric.
 * Folders show their contents one level down; click a folder to go inside.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { collapse, findNode, fmt, plural, RAMP, squarify, type Metric, type Model, type Rect, type TreeNode } from './model';
import { to } from './router';

const HEADER = 20;
const GAP = 2;

export function Treemap({ m, tree, metric, folder, setFolder }: {
  m: Model;
  tree: TreeNode;
  metric: Metric;
  folder: string;
  setFolder: (path: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const top = collapse(tree);
  const node = (folder && findNode(tree, folder)) || top;
  const current = collapse(node);

  // Worst file under each folder, for coloring folders by the metric.
  const worst = useMemo(() => {
    const cache = new Map<string, number>();
    const walk = (n: TreeNode): number => {
      if (n.file !== undefined) return n.file;
      const hit = cache.get(n.path);
      if (hit !== undefined) return hit;
      let best = -1;
      for (const c of n.children) {
        const f = walk(c);
        if (f >= 0 && (best < 0 || metric.value(m, f) > metric.value(m, best))) best = f;
      }
      cache.set(n.path, best);
      return best;
    };
    return walk;
  }, [m, metric]);

  const crumbs: TreeNode[] = [];
  {
    let n: TreeNode | null = top;
    while (n) {
      crumbs.push(n);
      if (n === current) break;
      const next: TreeNode | undefined = n.children.find((c) => c.file === undefined && (current.path === c.path || current.path.startsWith(c.path + '/')));
      n = next ? collapse(next) : null;
    }
  }

  const tiles: JSX.Element[] = [];
  const layout = (n: TreeNode, r: Rect, depth: number) => {
    const kids = [...n.children].filter((c) => c.lines > 0).sort((a, b) => b.lines - a.lines);
    const rects = squarify(kids.map((k) => k.lines), r);
    kids.forEach((k, idx) => {
      const rr = rects[idx];
      if (rr.w < 3 || rr.h < 3) return;
      const isFile = k.file !== undefined;
      const f = isFile ? (k.file as number) : worst(k);
      const bucket = f >= 0 ? metric.bucket(metric.value(m, f)) : 0;
      const nested = !isFile && rr.w > 44 && rr.h > 40;
      const header = nested && rr.w > 60 && rr.h > 64 ? HEADER : 3;
      const showText = rr.w > 54 && rr.h > 24 && (!nested || header === HEADER);
      const label = isFile
        ? `${k.path}, ${plural(m.files[f].lines, 'line')}, ${metric.label.toLowerCase()}: ${metric.detail(m, f)}`
        : `${k.path}/, ${plural(k.count, 'file')}, ${fmt(k.lines)} lines${f >= 0 ? `, highest ${metric.label.toLowerCase()}: ${m.files[f].path.split('/').pop()} (${metric.show(m, f)})` : ''}`;
      const style = {
        left: rr.x, top: rr.y, width: rr.w, height: rr.h,
        background: nested ? 'var(--surface)' : RAMP[bucket],
      };
      const cls = `tile${isFile ? '' : ' folder'}${!nested && bucket >= 3 ? ' dark' : ''}${nested ? ' nest' : ''}`;
      const content = showText ? (
        <>
          <span className="t-name">{isFile ? k.name : collapse(k).path.slice(n.path ? n.path.length + 1 : 0)}</span>
          {!nested && rr.h > 44 && (
            <span className="t-val">{isFile ? metric.show(m, f) : `${plural(k.count, 'file')}`}</span>
          )}
        </>
      ) : null;
      if (isFile) {
        tiles.push(
          <a key={k.path} className={cls} style={style} href={to.file(k.path)} title={label} aria-label={label}>
            {content}
          </a>,
        );
      } else {
        tiles.push(
          <button key={k.path + '/'} className={cls} style={style} onClick={() => setFolder(k.path)} title={label} aria-label={`Open folder ${label}`}>
            {content}
          </button>,
        );
        if (nested) layout(collapse(k), { x: rr.x + GAP + 1, y: rr.y + header, w: rr.w - 2 * GAP - 2, h: rr.h - header - GAP - 1 }, depth + 1);
      }
    });
  };
  if (size.w > 0) layout(current, { x: 0, y: 0, w: size.w, h: size.h }, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <nav className="crumbs" aria-label="Folder">
        {crumbs.map((c, k) => (
          <span key={c.path} style={{ display: 'contents' }}>
            {k > 0 && <span>/</span>}
            {c === current ? (
              <strong style={{ padding: '2px 4px' }}>{crumbLabel(crumbs, k)}</strong>
            ) : (
              <button onClick={() => setFolder(c.path)}>{crumbLabel(crumbs, k)}</button>
            )}
          </span>
        ))}
        <span style={{ marginLeft: 8 }}>
          {plural(current.count, 'file')}, {fmt(current.lines)} lines
        </span>
      </nav>
      <div className="treemap" ref={box}>{tiles}</div>
    </div>
  );
}

function crumbLabel(crumbs: TreeNode[], k: number): string {
  const c = crumbs[k];
  if (k === 0) return c.path === '' ? 'all files' : c.path;
  const prev = crumbs[k - 1].path;
  return prev ? c.path.slice(prev.length + 1) : c.path;
}
