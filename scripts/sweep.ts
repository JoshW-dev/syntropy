// Tune the Society with no graphics. Random search over a parameter box, then local refinement
// around the best sets, then a confirmation pass on fresh seeds. Writes tuning/best.json.
//   node scripts/sweep.ts [--sets 120] [--refine 60] [--seeds 6] [--ticks 12000]
//                         [--confirm 16] [--workers 16] [--from tuning/best.json] [--tag name]

import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_SOCIETY, type SocietyParams } from '../src/sim/society.ts';
import { makeRng, type Rng } from '../src/sim/rng.ts';
import type { RunSummary } from '../src/sim/score.ts';

type Dim = { key: keyof SocietyParams; lo: number; hi: number; log?: boolean; int?: boolean };

// The knobs the search may turn. Everything else stays at DEFAULT_SOCIETY.
const SPACE: Dim[] = [
  { key: 'fightChance', lo: 0.02, hi: 0.25, log: true },
  { key: 'kinPeace', lo: 0.05, hi: 0.6 },
  { key: 'decisive', lo: 1.15, hi: 2.5 },
  { key: 'gamma', lo: 1, hi: 3 },
  { key: 'damage', lo: 0.1, hi: 0.5 },
  { key: 'deferRatio', lo: 1.4, hi: 4 },
  { key: 'joinBase', lo: 0.01, hi: 0.25, log: true },
  { key: 'joinThreat', lo: 0, hi: 1 },
  { key: 'span', lo: 3, hi: 6, int: true },
  { key: 'tribute', lo: 0.08, hi: 0.4 },
  { key: 'rebelRatio', lo: 0.5, hi: 1.6 },
  { key: 'rebelChance', lo: 0.003, hi: 0.08, log: true },
  { key: 'foreignRebel', lo: 1, hi: 4 },
  { key: 'coupRatio', lo: 1, hi: 3 },
  { key: 'rebelThreat', lo: 0, hi: 5 },
  { key: 'legitimacy', lo: 0, hi: 1.5 },
  { key: 'heirRatio', lo: 1, hi: 2.5 },
  { key: 'inherit', lo: 0.2, hi: 0.9 },
  { key: 'lifespan', lo: 1800, hi: 3600, int: true },
  { key: 'wChase', lo: 0.1, hi: 1.4 },
  { key: 'wFlee', lo: 0.1, hi: 1.4 },
  { key: 'foodZones', lo: 3, hi: 6, int: true },
  { key: 'zoneSigma', lo: 0.22, hi: 0.45 },
  { key: 'foodBase', lo: 0.02, hi: 0.16 },
  { key: 'regrow', lo: 0.002, hi: 0.01, log: true },
  { key: 'harvestRate', lo: 0.008, hi: 0.02 },
  { key: 'metabolism', lo: 0.001, hi: 0.0025 },
  { key: 'wFood', lo: 0.3, hi: 1.4 },
  { key: 'followerForage', lo: 0.2, hi: 1 },
  { key: 'rankDrop', lo: 0.03, hi: 0.06 },
  { key: 'sibSpread', lo: 0.012, hi: 0.03 },
  { key: 'breakDist', lo: 0.3, hi: 0.7 },
];

type Params = Partial<SocietyParams>;
type SetResult = {
  set: number;
  params: Params;
  score: number;
  tribes: number;
  hier: number;
  gov: number;
  tHier: number;
  tGov: number;
  realms: number;
  organized: number;
  share: number;
  churn: number;
  dynasties: number;
  maxRealm: number;
  runs: RunSummary[];
};

const args = parseArgs(process.argv.slice(2));
const nSets = Number(args.sets ?? 120);
const nRefine = Number(args.refine ?? 60);
const nSeeds = Number(args.seeds ?? 6);
const ticks = Number(args.ticks ?? 12000);
const nConfirm = Number(args.confirm ?? 16);
const nWorkers = Number(args.workers ?? Math.max(1, availableParallelism() - 2));
const tag = args.tag ?? new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const start: Params = args.from ? (JSON.parse(readFileSync(args.from, 'utf8')).society ?? {}) : {};

