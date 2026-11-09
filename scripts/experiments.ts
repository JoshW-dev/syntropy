// Every experiment in the paper, headless and seeded. Writes JSON to paper/data/.
//   node scripts/experiments.ts [--only baseline,ablations,phase,phase2,rules] [--workers 16] [--scale 1]
// --scale shrinks the number of seeds for a quick dry run (e.g. --scale 0.25).

import { availableParallelism } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Pool } from './pool.ts';
import type { ExpJob, ExpResult } from './exp-worker.ts';
import type { Overrides } from '../src/sim/world.ts';
import { CellsWorld, DEFAULT_CELLS } from '../src/sim/cells.ts';
import { makeRng } from '../src/sim/rng.ts';

const args = parseArgs(process.argv.slice(2));
const only = new Set((args.only ?? 'baseline,ablations,phase,phase2,rules').split(','));
const scale = Number(args.scale ?? 1);
const nWorkers = Number(args.workers ?? Math.max(1, availableParallelism() - 2));
const n = (k: number) => Math.max(2, Math.round(k * scale));
mkdirSync('paper/data', { recursive: true });

const pool = new Pool<Omit<ExpJob, 'id'>, ExpResult>(new URL('./exp-worker.ts', import.meta.url), nWorkers);
const t0 = performance.now();
const log = (msg: string) => console.log(`[${((performance.now() - t0) / 1000).toFixed(0)}s] ${msg}`);

async function runMany(seeds: string[], ticks: number, overrides: Overrides, ablate: ExpJob['ablate'] = {}, every = 150): Promise<ExpResult[]> {
  return Promise.all(seeds.map((seed) => pool.run({ seed, ticks, overrides, ablate, every })));
}

const strip = (r: ExpResult) => ({ seed: r.seed, levels: r.levels, summary: r.summary, stats: r.stats });

// E1. The baseline ensemble: 48 worlds for 150 years each.
if (only.has('baseline')) {
  const seeds = Array.from({ length: n(48) }, (_, i) => `b${i}`);
  const res = await runMany(seeds, 15000, {}, {}, 150);
  writeFileSync('paper/data/baseline.json', JSON.stringify(res));
  log(`baseline: ${res.length} worlds`);
}

// E2. Ablations: switch off one ingredient at a time; two controls test what the lattice passes up.
if (only.has('ablations')) {
  const conditions: { name: string; overrides?: Overrides; ablate?: ExpJob['ablate'] }[] = [
    { name: 'Full model' },
    { name: 'No tribute', ablate: { tribute: true } },
    { name: 'No conflict', ablate: { conflict: true } },
    { name: 'No kin preference', ablate: { kin: true } },
    { name: 'Food away from homelands', overrides: { homelands: false } },
    { name: 'No control loss', overrides: { society: { controlLoss: 0 } } },
    { name: 'No allegiance choice', ablate: { allegiance: true } },
    { name: 'No fear (\u03c9 = 0)', overrides: { society: { fear: 0 } } },
    { name: 'Half fear (\u03c9 = 0.5)', overrides: { society: { fear: 0.5 } } },
    { name: 'Shuffled lineages', overrides: { founders: 'shuffled' } },
    { name: 'Scattered founders', overrides: { founders: 'scattered' } },
  ];
  const seeds = Array.from({ length: n(32) }, (_, i) => `a${i}`);
  const out = [];
  for (const c of conditions) {
    const res = await runMany(seeds, 12000, c.overrides ?? {}, c.ablate ?? {}, 300);
    out.push({ name: c.name, runs: res.map(strip), samples: res.map((r) => r.samples) });
    log(`ablation "${c.name}" done`);
  }
  writeFileSync('paper/data/ablations.json', JSON.stringify(out));
}

// E3. Phase diagrams. Main: fear (weight on unallied mass) against tribute. Secondary: tribute against
// the fight rate.
if (only.has('phase')) {
  const fears = [0, 0.1, 0.2, 0.3, 0.45, 0.6, 0.8, 1, 1.4];
  const taus = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9];
  const seeds = Array.from({ length: n(10) }, (_, i) => `p${i}`);
  const grid: { fear: number; tribute: number; runs: ReturnType<typeof strip>[] }[] = [];
  const jobs: Promise<void>[] = [];
  for (const fear of fears) {
    for (const tribute of taus) {
      const cell = { fear, tribute, runs: [] as ReturnType<typeof strip>[] };
      grid.push(cell);
      jobs.push(runMany(seeds, 12000, { society: { fear, tribute } }, {}, 600).then((res) => void (cell.runs = res.map(strip))));
    }
  }
  await Promise.all(jobs);
  writeFileSync('paper/data/phase-fear.json', JSON.stringify({ fears, taus, grid }));
  log(`phase (fear x tribute): ${grid.length} cells`);
}
if (only.has('phase2')) {
  const taus = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
  const fights = [0, 0.01, 0.02, 0.04, 0.07, 0.12];
  const seeds = Array.from({ length: n(10) }, (_, i) => `p${i}`);
  const grid: { tribute: number; fightChance: number; runs: ReturnType<typeof strip>[] }[] = [];
  const jobs: Promise<void>[] = [];
  for (const tribute of taus) {
    for (const fightChance of fights) {
      const cell = { tribute, fightChance, runs: [] as ReturnType<typeof strip>[] };
      grid.push(cell);
      jobs.push(runMany(seeds, 12000, { society: { tribute, fightChance } }, {}, 600).then((res) => void (cell.runs = res.map(strip))));
    }
  }
  await Promise.all(jobs);
  writeFileSync('paper/data/phase.json', JSON.stringify({ taus, fights, grid }));
  log(`phase (tribute x fights): ${grid.length} cells`);
}

// E4. The lattice rule landscape: which birth/survival sets leave many forms that hold.
if (only.has('rules')) {
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const rngR = makeRng('paper-rules');
  const rules: { survive: number[]; birth: number[]; name: string }[] = [{ name: 'S1-5/B7-8', survive: range(1, 5), birth: [7, 8] }, { name: 'S4-5/B5 (Bays)', survive: [4, 5], birth: [5] }];
  for (let r = 0; r < 220; r++) {
    const s0 = 1 + rngR.int(12);
    const s1 = Math.min(26, s0 + rngR.int(9));
    const b0 = 3 + rngR.int(10);
    const b1 = Math.min(26, b0 + rngR.int(3));
    rules.push({ name: `S${s0}-${s1}/B${b0}-${b1}`, survive: range(s0, s1), birth: range(b0, b1) });
  }
  const out = [];
  for (const rule of rules) {
    let holding = 0;
    let fill = 0;
    let lineages = 0;
    for (const seed of ['r0', 'r1']) {
      const w = new CellsWorld({ ...DEFAULT_CELLS, size: 40, survive: rule.survive, birth: rule.birth, targetForms: 1e9 }, makeRng(seed));
      while (w.generation < 120 && w.population > 0 && w.population < w.N * 0.4) w.step();
      holding += w.holding / 2;
      fill += w.population / w.N / 2;
      lineages += new Set(w.forms.map((f) => f.lineage)).size / 2;
    }
    out.push({ name: rule.name, holding, fill, lineages });
  }
  writeFileSync('paper/data/rules.json', JSON.stringify(out));
  log(`rules: ${out.length}`);
}

pool.close();
log('done');

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
