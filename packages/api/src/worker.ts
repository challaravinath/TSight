/**
 * Runs one analysis job off the main thread, so the server keeps
 * answering (status, the UI's files) while a large repository is read.
 */
import { parentPort, workerData } from 'worker_threads';
import { analyzeProject, readGitHistory, buildSnapshot, analyzeDiff } from '@tsight/core';

export type Job =
  | { type: 'snapshot'; path: string; name: string; version: string }
  | { type: 'diff'; path: string; base: string };

export type WorkerMessage =
  | { type: 'progress'; message: string }
  | { type: 'done'; json: string }
  | { type: 'error'; message: string };

const post = (m: WorkerMessage) => parentPort!.postMessage(m);

async function run(job: Job): Promise<void> {
  const log = (message: string) => post({ type: 'progress', message });
  if (job.type === 'snapshot') {
    const result = await analyzeProject(job.path, { log });
    log('Reading git history');
    const history = await readGitHistory(result.root).catch(() => null);
    log('Building the report');
    const snapshot = buildSnapshot(result, history, { name: job.name, version: job.version });
    post({ type: 'done', json: JSON.stringify(snapshot) });
  } else {
    const report = await analyzeDiff(job.path, { base: job.base, log });
    post({ type: 'done', json: JSON.stringify(report) });
  }
}

run(workerData as Job).catch((e: unknown) => post({ type: 'error', message: (e as Error).message ?? String(e) }));
