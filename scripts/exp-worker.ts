// Experiment worker: runs one world headless and returns everything the paper's figures need.

import { parentPort } from 'node:worker_threads';
import { grow, withOverrides, type Overrides } from '../src/sim/world.ts';
import { byPhase, census, fingerprint, foodHighs, lasting, lineagesAlive, summarize, waterRegions, type Census, type Fingerprint, type Lasting, type PhaseRow, type RunSummary } from '../src/sim/score.ts';
import type { SuccessionRecord } from '../src/sim/society.ts';

export interface ExpJob {
  id: number;
  seed: string;
  ticks: number;
  overrides: Overrides;
  ablate?: Partial<Record<'tribute' | 'conflict' | 'allegiance' | 'kin' | 'attention', boolean>>;
  /** Record a time-series sample every this many ticks. */
  every: number;
  /** Also measure the run by phase of the climate cycle, using the world's climatePeriod. */
  cycle?: boolean;
}

/** Censuses per climate cycle, taken from half a cycle in. */
const CENSUSES_PER_CYCLE = 20;

/**
 * A run measured against the climate cycle. `phases` averages the censuses from half a cycle in.
 * `highs` follows the groups standing at each food high to the next high, and `falls` does the
 * same from each moment food falls through its usual amount, which is near the population's peak.
 */
export interface CycleResult {
  period: number;
  swing: number;
  phases: PhaseRow[];
  highs: Lasting[];
  falls: Lasting[];
}

/** Ticks between the censuses behind the fingerprint, taken over the second half of the run. */
const CENSUS_EVERY = 300;
/** In a world with two waters, where the two organisms of each fight are this many ticks later. */
const FOLLOW_TICKS = [300, 1000];
/** A fight counts as near the edge of the murk within this distance of it. */
const NEAR_EDGE = 0.3;

/**
 * Where fighters went. Of the organisms that fought in `from` water and won or lost, `n` were
 * followed for `after` ticks, `alive` were still alive then and `crossed` of those sat in the other
 * water. `near` keeps only fights within NEAR_EDGE of the murk's edge.
 */
export interface Crossing {
  after: number;
  from: 'murky' | 'clear';
  lost: boolean;
  near: boolean;
  n: number;
  alive: number;
  crossed: number;
}

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
  /** The same for each part of a world with two waters, and empty otherwise. */
  regions: { name: string; fingerprint: Fingerprint }[];
  /** In a world with two waters: which water winners and losers of fights sat in later. */
  crossings: Crossing[];
  /** The run by phase of the climate cycle, when the job asked for it. */
  cycle?: CycleResult;
  /** Lineages with an organism alive at the end. */
  lineages: number;
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
  const regions = waterRegions(s).map((r) => ({ ...r, censuses: [] as Census[] }));
  const half = Math.floor(job.ticks / 2);
  const period = s.p.climatePeriod;
  const cycleEvery = Math.max(1, Math.round(period / CENSUSES_PER_CYCLE));
  const cycleCensuses: Census[] = [];
  // Follow both organisms of every fight, so losers can be compared with winners from the same place.
  const tally = new Map<string, Crossing>();
  const due: { tick: number; slot: number; uid: number; lost: boolean; near: boolean; murky: boolean }[][] = FOLLOW_TICKS.map(() => []);
  const count = (after: number, murky: boolean, lost: boolean, near: boolean): Crossing => {
    const key = `${after}|${murky}|${lost}|${near}`;
    let c = tally.get(key);
    if (!c) tally.set(key, (c = { after, from: murky ? 'murky' : 'clear', lost, near, n: 0, alive: 0, crossed: 0 }));
    return c;
  };
  if (regions.length) {
    s.onFight = (winner, loser) => {
      for (const [slot, lost] of [[winner, false], [loser, true]] as [number, boolean][]) {
        const x = s.pos[3 * slot];
        const y = s.pos[3 * slot + 1];
        const z = s.pos[3 * slot + 2];
        const murky = s.murkyAt(x, y, z);
        const near = s.murkEdge(x, y, z) < NEAR_EDGE;
        FOLLOW_TICKS.forEach((after, q) => due[q].push({ tick: s.tick + after, slot, uid: s.uid[slot], lost, near, murky }));
      }
    };
  }
  const settle = () => {
    FOLLOW_TICKS.forEach((after, q) => {
      const list = due[q];
      while (list.length && list[0].tick <= s.tick) {
        const f = list.shift()!;
        const alive = !!s.alive[f.slot] && s.uid[f.slot] === f.uid;
        const crossed = alive && s.murkyAt(s.pos[3 * f.slot], s.pos[3 * f.slot + 1], s.pos[3 * f.slot + 2]) !== f.murky;
        for (const c of f.near ? [count(after, f.murky, f.lost, false), count(after, f.murky, f.lost, true)] : [count(after, f.murky, f.lost, false)]) {
          c.n++;
          if (alive) c.alive++;
          if (crossed) c.crossed++;
        }
      }
    });
  };
  let spawned = 0;
  let lastSpawnTick = -1;
  while (world.tick < job.ticks && (s.count > 0 || world.latticeActive)) {
    world.step();
    if (s.stats.spawned !== spawned) {
      spawned = s.stats.spawned;
      lastSpawnTick = world.tick;
    }
    if (regions.length) settle();
    if (world.tick === half || (world.tick > half && world.tick % CENSUS_EVERY === 0)) {
      censuses.push(census(s));
      for (const r of regions) r.censuses.push(census(s, r.has));
    }
    if (job.cycle && world.tick >= period / 2 && world.tick % cycleEvery === 0) cycleCensuses.push(census(s));
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
  // Each food high with a full cycle after it, and the same for each fall through the usual amount.
  const pairs = (starts: number[]): Lasting[] => starts.filter((t) => t + period <= s.tick).map((t) => lasting(s, t, t + period));
  const cycle: CycleResult | undefined = job.cycle
    ? {
        period,
        swing: s.p.climateSwing,
        phases: byPhase(cycleCensuses, period),
        highs: pairs(foodHighs(period, 0, s.tick)),
        falls: pairs(foodHighs(period, 0, s.tick).map((t) => t + period / 4)),
      }
    : undefined;
  const result: ExpResult = {
    seed: job.seed,
    summary: summarize(s, job.seed),
    fingerprint: fingerprint(s, censuses),
    regions: regions.map((r) => ({ name: r.name, fingerprint: fingerprint(s, r.censuses, r.has) })),
    // A fight too late in the run to follow for the full time is not counted.
    crossings: [...tally.values()],
    cycle,
    lineages: lineagesAlive(s),
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
