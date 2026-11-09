// One sweep worker: receives (params, seed, ticks), runs the world headless, returns a summary.

import { parentPort } from 'node:worker_threads';
import { grow, withOverrides } from '../src/sim/world.ts';
import { summarize } from '../src/sim/score.ts';

type Job = { id: number; set: number; seed: string; ticks: number; overrides: object };

parentPort!.on('message', (job: Job) => {
  const world = grow(job.seed, withOverrides(job.overrides));
  while (world.tick < job.ticks && (world.society.count > 0 || world.latticeActive)) world.step();
  parentPort!.postMessage({ id: job.id, set: job.set, summary: summarize(world.society, job.seed) });
});
parentPort!.postMessage({ ready: true });
