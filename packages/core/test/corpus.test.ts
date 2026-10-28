/**
 * Real repositories pinned to exact commits, with the numbers TSight
 * should report for them. Run with:
 *
 *   TSIGHT_CORPUS=1 npm test
 *
 * It clones each repository once into the system temp folder (about
 * 150 MB in total), so it is not part of the default test run. If you
 * change how a number is computed, run this, check the differences by
 * hand, and update the expected values in the same commit.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { analyzeProject, blastRadius } from '../src/index.js';

interface Case {
  name: string;
  url: string;
  commit: string;
  subfolder: string;
  probe: string; // a widely imported file to check blast radius on
  expected: {
    sourceFiles: number;
    testFiles: number;
    internal: number;
    projectImports: number;
    unresolved: number;
    cycleGroups: number;
    duplicates: number;
    twinPairs: number;
    probeDirect: number;
    probeTotal: number;
  };
}

const CASES: Case[] = [
  {
    name: 'taxonomy',
    url: 'https://github.com/shadcn-ui/taxonomy.git',
    commit: '298a8857c7128a0d121e7f699dfd729f23b3966d',
    subfolder: '',
    probe: 'lib/utils.ts',
    expected: { sourceFiles: 129, testFiles: 0, internal: 258, projectImports: 265, unresolved: 7, cycleGroups: 0, duplicates: 0, twinPairs: 0, probeDirect: 66, probeTotal: 85 },
  },
  {
    name: 'zod',
    url: 'https://github.com/colinhacks/zod.git',
    commit: 'afdac65e0f80c0ccf9e8909da97c411567908b57',
    subfolder: 'packages/zod/src',
    probe: 'v4/core/util.ts',
    expected: { sourceFiles: 134, testFiles: 198, internal: 769, projectImports: 769, unresolved: 0, cycleGroups: 1, duplicates: 0, twinPairs: 11, probeDirect: 84, probeTotal: 239 },
  },
  {
    name: 'excalidraw',
    url: 'https://github.com/excalidraw/excalidraw.git',
    commit: '14bb42edee3d6fee6be264e3ee78670b3b9cee79',
    subfolder: '',
    probe: 'packages/common/src/utils.ts',
    expected: { sourceFiles: 548, testFiles: 161, internal: 4272, projectImports: 4275, unresolved: 3, cycleGroups: 7, duplicates: 0, twinPairs: 5, probeDirect: 6, probeTotal: 560 },
  },
];

const enabled = process.env.TSIGHT_CORPUS === '1';
const cacheDir = path.join(os.tmpdir(), 'tsight-corpus');

function checkout(c: Case): string {
  const dir = path.join(cacheDir, `${c.name}-${c.commit.slice(0, 12)}`);
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(cacheDir, { recursive: true });
    execFileSync('git', ['clone', '--quiet', '--filter=blob:none', '--no-checkout', c.url, dir], { stdio: 'inherit' });
    execFileSync('git', ['-C', dir, 'checkout', '--quiet', c.commit], { stdio: 'inherit' });
  }
  return c.subfolder ? path.join(dir, c.subfolder) : dir;
}

describe.skipIf(!enabled)('pinned real repositories', () => {
  for (const c of CASES) {
    it(`${c.name} at ${c.commit.slice(0, 7)}`, { timeout: 600_000 }, async () => {
      const r = await analyzeProject(checkout(c));
      const br = blastRadius(r, c.probe);
      expect({
        sourceFiles: r.stats.totalFiles,
        testFiles: r.stats.testFiles,
        internal: r.resolution.internal,
        projectImports: r.resolution.projectImports,
        unresolved: r.resolution.unresolved,
        cycleGroups: r.dependencyGraph.cycleGroups.length,
        duplicates: r.duplicates.length,
        twinPairs: r.structuralTwinStats.pairsFound,
        probeDirect: br?.directImpact,
        probeTotal: br?.totalImpact,
      }).toEqual(c.expected);
    });
  }
});