const toUnit = (d: Dim, v: number) => (d.log ? Math.log(v / d.lo) / Math.log(d.hi / d.lo) : (v - d.lo) / (d.hi - d.lo));
const fromUnit = (d: Dim, u: number) => {
  const c = Math.min(1, Math.max(0, u));
  let v = d.log ? d.lo * Math.pow(d.hi / d.lo, c) : d.lo + c * (d.hi - d.lo);
  if (d.int) v = Math.round(v);
  return Number(v.toPrecision(4));
};

function fill(p: Params): Params {
  const out: Params = {};
  for (const d of SPACE) (out as Record<string, number>)[d.key] = (p[d.key] as number | undefined) ?? (DEFAULT_SOCIETY[d.key] as number);
  return out;
}
function randomSet(rng: Rng): Params {
  const out: Params = {};
  for (const d of SPACE) (out as Record<string, number>)[d.key] = fromUnit(d, rng.next());
  return out;
}
function perturb(rng: Rng, base: Params, scale: number): Params {
  const out: Params = {};
  for (const d of SPACE) {
    const u = toUnit(d, base[d.key] as number);
    (out as Record<string, number>)[d.key] = rng.chance(0.6) ? fromUnit(d, u + rng.normal() * scale) : (base[d.key] as number);
  }
  return out;
}

class Pool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: { job: object; resolve: (r: unknown) => void }[] = [];
  private pending = new Map<number, (r: unknown) => void>();
  private ready: Promise<void>;
  private nextId = 1;
  constructor(n: number) {
    const readies: Promise<void>[] = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./sweep-worker.ts', import.meta.url));
      this.workers.push(w);
      readies.push(
        new Promise((res) => {
          w.on('message', (m: { ready?: boolean; id?: number }) => {
            if (m.ready) {
              this.idle.push(w);
              res();
            } else if (m.id !== undefined) {
              this.pending.get(m.id)?.(m);
              this.pending.delete(m.id);
              this.idle.push(w);
            }
            this.pump();
          });
          w.on('error', (e) => {
            console.error('worker error', e);
            process.exit(1);
          });
        }),
      );
    }
    this.ready = Promise.all(readies).then(() => undefined);
  }
  async run<T>(job: object): Promise<T> {
    await this.ready;
    return new Promise((resolve) => {
      this.queue.push({ job, resolve: resolve as (r: unknown) => void });
      this.pump();
    });
  }
  private pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const { job, resolve } = this.queue.shift()!;
      const id = this.nextId++;
      this.pending.set(id, resolve);
      w.postMessage({ ...job, id });
    }
  }
  close() {
    for (const w of this.workers) w.terminate();
  }
}

const pool = new Pool(nWorkers);
let setCounter = 0;

async function evaluate(sets: Params[], seeds: string[], runTicks: number): Promise<SetResult[]> {
  const jobs: Promise<{ set: number; summary: RunSummary }>[] = [];
  const ids = sets.map(() => setCounter++);
  sets.forEach((params, k) => {
    for (const seed of seeds) jobs.push(pool.run({ set: ids[k], seed, ticks: runTicks, overrides: { society: params } }));
  });
  const done = await Promise.all(jobs);
  return sets.map((params, k) => {
    const runs = done.filter((d) => d.set === ids[k]).map((d) => d.summary);
    const mean = (f: (r: RunSummary) => number) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
    const median = (xs: number[]) => (xs.length ? xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] : -1);
    return {
      set: ids[k],
      params,
      score: mean((r) => r.score),
      tribes: mean((r) => (r.tTribes >= 0 ? 1 : 0)),
      hier: mean((r) => (r.tHier >= 0 ? 1 : 0)),
      gov: mean((r) => (r.tGov >= 0 ? 1 : 0)),
      tHier: median(runs.filter((r) => r.tHier >= 0).map((r) => r.tHier)),
      tGov: median(runs.filter((r) => r.tGov >= 0).map((r) => r.tGov)),
      realms: mean((r) => r.realms),
      organized: mean((r) => r.organized),
      share: mean((r) => r.largestShare),
      churn: mean((r) => r.churn),
      dynasties: mean((r) => r.dynasties),
      maxRealm: mean((r) => r.maxRealm),
      runs,
    };
  });
}

