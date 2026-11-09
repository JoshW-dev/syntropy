// Level 1: Cells. A 3D Game of Life on a bounded lattice.
// Every live cell carries a lineage (its founding spore). A newborn cell takes the most
// common lineage among its live neighbours, so colonies keep the colour they started with.
// Connected groups of live cells that keep their place and size become "forms", and the
// forms that hold together are what the Society level turns into organisms. Once the lattice stands
// still or repeats a short cycle for long enough, nothing left on it can ever come loose (see
// `settled`), so the world ends it and the last cells dissolve.

import type { Rng } from './rng.ts';

export interface CellsParams {
  /** Lattice edge length in cells. */
  size: number;
  /** Live-neighbour counts (of 26) that keep a live cell alive. */
  survive: number[];
  /** Live-neighbour counts (of 26) that bring a dead cell to life. */
  birth: number[];
  /** Founding lineages. Each becomes a tribe later. */
  lineages: number;
  /** Small spores scattered around each lineage's homeland. */
  sporesPerLineage: number;
  /** Spore radius as a fraction of the lattice size. */
  sporeRadius: number;
  /** Fraction of cells alive inside a spore at the start. */
  sporeDensity: number;
  /** Distance of homeland centres from the lattice centre, as a fraction of half the size. */
  sporeSpread: number;
  /** Gaussian scatter of spores around their homeland, as a fraction of the lattice size. */
  homeland: number;
  /** Smallest 26-connected group that counts as a form. */
  minForm: number;
  /** Generations a form has to persist before it counts as holding together. */
  holdGens: number;
  /** Holding forms needed before the level is complete. */
  targetForms: number;
  /** The level completes after this many generations even if the target is not met. */
  maxGens: number;
}

export const DEFAULT_CELLS: CellsParams = {
  // S1-5/B7-8 won a headless search over 777 rule/density pairs (scripts/cells-search.ts):
  // noisy spores settle into 60-85 separate forms by generation 60-120, every lineage
  // survives, and the forms keep breathing (about 40 births per generation) without merging.
  size: 48,
  survive: [1, 2, 3, 4, 5],
  birth: [7, 8],
  lineages: 6,
  sporesPerLineage: 16,
  sporeRadius: 0.06,
  sporeDensity: 0.5,
  sporeSpread: 0.5,
  homeland: 0.1,
  minForm: 4,
  holdGens: 20,
  targetForms: 56,
  maxGens: 400,
};

export interface Form {
  id: number;
  cells: number;
  /** Centroid in lattice coordinates. */
  x: number;
  y: number;
  z: number;
  lineage: number;
  /** Generations this form has persisted, as far as tracking can tell. */
  age: number;
}

const TRACK_EVERY = 5;

/** Longest cycle, in generations, the lattice is checked for. Leftovers seen in testing cycled every 1, 2 or 4. */
export const PERIOD_MAX = 12;

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/**
 * Generations a lattice has to keep repeating itself with the given period before nothing on it can
 * ever come loose. Once the state repeats, the form scan sees the same sequence every
 * lcm(period, TRACK_EVERY) generations, so a form that can hold at all holds within one such cycle
 * plus holdGens, give or take a scan interval. Typical leftovers are clumps below minForm, which
 * S1-5/B7-8 keeps alive forever (each cell has one or two live neighbours, and no empty site next
 * to them reaches seven), plus a few small oscillators that never hold.
 */
export function repeatLimit(p: CellsParams, period: number): number {
  return p.holdGens + 2 * TRACK_EVERY + (period / gcd(period, TRACK_EVERY)) * TRACK_EVERY;
}

