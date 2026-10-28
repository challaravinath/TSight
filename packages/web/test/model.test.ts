import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyzeProject, buildSnapshot } from '@tsight/core';
import { blastLevels, buildModel, buildTree, collapse, findNode, METRICS, squarify } from '../src/model';
import { parse, to } from '../src/router';

function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsight-web-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

describe('squarify', () => {
  it('fills the box exactly, with every rectangle inside it', () => {
    const values = [500, 300, 120, 80, 40, 20, 10, 5, 1];
    const box = { x: 10, y: 20, w: 640, h: 360 };
    const rects = squarify(values, box);
    const total = values.reduce((a, b) => a + b, 0);
    let area = 0;
    rects.forEach((r, i) => {
      area += r.w * r.h;
      expect(r.w * r.h).toBeCloseTo((values[i] / total) * box.w * box.h, 4);
      expect(r.x).toBeGreaterThanOrEqual(box.x - 1e-6);
      expect(r.y).toBeGreaterThanOrEqual(box.y - 1e-6);
      expect(r.x + r.w).toBeLessThanOrEqual(box.x + box.w + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(box.y + box.h + 1e-6);
    });
    expect(area).toBeCloseTo(box.w * box.h, 3);
  });

  it('handles empty and zero input', () => {
    expect(squarify([], { x: 0, y: 0, w: 10, h: 10 })).toEqual([]);
    expect(squarify([0, 0], { x: 0, y: 0, w: 10, h: 10 }).every((r) => r.w === 0)).toBe(true);
  });
});

describe('model', () => {
  it('derives importers, reach and the folder tree from a snapshot', async () => {
    const root = project({
      'src/core/base.ts': 'export const base = 1;\n',
      'src/core/mid.ts': "import { base } from './base';\nexport const mid = base;\n",
      'src/app/top.ts': "import { mid } from '../core/mid';\nexport const top = mid;\n",
      'src/app/top.test.ts': "import { top } from './top';\ntop;\n",
    });
    const snap = buildSnapshot(await analyzeProject(root), null, { name: 'demo' });
    const m = buildModel(snap);
    const i = (p: string) => m.byPath.get(p)!;

    expect([...m.importers[i('src/core/base.ts')]].map((f) => m.files[f].path)).toEqual(['src/core/mid.ts']);
    expect(blastLevels(m, i('src/core/base.ts')).map((l) => l.map((f) => m.files[f].path))).toEqual([
      ['src/core/mid.ts'],
      ['src/app/top.ts'],
      ['src/app/top.test.ts'],
    ]);
    expect(METRICS.dependents.value(m, i('src/app/top.ts'))).toBe(1);

    const tree = buildTree(m);
    expect(tree.count).toBe(3); // source files only
    expect(collapse(tree).path).toBe('src');
    expect(findNode(tree, 'src/core')?.children.map((c) => c.name).sort()).toEqual(['base.ts', 'mid.ts']);
  });

  it('marks an author inactive after 6 months without commits', () => {
    const snap = {
      project: { analyzedAt: '2026-10-28T00:00:00Z' },
      files: [], imports: [], functions: [], cycleGroups: [],
      git: { files: [], changeHotspots: [], coChanges: [], windows: { all: { singleAuthor: [] } }, authorLastActive: { old: '2026-04-01', recent: '2026-05-01' } },
    } as never;
    const m = buildModel(snap);
    expect(m.inactive('old')).toBe(true);
    expect(m.inactive('recent')).toBe(false);
    expect(m.inactive('nobody')).toBe(true);
  });
});

describe('router', () => {
  it('round-trips file paths with unusual characters', () => {
    const p = 'src/[id]/page #1.tsx';
    expect(parse(to.file(p))).toEqual({ page: 'file', path: p });
    expect(parse('#/dependencies')).toEqual({ page: 'deps' });
    expect(parse('#/nope')).toEqual({ page: 'overview' });
    expect(parse('#/file/%E0%A4%A')).toEqual({ page: 'overview' });
  });
});