function table(rows: SetResult[], n = 10) {
  console.log('  set  score  tribes hier  gov   tHier  tGov  major  org share churn dyn  maxRealm');
  for (const r of rows.slice(0, n)) {
    console.log(
      `${String(r.set).padStart(5)} ${r.score.toFixed(2).padStart(6)}  ${pct(r.tribes)} ${pct(r.hier)} ${pct(r.gov)} ${String(r.tHier).padStart(6)} ${String(r.tGov).padStart(6)} ${r.realms.toFixed(1).padStart(6)} ${r.organized.toFixed(2).padStart(4)} ${r.share.toFixed(2).padStart(5)} ${r.churn.toFixed(1).padStart(5)} ${r.dynasties.toFixed(1).padStart(4)} ${r.maxRealm.toFixed(0).padStart(8)}`,
    );
  }
}
const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);

const t0 = performance.now();
const rng = makeRng(`sweep-${tag}`);
const searchSeeds = Array.from({ length: nSeeds }, (_, i) => `s${i}`);
console.log(`sweep ${tag}: ${nSets} random sets + ${nRefine} refinements, ${nSeeds} seeds x ${ticks} ticks, ${nWorkers} workers`);

const initial: Params[] = [fill(start)];
for (let i = 1; i < nSets; i++) initial.push(randomSet(rng));
let results = await evaluate(initial, searchSeeds, ticks);
results.sort((a, b) => b.score - a.score);
console.log(`\nrandom phase done in ${((performance.now() - t0) / 1000).toFixed(0)}s (set ${results.find((r) => r.params === initial[0])?.set} is the starting point)`);
table(results);

const rounds = 3;
for (let round = 0; round < rounds; round++) {
  const top = results.slice(0, 4);
  const scale = 0.12 / (round + 1);
  const batch: Params[] = [];
  for (let i = 0; i < Math.ceil(nRefine / rounds); i++) batch.push(perturb(rng, top[i % top.length].params, scale));
  const refined = await evaluate(batch, searchSeeds, ticks);
  results = [...results, ...refined].sort((a, b) => b.score - a.score);
  console.log(`\nrefine round ${round + 1} (scale ${scale.toFixed(3)}) done at ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  table(results, 6);
}

const confirmSeeds = Array.from({ length: nConfirm }, (_, i) => `c${i}`);
const finalists = results.slice(0, 3);
const confirmed = (await evaluate(finalists.map((f) => f.params), confirmSeeds, Math.round(ticks * 1.25))).sort((a, b) => b.score - a.score);
console.log(`\nconfirmation on ${nConfirm} fresh seeds x ${Math.round(ticks * 1.25)} ticks:`);
table(confirmed, 3);

const best = confirmed[0];
mkdirSync('tuning/runs', { recursive: true });
writeFileSync(`tuning/runs/${tag}.json`, JSON.stringify({ tag, nSets, nRefine, nSeeds, ticks, results: results.map(({ runs, ...r }) => r), confirmed }, null, 1));
writeFileSync(
  'tuning/best.json',
  JSON.stringify(
    {
      note: `sweep ${tag}: score ${best.score.toFixed(2)}, tribes ${pct(best.tribes)}, hierarchy ${pct(best.hier)}, government ${pct(best.gov)} on ${nConfirm} fresh seeds`,
      society: best.params,
    },
    null,
    2,
  ) + '\n',
);
console.log(`\nwrote tuning/best.json and tuning/runs/${tag}.json in ${((performance.now() - t0) / 1000).toFixed(0)}s`);
pool.close();

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[key] = val;
    }
  }
  return out;
}