export class CellsWorld {
  readonly p: CellsParams;
  readonly G: number;
  readonly N: number;
  alive: Uint8Array;
  lineage: Uint8Array;
  /** Previous generation, kept for smooth birth/death animation. */
  prevAlive: Uint8Array;
  prevLineage: Uint8Array;
  generation = 0;
  population = 0;
  births = 0;
  deaths = 0;
  forms: Form[] = [];
  holding = 0;
  /** Shortest cycle, in generations, that the lattice is repeating right now (1 = still, 0 = none). */
  period = 0;
  /** Generations in a row that the lattice has repeated with `period`. */
  repeatGens = 0;
  /** Goes up whenever any cell changes, so a renderer knows when to rebuild. */
  version = 0;
  // Two hashes and the population of each of the last PERIOD_MAX generations, by generation % PERIOD_MAX.
  private recentA = new Int32Array(PERIOD_MAX);
  private recentB = new Int32Array(PERIOD_MAX);
  private recentPop = new Int32Array(PERIOD_MAX).fill(-1);
  /** Component label per cell from the latest form scan (-1 = none or too small). */
  formOf: Int32Array;
  sporeCenters: { x: number; y: number; z: number; lineage: number }[] = [];

  private next: Uint8Array;
  private nextLineage: Uint8Array;
  private a: Uint8Array;
  private b: Uint8Array;
  private surviveLut = new Uint8Array(27);
  private birthLut = new Uint8Array(27);
  private counts: Int32Array;
  private queue: Int32Array;
  private nextFormId = 1;
  private rng: Rng;

  constructor(params: CellsParams, rng: Rng) {
    this.p = params;
    this.rng = rng;
    this.G = params.size;
    this.N = this.G * this.G * this.G;
    this.alive = new Uint8Array(this.N);
    this.lineage = new Uint8Array(this.N);
    this.prevAlive = new Uint8Array(this.N);
    this.prevLineage = new Uint8Array(this.N);
    this.next = new Uint8Array(this.N);
    this.nextLineage = new Uint8Array(this.N);
    this.a = new Uint8Array(this.N);
    this.b = new Uint8Array(this.N);
    this.formOf = new Int32Array(this.N).fill(-1);
    this.queue = new Int32Array(this.N);
    this.counts = new Int32Array(Math.max(1, params.lineages));
    for (const n of params.survive) if (n >= 0 && n <= 26) this.surviveLut[n] = 1;
    for (const n of params.birth) if (n >= 0 && n <= 26) this.birthLut[n] = 1;
    this.seed();
  }

  /** Scatter one spore per lineage, spread evenly around the centre. */
  private seed(): void {
    const { G, p, rng } = this;
    const half = G / 2;
    const radius = p.sporeRadius * G;
    const spread = p.sporeSpread * half;
    // Fibonacci sphere directions, randomly rotated, give evenly spaced homelands.
    const rot = randomRotation(rng);
    for (let k = 0; k < p.lineages; k++) {
      const t = (k + 0.5) / p.lineages;
      const inc = Math.acos(1 - 2 * t);
      const az = Math.PI * (1 + Math.sqrt(5)) * k;
      let dx = Math.sin(inc) * Math.cos(az);
      let dy = Math.sin(inc) * Math.sin(az);
      let dz = Math.cos(inc);
      [dx, dy, dz] = applyRotation(rot, dx, dy, dz);
      const jitter = 1 + rng.range(-0.15, 0.15);
      const hx = half + dx * spread * jitter;
      const hy = half + dy * spread * jitter;
      const hz = half + dz * spread * jitter;
      this.sporeCenters.push({ x: hx, y: hy, z: hz, lineage: k });
      const scatter = p.homeland * G;
      for (let s = 0; s < p.sporesPerLineage; s++) {
        const cx = clamp(hx + rng.normal() * scatter, radius + 1, G - radius - 2);
        const cy = clamp(hy + rng.normal() * scatter, radius + 1, G - radius - 2);
        const cz = clamp(hz + rng.normal() * scatter, radius + 1, G - radius - 2);
        this.paintSpore(cx, cy, cz, radius, k);
      }
    }
    this.population = 0;
    for (let i = 0; i < this.N; i++) this.population += this.alive[i];
    this.prevAlive.set(this.alive);
    this.prevLineage.set(this.lineage);
    this.scanForms();
  }

