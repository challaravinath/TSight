import { useEffect, useState } from 'react';

export type Route =
  | { page: 'overview' }
  | { page: 'files' }
  | { page: 'file'; path: string }
  | { page: 'deps' }
  | { page: 'people' }
  | { page: 'changes' }
  | { page: 'open' };

const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');

export const to = {
  overview: '#/',
  files: '#/files',
  file: (path: string) => `#/file/${enc(path)}`,
  deps: '#/dependencies',
  people: '#/people',
  changes: '#/changes',
  open: '#/open',
};

export function parse(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  if (h.startsWith('file/')) {
    try {
      return { page: 'file', path: decodeURIComponent(h.slice(5)) };
    } catch {
      return { page: 'overview' };
    }
  }
  switch (h.split('?')[0]) {
    case 'files': return { page: 'files' };
    case 'dependencies': return { page: 'deps' };
    case 'people': return { page: 'people' };
    case 'changes': return { page: 'changes' };
    case 'open': return { page: 'open' };
    default: return { page: 'overview' };
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parse(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
