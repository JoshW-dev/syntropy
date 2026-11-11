// Experiment worker: runs one world headless and returns everything the paper's figures need.

import { parentPort } from 'node:worker_threads';
import { grow, withOverrides, type Overrides } from '../src/sim/world.ts';
import { census, fingerprint, summarize, type Census, type Fingerprint, type RunSummary } from '../src/sim/score.ts';
import type { SuccessionRecord } from '../src/sim/society.ts';

export interface ExpJob {
  id: number;
  seed: string;
  ticks: number;
  overrides: Overrides;
  ablate?: Partial<Record<'tribute' | 'conflict' | 'allegiance' | 'kin' | 'attention', boolean>>;
  /** Record a time-series sample every this many ticks. */
  every: number;
}

/** Ticks between the censuses behind the fingerprint, taken over the second half of the run. */
const CENSUS_EVERY = 300;

export interface ExpSample {
  tick: number;
  pop: number;
  lattice: number;
  spawned: number;
  syntropy: number;
  organized: number;
  largestShare: number;
  depth: number;
  realms: number;
  meanMass: number;
}

export interface ExpResult {
  seed: string;
  summary: RunSummary;
  /** The society measured from outside, averaged over the second half of the run. */
  fingerprint: Fingerprint;
  levels: number[];
  samples: ExpSample[];
  successions: SuccessionRecord[];
  realmSizes: number[];
  depths: number[];
  /** Energy per cell by rank (0 = ruler), averaged at the end of the run. */
  energyByRank: number[];
  stats: Record<string, number>;
  /** How the lattice ended: when, why, how many cells dissolved, and when the last form came loose. */
  lattice: { endTick: number; why: string; period: number; dissolved: number; lastSpawnTick: number };
}

parentPort!.on('message', (job: ExpJob) => {
  const world = grow(job.seed, withOverrides(job.overrides));
  const s = world.society;
  Object.assign(s.ablate, job.ablate ?? {});
  const samples: ExpSample[] = [];
  const censuses: Census[] = [];
  const half = Math.floor(job.ticks / 2);
  let spawned = 0;
  let lastSpawnTick = -1;
  while (world.tick < job.ticks && (s.count > 0 || world.latticeActive)) {
    world.step();
    if (s.stats.spawned !== spawned) {
      spawned = s.stats.spawned;
      lastSpawnTick = world.tick;
    }
    if (world.tick === half || (world.tick > half && world.tick % CENSUS_EVERY === 0)) censuses.push(census(s));
    if (world.tick % job.every === 0) {
      const h = s.history[s.history.length - 1];
      samples.push({
        tick: world.tick,
        pop: s.count,
        lattice: world.cells.population,
        spawned: s.stats.spawned,
        syntropy: h ? h.syntropy : 0,
        organized: h && h.pop ? h.organized / h.pop : 0,
        largestShare: h && h.pop ? h.largest / h.pop : 0,
        depth: h ? h.depth : 0,
        realms: h ? h.major : 0,
        meanMass: h ? h.meanMass : 0,
      });
    }
  }
  const realmSizes = s.standingRealms().map((r) => r.size);
  const depths: number[] = [];
  const eSum: number[] = [];
  const eN: number[] = [];
  for (let i = 0; i < s.M; i++) {
    if (!s.alive[i]) continue;
    const d = s.depth[i];
    depths.push(d);
    eSum[d] = (eSum[d] ?? 0) + s.energy[i] / s.mass[i];
    eN[d] = (eN[d] ?? 0) + 1;
  }
  const energyByRank = eSum.map((v, d) => v / eN[d]);
  const result: ExpResult = {
    seed: job.seed,
    summary: summarize(s, job.seed),
    fingerprint: fingerprint(s, censuses),
    levels: [...s.levels],
    samples,
    successions: s.successions,
    realmSizes,
    depths,
    energyByRank,
    stats: { ...s.stats },
    lattice: { endTick: world.latticeEndTick, why: world.latticeEnd, period: world.latticePeriod, dissolved: world.dissolved, lastSpawnTick },
  };
  parentPort!.postMessage({ id: job.id, result });
});
parentPort!.postMessage({ ready: true });