  private paintSpore(cx: number, cy: number, cz: number, radius: number, k: number): void {
    const { G, p, rng } = this;
    const r2 = radius * radius;
    const x0 = Math.max(1, Math.floor(cx - radius));
    const x1 = Math.min(G - 2, Math.ceil(cx + radius));
    const y0 = Math.max(1, Math.floor(cy - radius));
    const y1 = Math.min(G - 2, Math.ceil(cy + radius));
    const z0 = Math.max(1, Math.floor(cz - radius));
    const z1 = Math.min(G - 2, Math.ceil(cz + radius));
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const ddx = x + 0.5 - cx;
          const ddy = y + 0.5 - cy;
          const ddz = z + 0.5 - cz;
          if (ddx * ddx + ddy * ddy + ddz * ddz > r2) continue;
          if (!rng.chance(p.sporeDensity)) continue;
          const i = x + G * (y + G * z);
          this.alive[i] = 1;
          this.lineage[i] = k;
        }
      }
    }
  }

  /** Advance one generation. */
  step(): void {
    const { G, N } = this;
    const G2 = G * G;
    const s = this.alive;
    const a = this.a;
    const b = this.b;

    // 3x3x3 box sums, done as three separable 3-tap passes (9 adds per cell instead of 26).
    for (let row = 0; row < G2; row++) {
      const base = row * G;
      let prev = 0;
      let cur = s[base];
      for (let x = 0; x < G; x++) {
        const nxt = x + 1 < G ? s[base + x + 1] : 0;
        a[base + x] = prev + cur + nxt;
        prev = cur;
        cur = nxt;
      }
    }
    for (let z = 0; z < G; z++) {
      const plane = z * G2;
      for (let y = 0; y < G; y++) {
        const row = plane + y * G;
        const up = y > 0 ? row - G : -1;
        const dn = y < G - 1 ? row + G : -1;
        for (let x = 0; x < G; x++) {
          let v = a[row + x];
          if (up >= 0) v += a[up + x];
          if (dn >= 0) v += a[dn + x];
          b[row + x] = v;
        }
      }
    }
    for (let z = 0; z < G; z++) {
      const plane = z * G2;
      const pb = z > 0 ? plane - G2 : -1;
      const pn = z < G - 1 ? plane + G2 : -1;
      for (let k = 0; k < G2; k++) {
        let v = b[plane + k];
        if (pb >= 0) v += b[pb + k];
        if (pn >= 0) v += b[pn + k];
        a[plane + k] = v;
      }
    }

    this.prevAlive.set(s);
    this.prevLineage.set(this.lineage);
    const next = this.next;
    const nextLin = this.nextLineage;
    const lin = this.lineage;
    const surv = this.surviveLut;
    const born = this.birthLut;
    let births = 0;
    let deaths = 0;
    let pop = 0;
    // Two independent hashes of which cells are alive, to spot a lattice that repeats itself.
    let ha = 0x811c9dc5;
    let hb = 0x9e3779b9;
    for (let i = 0; i < N; i++) {
      const self = s[i];
      const n = a[i] - self;
      if (self) {
        if (surv[n]) {
          next[i] = 1;
          nextLin[i] = lin[i];
          pop++;
          ha = Math.imul(ha ^ i, 0x01000193);
          hb = Math.imul(hb ^ (i + 0x7f4a7c15), 0x5bd1e995) ^ (hb >>> 13);
        } else {
          next[i] = 0;
          deaths++;
        }
      } else if (born[n]) {
        next[i] = 1;
        nextLin[i] = this.majorityLineage(i);
        births++;
        pop++;
        ha = Math.imul(ha ^ i, 0x01000193);
        hb = Math.imul(hb ^ (i + 0x7f4a7c15), 0x5bd1e995) ^ (hb >>> 13);
      } else {
        next[i] = 0;
      }
    }
    this.notePeriod(this.generation + 1, pop, ha, hb);
    this.next = s;
    this.alive = next;
    this.nextLineage = lin;
    this.lineage = nextLin;
    this.births = births;
    this.deaths = deaths;
    this.population = pop;
    this.version++;
    this.generation++;
    if (this.generation % TRACK_EVERY === 0) this.scanForms();
  }

  private majorityLineage(i: number): number {
    const { G } = this;
    const G2 = G * G;
    const x = i % G;
    const y = Math.floor(i / G) % G;
    const z = Math.floor(i / G2);
    const counts = this.counts;
    counts.fill(0);
    for (let dz = -1; dz <= 1; dz++) {
      const zz = z + dz;
      if (zz < 0 || zz >= G) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= G) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= G || (dx === 0 && dy === 0 && dz === 0)) continue;
          const j = xx + G * (yy + G * zz);
          if (this.alive[j]) counts[this.lineage[j]]++;
        }
      }
    }
    let best = 0;
    let bestCount = -1;
    let ties = 0;
    for (let k = 0; k < counts.length; k++) {
      const c = counts[k];
      if (c > bestCount) {
        best = k;
        bestCount = c;
        ties = 1;
      } else if (c === bestCount && c > 0) {
        ties++;
        if (this.rng.int(ties) === 0) best = k;
      }
    }
    return best;
  }

  /** Label 26-connected components, then match them to the previous scan to age them. */
  scanForms(): void {
    const { G, N, alive, lineage, formOf, queue } = this;
    const G2 = G * G;
    formOf.fill(-1);
    const found: Form[] = [];
    const counts = this.counts;
    const visited = this.b; // reuse scratch as a visited mask
    visited.fill(0);
    for (let start = 0; start < N; start++) {
      if (!alive[start] || visited[start]) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      visited[start] = 1;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      counts.fill(0);
      while (head < tail) {
        const i = queue[head++];
        const x = i % G;
        const y = Math.floor(i / G) % G;
        const z = Math.floor(i / G2);
        sx += x;
        sy += y;
        sz += z;
        counts[lineage[i]]++;
        for (let dz = -1; dz <= 1; dz++) {
          const zz = z + dz;
          if (zz < 0 || zz >= G) continue;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= G) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              if (xx < 0 || xx >= G) continue;
              const j = xx + G * (yy + G * zz);
              if (alive[j] && !visited[j]) {
                visited[j] = 1;
                queue[tail++] = j;
              }
            }
          }
        }
      }
      const size = tail;
      if (size < this.p.minForm) continue;
      let lin = 0;
      for (let k = 1; k < counts.length; k++) if (counts[k] > counts[lin]) lin = k;
      const label = found.length;
      for (let q = 0; q < size; q++) formOf[queue[q]] = label;
      found.push({ id: 0, cells: size, x: sx / size + 0.5, y: sy / size + 0.5, z: sz / size + 0.5, lineage: lin, age: 0 });
    }

    // Greedy nearest match against the previous scan: same place, similar size = same form.
    const prev = this.forms;
    const used = new Uint8Array(prev.length);
    const maxD2 = 2.5 * 2.5;
    for (const f of found) {
      let bestJ = -1;
      let bestD = maxD2;
      for (let j = 0; j < prev.length; j++) {
        if (used[j]) continue;
        const q = prev[j];
        const ratio = f.cells / q.cells;
        if (ratio < 0.5 || ratio > 2) continue;
        const dx = f.x - q.x;
        const dy = f.y - q.y;
        const dz = f.z - q.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD) {
          bestD = d2;
          bestJ = j;
        }
      }
      if (bestJ >= 0) {
        used[bestJ] = 1;
        f.id = prev[bestJ].id;
        f.age = prev[bestJ].age + TRACK_EVERY;
      } else {
        f.id = this.nextFormId++;
        f.age = 0;
      }
    }
    this.forms = found;
    let holding = 0;
    for (const f of found) if (f.age >= this.p.holdGens) holding++;
    this.holding = holding;
  }

  /**
   * Lift the given forms off the lattice: their cells stop following the lattice rule and are
   * returned as lattice coordinates [x, y, z, x, y, z, ...] per form label. No death animation
   * plays, because the cells live on as an organism's body.
   */
  extract(labels: Set<number>): Map<number, number[]> {
    const out = new Map<number, number[]>();
    if (labels.size === 0) return out;
    const { G, N, alive, prevAlive, formOf } = this;
    const G2 = G * G;
    let removed = 0;
    for (let i = 0; i < N; i++) {
      const l = formOf[i];
      if (l < 0 || !labels.has(l) || !alive[i]) continue;
      let list = out.get(l);
      if (!list) out.set(l, (list = []));
      list.push(i % G, Math.floor(i / G) % G, Math.floor(i / G2));
      alive[i] = 0;
      prevAlive[i] = 0;
      formOf[i] = -1;
      removed++;
    }
    this.population -= removed;
    if (removed) {
      this.version++;
      // The lattice no longer matches any state it remembers, so its cycle has to be found again.
      this.recentPop.fill(-1);
      this.period = 0;
      this.repeatGens = 0;
    }
    // Keep indices stable (formOf points into forms); an emptied form can't match the next scan.
    for (const l of labels) if (this.forms[l]) this.forms[l].cells = 0;
    return out;
  }

  /** Record generation g's hashes and check whether it repeats one of the last PERIOD_MAX generations. */
  private notePeriod(g: number, pop: number, ha: number, hb: number): void {
    let period = 0;
    for (let k = 1; k <= PERIOD_MAX && k <= g; k++) {
      const j = (g - k) % PERIOD_MAX;
      if (this.recentPop[j] === pop && this.recentA[j] === ha && this.recentB[j] === hb) {
        period = k;
        break;
      }
    }
    const slot = g % PERIOD_MAX;
    this.recentPop[slot] = pop;
    this.recentA[slot] = ha;
    this.recentB[slot] = hb;
    if (period && period === this.period) this.repeatGens++;
    else {
      this.period = period;
      this.repeatGens = period ? 1 : 0;
    }
  }

  /**
   * True once the lattice has stood still or repeated one short cycle for repeatLimit generations.
   * By then no remaining cell can ever come loose.
   */
  get settled(): boolean {
    return this.period > 0 && this.repeatGens >= repeatLimit(this.p, this.period);
  }

  /**
   * Remove every remaining cell. The state before is kept in prevAlive/prevLineage, so a renderer
   * draws them as dying. Returns how many cells dissolved.
   */
  dissolve(): number {
    const n = this.population;
    this.prevAlive.set(this.alive);
    this.prevLineage.set(this.lineage);
    this.alive.fill(0);
    this.formOf.fill(-1);
    this.forms = [];
    this.holding = 0;
    this.births = 0;
    this.deaths = n;
    this.population = 0;
    this.version++;
    return n;
  }

  get complete(): boolean {
    return this.holding >= this.p.targetForms || this.generation >= this.p.maxGens;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

type Mat3 = [number, number, number, number, number, number, number, number, number];

function randomRotation(rng: Rng): Mat3 {
  // Uniform random rotation from a random unit quaternion.
  const u1 = rng.next();
  const u2 = rng.next();
  const u3 = rng.next();
  const q0 = Math.sqrt(1 - u1) * Math.sin(2 * Math.PI * u2);
  const q1 = Math.sqrt(1 - u1) * Math.cos(2 * Math.PI * u2);
  const q2 = Math.sqrt(u1) * Math.sin(2 * Math.PI * u3);
  const q3 = Math.sqrt(u1) * Math.cos(2 * Math.PI * u3);
  return [
    1 - 2 * (q2 * q2 + q3 * q3), 2 * (q1 * q2 - q0 * q3), 2 * (q1 * q3 + q0 * q2),
    2 * (q1 * q2 + q0 * q3), 1 - 2 * (q1 * q1 + q3 * q3), 2 * (q2 * q3 - q0 * q1),
    2 * (q1 * q3 - q0 * q2), 2 * (q2 * q3 + q0 * q1), 1 - 2 * (q1 * q1 + q2 * q2),
  ];
}

function applyRotation(m: Mat3, x: number, y: number, z: number): [number, number, number] {
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
}
