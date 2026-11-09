// Levels 2-5: Organisms, Tribes, Hierarchy, Government.
//
// Organisms live in a cube, eat from a food field that regrows, breed, age and die.
// Each organism may follow one other organism: its lord. Those links form trees, and a tree
// is a polity. Five local rules do everything else:
//   1. Eat & breed     : harvest food where you stand; split when rich. A newborn follows its parent.
//   2. Stay with kin   : drift toward kin; a lone organism (or a whole small polity) defers to a
//                        much stronger kin polity nearby, more readily when foreigners crowd it.
//   3. The strong take : when members of two polities touch they may fight; local numbers decide,
//                        and a decisive winner takes the loser (and everyone below it) as followers.
//   4. Tribute flows up: followers pass a share of their income to their lord, who can feed a
//                        starving follower. A lord can only manage a few direct followers, so new
//                        ones are handed down the tree (span of control), which makes ranks.
//   5. Rebels & heirs  : a follower that grows strong relative to its ruler may break away, or seize
//                        the throne. When a ruler dies, the strongest follower inherits, and the
//                        others accept the heir only if it is clearly stronger than they are.
// Nothing above mentions tribes, ranks or government. The ladder levels are measured, not scripted.

import type { Rng } from './rng.ts';
import { TRIBE_NAMES, realmName } from './names.ts';

export interface SocietyParams {
  maxN: number;
  // world and food
  foodRes: number;
  foodZones: number;
  zoneSigma: number;
  zoneSpread: number;
  foodBase: number;
  regrow: number;
  // bodies
  metabolism: number;
  harvestRate: number;
  harvestHalf: number;
  reproduceAt: number;
  lifespan: number;
  lifeSpread: number;
  sizeMutation: number;
  aggrMutation: number;
  maxSpeed: number;
  accel: number;
  damping: number;
  // senses and movement
  senseRadius: number;
  sepRadius: number;
  followDist: number;
  /** A follower settles this far below its lord, so every realm hangs from its ruler like a tree. */
  rankDrop: number;
  /** Followers of the same lord spread apart, further for bigger branches, so trees fan out. */
  sibSpread: number;
  wSpread: number;
  /** How much a follower forages on its own instead of only keeping station. */
  followerForage: number;
  wSep: number;
  wKin: number;
  wFood: number;
  wFollow: number;
  wAlign: number;
  wWander: number;
  wFlee: number;
  wChase: number;
  // conflict
  contactRadius: number;
  battleRadius: number;
  fightChance: number;
  kinPeace: number;
  gamma: number;
  decisive: number;
  damage: number;
  plunder: number;
  fightCooldown: number;
  // deference, tribute, span of control
  deferRatio: number;
  joinBase: number;
  joinThreat: number;
  span: number;
  tribute: number;
  welfareBelow: number;
  welfareGive: number;
  kappa: number;
  // rebellion and succession
  rebelRatio: number;
  rebelChance: number;
  foreignRebel: number;
  coupRatio: number;
  /** How strongly nearby foreigners suppress rebellion. */
  rebelThreat: number;
  /** How much each past succession steadies a realm against rebellion and at the next succession. */
  legitimacy: number;
  breakDist: number;
  heirRatio: number;
  inherit: number;
  checkEvery: number;
  // what counts as each ladder level
  realmMin: number;
  notableSize: number;
  tribeMin: number;
  tribeCount: number;
  hierSize: number;
  hierDepth: number;
  hierTribes: number;
  govSize: number;
  govKeep: number;
}

// Tuned by scripts/sweep.ts (sweep2, 2026-11-09). On 16 fresh seeds x 15,000 ticks every run reached
// Tribes, Hierarchy and Government (medians: year 39 and year 63), with about 10 major realms
// holding 69% of organisms and 2.3 rebellions or coups per 1,000 ticks. See tuning/best.json.
export const DEFAULT_SOCIETY: SocietyParams = {
  maxN: 1400,
  foodRes: 16,
  foodZones: 4,
  zoneSigma: 0.35,
  zoneSpread: 0.55,
  foodBase: 0.0961,
  regrow: 0.00387,
  metabolism: 0.00181,
  harvestRate: 0.00845,
  harvestHalf: 0.25,
  reproduceAt: 2,
  lifespan: 2543,
  lifeSpread: 0.25,
  sizeMutation: 0.06,
  aggrMutation: 0.06,
  maxSpeed: 0.0045,
  accel: 0.0007,
  damping: 0.9,
  senseRadius: 0.16,
  sepRadius: 0.04,
  followDist: 0.03,
  rankDrop: 0.0436,
  sibSpread: 0.0219,
  wSpread: 0.9,
  followerForage: 0.626,
  wSep: 1.2,
  wKin: 0.25,
  wFood: 1.07,
  wFollow: 1.0,
  wAlign: 0.5,
  wWander: 0.25,
  wFlee: 0.779,
  wChase: 0.767,
  contactRadius: 0.03,
  battleRadius: 0.1,
  fightChance: 0.0386,
  kinPeace: 0.13,
  gamma: 2.61,
  decisive: 1.42,
  damage: 0.191,
  plunder: 0.5,
  fightCooldown: 90,
  deferRatio: 1.7,
  joinBase: 0.0483,
  joinThreat: 0.751,
  span: 4,
  tribute: 0.241,
  welfareBelow: 0.5,
  welfareGive: 0.3,
  kappa: 1,
  rebelRatio: 1.43,
  rebelChance: 0.0406,
  foreignRebel: 2.38,
  coupRatio: 2.06,
  rebelThreat: 2.85,
  legitimacy: 0.0833,
  breakDist: 0.592,
  heirRatio: 1.93,
  inherit: 0.704,
  checkEvery: 24,
  realmMin: 5,
  notableSize: 15,
  tribeMin: 12,
  tribeCount: 3,
  hierSize: 40,
  hierDepth: 4,
  hierTribes: 2,
  govSize: 40,
  govKeep: 0.6,
};

export interface Founder {
  x: number;
  y: number;
  z: number;
  size: number;
  tribe: number;
}

export type EventKind = 'level' | 'realm' | 'conquest' | 'join' | 'rebellion' | 'coup' | 'succession' | 'fragment' | 'fall';

export interface SimEvent {
  tick: number;
  kind: EventKind;
  text: string;
  /** Ladder index (0-4) for 'level' events. */
  level?: number;
}

export interface Realm {
  id: number;
  name: string;
  tribe: number;
  founded: number;
  /** Tick the realm ended, or -1 while it stands. */
  ended: number;
  rulers: number;
  peak: number;
  size: number;
  depth: number;
  tribes: number;
  sovereign: number;
  notable: boolean;
}

export interface SocietyStats {
  births: number;
  deaths: number;
  starved: number;
  fights: number;
  conquests: number;
  joins: number;
  rebellions: number;
  coups: number;
  successions: number;
  fragmentations: number;
  maxDepth: number;
  maxRealm: number;
  popPeak: number;
}

export interface Sample {
  tick: number;
  pop: number;
  /** Realms with realmMin+ members. */
  realms: number;
  /** Realms with notableSize+ members, and how many organisms they hold. */
  major: number;
  organized: number;
  largest: number;
  depth: number;
}

/** Ladder indices. 0 = Cells, 1 = Organisms (both owned by the app), 2-4 measured here. */
export const L_TRIBES = 2;
export const L_HIERARCHY = 3;
export const L_GOVERNMENT = 4;

const NONE = -1;

export class Society {
  readonly p: SocietyParams;
  readonly M: number;
  tick = 0;
  count = 0;

  alive: Uint8Array;
  pos: Float32Array;
  prev: Float32Array;
  vel: Float32Array;
  energy: Float32Array;
  size: Float32Array;
  age: Float32Array;
  life: Float32Array;
  aggr: Float32Array;
  tribe: Uint8Array;
  uid: Int32Array;
  cooldown: Uint16Array;
  lord: Int32Array;
  firstChild: Int32Array;
  nextSib: Int32Array;
  prevSib: Int32Array;
  nChild: Int32Array;
  /** Derived at the start of every tick. */
  root: Int32Array;
  depth: Int32Array;
  subSize: Int32Array;
  subDepth: Int32Array;
  power: Float32Array;
  own: Float32Array;
  tribeMask: Uint8Array;
  threat: Float32Array;
  realmOf: Int32Array;

  readonly F: number;
  food: Float32Array;
  cap: Float32Array;
  zones: { x: number; y: number; z: number }[] = [];

  events: SimEvent[] = [];
  /** Total events ever emitted (events[] keeps only the latest few hundred). */
  emitted = 0;
  realms: Realm[] = [];
  /** Tick each ladder level was first reached, or -1. Indices 0 and 1 are set by the app. */
  levels: number[] = [-1, -1, -1, -1, -1];
  stats: SocietyStats = {
    births: 0, deaths: 0, starved: 0, fights: 0, conquests: 0, joins: 0, rebellions: 0,
    coups: 0, successions: 0, fragmentations: 0, maxDepth: 0, maxRealm: 0, popPeak: 0,
  };
  history: Sample[] = [];
  /** Roots in BFS order come first in `order`; this many of them. */
  rootCount = 0;

  private rng: Rng;
  private nameRng: Rng;
  private order: Int32Array;
  private freeStack: Int32Array;
  private freeTop = 0;
  private tribIn: Float32Array;
  private tribNext: Float32Array;
  private acc: Float32Array;
  private wander: Float32Array;
  private sqrtSub: Float32Array;
  private kids: Int32Array;
  private contactA: Int32Array;
  private contactB: Int32Array;
  private nContacts = 0;
  private nextUid = 1;
  private names = new Set<string>();
  // spatial hash
  private gN: number;
  private cell: number;
  private cellStart: Int32Array;
  private cellItems: Int32Array;
  private cellOf: Int32Array;
  private cursor: Int32Array;

  constructor(params: SocietyParams, rng: Rng, founders: Founder[]) {
    this.p = params;
    this.rng = rng;
    this.nameRng = rng.fork();
    const M = (this.M = params.maxN);
    this.alive = new Uint8Array(M);
    this.pos = new Float32Array(3 * M);
    this.prev = new Float32Array(3 * M);
    this.vel = new Float32Array(3 * M);
    this.acc = new Float32Array(3 * M);
    this.wander = new Float32Array(3 * M);
    this.sqrtSub = new Float32Array(M);
    this.energy = new Float32Array(M);
    this.size = new Float32Array(M);
    this.age = new Float32Array(M);
    this.life = new Float32Array(M);
    this.aggr = new Float32Array(M);
    this.tribe = new Uint8Array(M);
    this.uid = new Int32Array(M);
    this.cooldown = new Uint16Array(M);
    this.lord = new Int32Array(M).fill(NONE);
    this.firstChild = new Int32Array(M).fill(NONE);
    this.nextSib = new Int32Array(M).fill(NONE);
    this.prevSib = new Int32Array(M).fill(NONE);
    this.nChild = new Int32Array(M);
    this.root = new Int32Array(M).fill(NONE);
    this.depth = new Int32Array(M);
    this.subSize = new Int32Array(M);
    this.subDepth = new Int32Array(M);
    this.power = new Float32Array(M);
    this.own = new Float32Array(M);
    this.tribeMask = new Uint8Array(M);
    this.threat = new Float32Array(M);
    this.realmOf = new Int32Array(M).fill(NONE);
    this.tribIn = new Float32Array(M);
    this.tribNext = new Float32Array(M);
    this.order = new Int32Array(M);
    this.kids = new Int32Array(M);
    this.contactA = new Int32Array(M * 4);
    this.contactB = new Int32Array(M * 4);
    this.freeStack = new Int32Array(M);
    for (let i = 0; i < M; i++) this.freeStack[i] = M - 1 - i;
    this.freeTop = M;

    this.cell = params.senseRadius;
    this.gN = Math.max(1, Math.ceil(2 / this.cell));
    const nCells = this.gN * this.gN * this.gN;
    this.cellStart = new Int32Array(nCells + 1);
    this.cursor = new Int32Array(nCells);
    this.cellItems = new Int32Array(M);
    this.cellOf = new Int32Array(M);

    this.F = params.foodRes;
    this.food = new Float32Array(this.F ** 3);
    this.cap = new Float32Array(this.F ** 3);
    this.placeFood();

    for (const f of founders) {
      const i = this.alloc();
      if (i < 0) break;
      this.pos[3 * i] = clamp(f.x, -0.95, 0.95);
      this.pos[3 * i + 1] = clamp(f.y, -0.95, 0.95);
      this.pos[3 * i + 2] = clamp(f.z, -0.95, 0.95);
      this.size[i] = clamp(f.size, 0.5, 2.2);
      this.tribe[i] = f.tribe;
      this.energy[i] = this.size[i] * params.reproduceAt * rng.range(0.4, 0.8);
      this.age[i] = rng.range(0, 0.3) * params.lifespan;
      this.aggr[i] = rng.range(0.2, 0.8);
    }
    this.prev.set(this.pos);
    this.levels[0] = 0;
    this.levels[1] = 0;
    this.computeTree();
  }

  // ---------------------------------------------------------------- setup

  private placeFood(): void {
    const { p, rng, F } = this;
    const centres: { x: number; y: number; z: number; amp: number }[] = [];
    for (let k = 0; k < p.foodZones; k++) {
      let best: { x: number; y: number; z: number } | null = null;
      let bestScore = -1;
      for (let attempt = 0; attempt < 30; attempt++) {
        const v = randomUnit(rng);
        const r = p.zoneSpread * rng.range(0.7, 1.15);
        const c = { x: v[0] * r, y: v[1] * r, z: v[2] * r };
        let nearest = 9;
        for (const o of centres) nearest = Math.min(nearest, Math.hypot(c.x - o.x, c.y - o.y, c.z - o.z));
        if (nearest > bestScore) {
          bestScore = nearest;
          best = c;
        }
      }
      centres.push({ ...best!, amp: rng.range(0.75, 1) });
    }
    this.zones = centres.map(({ x, y, z }) => ({ x, y, z }));
    const inv2s2 = 1 / (2 * p.zoneSigma * p.zoneSigma);
    for (let z = 0; z < F; z++) {
      for (let y = 0; y < F; y++) {
        for (let x = 0; x < F; x++) {
          const wx = ((x + 0.5) / F) * 2 - 1;
          const wy = ((y + 0.5) / F) * 2 - 1;
          const wz = ((z + 0.5) / F) * 2 - 1;
          let c = p.foodBase;
          for (const o of centres) {
            const d2 = (wx - o.x) ** 2 + (wy - o.y) ** 2 + (wz - o.z) ** 2;
            c += o.amp * Math.exp(-d2 * inv2s2);
          }
          const i = x + F * (y + F * z);
          this.cap[i] = Math.min(1, c);
          this.food[i] = this.cap[i];
        }
      }
    }
  }

  private alloc(): number {
    if (this.freeTop === 0) return NONE;
    const i = this.freeStack[--this.freeTop];
    this.alive[i] = 1;
    this.count++;
    this.uid[i] = this.nextUid++;
    this.lord[i] = NONE;
    this.firstChild[i] = NONE;
    this.nextSib[i] = NONE;
    this.prevSib[i] = NONE;
    this.nChild[i] = 0;
    this.realmOf[i] = NONE;
    this.cooldown[i] = 0;
    this.tribIn[i] = 0;
    this.tribNext[i] = 0;
    this.vel[3 * i] = this.vel[3 * i + 1] = this.vel[3 * i + 2] = 0;
    const w = randomUnit(this.rng);
    this.wander[3 * i] = w[0];
    this.wander[3 * i + 1] = w[1];
    this.wander[3 * i + 2] = w[2];
    this.age[i] = 0;
    this.life[i] = this.p.lifespan * (1 + this.p.lifeSpread * this.rng.range(-1, 1));
    return i;
  }

  private release(i: number): void {
    this.alive[i] = 0;
    this.count--;
    this.realmOf[i] = NONE;
    this.tribIn[i] = 0;
    this.tribNext[i] = 0;
    this.freeStack[this.freeTop++] = i;
  }

  // ---------------------------------------------------------------- tree ops

  private unlink(x: number): void {
    const L = this.lord[x];
    if (L < 0) return;
    const pv = this.prevSib[x];
    const nx = this.nextSib[x];
    if (pv >= 0) this.nextSib[pv] = nx;
    else this.firstChild[L] = nx;
    if (nx >= 0) this.prevSib[nx] = pv;
    this.prevSib[x] = NONE;
    this.nextSib[x] = NONE;
    this.lord[x] = NONE;
    this.nChild[L]--;
  }

  private link(x: number, L: number): void {
    const f = this.firstChild[L];
    this.nextSib[x] = f;
    this.prevSib[x] = NONE;
    if (f >= 0) this.prevSib[f] = x;
    this.firstChild[L] = x;
    this.lord[x] = L;
    this.nChild[L]++;
  }

  /** True when a is b or one of b's superiors. */
  private isAbove(a: number, b: number): boolean {
    let k = b;
    for (let guard = 0; k >= 0 && guard < this.M; guard++) {
      if (k === a) return true;
      k = this.lord[k];
    }
    return false;
  }

  rootOf(i: number): number {
    let k = i;
    for (let guard = 0; this.lord[k] >= 0 && guard < this.M; guard++) k = this.lord[k];
    return k;
  }

  /**
   * Make x (and everyone below it) follow y. When y already manages `span` direct followers,
   * x is handed to the nearest, least-loaded of them, and so on down. Returns the new lord, or -1.
   */
  private attach(x: number, y: number): number {
    if (this.isAbove(x, y)) return NONE;
    let target = y;
    const { pos } = this;
    for (let guard = 0; this.nChild[target] >= this.p.span && guard < 64; guard++) {
      let best = NONE;
      let bestScore = Infinity;
      for (let c = this.firstChild[target]; c >= 0; c = this.nextSib[c]) {
        if (c === x) continue;
        const dx = pos[3 * c] - pos[3 * x];
        const dy = pos[3 * c + 1] - pos[3 * x + 1];
        const dz = pos[3 * c + 2] - pos[3 * x + 2];
        const score = (dx * dx + dy * dy + dz * dz + 0.0004) * (1 + 0.5 * this.nChild[c]);
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }
      if (best < 0) break;
      target = best;
    }
    this.unlink(x);
    this.link(x, target);
    return target;
  }

  // ---------------------------------------------------------------- tick

  step(): void {
    this.prev.set(this.pos);
    this.computeTree();
    if (this.tick % 30 === 0) this.survey();
    this.buildGrid();
    this.economy();
    this.moveAndMeet();
    this.resolveContacts();
    this.socialChecks();
    this.deaths();
    this.births();
    this.regrow();
    this.tick++;
  }

  private computeTree(): void {
    const { M, alive, lord, firstChild, nextSib, order, depth, root, p } = this;
    let len = 0;
    for (let i = 0; i < M; i++) {
      if (!alive[i]) continue;
      depth[i] = -1;
    }
    for (let i = 0; i < M; i++) {
      if (alive[i] && lord[i] < 0) {
        order[len++] = i;
        root[i] = i;
        depth[i] = 0;
      }
    }
    this.rootCount = len;
    for (let h = 0; h < len; h++) {
      const k = order[h];
      for (let c = firstChild[k]; c >= 0; c = nextSib[c]) {
        depth[c] = depth[k] + 1;
        root[c] = root[k];
        order[len++] = c;
      }
    }
    if (len < this.count) {
      // A cycle slipped through. Break it and start over; attach() should prevent this.
      for (let i = 0; i < M; i++) if (alive[i] && depth[i] < 0) this.unlink(i);
      this.computeTree();
      return;
    }
    const reproduce = p.reproduceAt;
    for (let h = 0; h < len; h++) {
      const i = order[h];
      const s = this.size[i];
      const e = clamp(this.energy[i] / (s * reproduce), 0, 1.5);
      const own = s * (0.6 + 0.4 * e);
      this.own[i] = own;
      this.power[i] = own;
      this.subSize[i] = 1;
      this.subDepth[i] = 0;
      this.tribeMask[i] = 1 << this.tribe[i];
    }
    const kappa = p.kappa;
    for (let h = len - 1; h >= 0; h--) {
      const i = order[h];
      const L = lord[i];
      if (L < 0) continue;
      this.subSize[L] += this.subSize[i];
      this.power[L] += kappa * this.power[i];
      if (this.subDepth[i] + 1 > this.subDepth[L]) this.subDepth[L] = this.subDepth[i] + 1;
      this.tribeMask[L] |= this.tribeMask[i];
    }
  }

  private buildGrid(): void {
    const { M, alive, pos, gN, cellStart, cellItems, cellOf, cursor } = this;
    const inv = gN / 2;
    cursor.fill(0);
    for (let i = 0; i < M; i++) {
      if (!alive[i]) continue;
      const cx = clampInt(Math.floor((pos[3 * i] + 1) * inv), 0, gN - 1);
      const cy = clampInt(Math.floor((pos[3 * i + 1] + 1) * inv), 0, gN - 1);
      const cz = clampInt(Math.floor((pos[3 * i + 2] + 1) * inv), 0, gN - 1);
      const c = cx + gN * (cy + gN * cz);
      cellOf[i] = c;
      cursor[c]++;
    }
    let acc = 0;
    for (let c = 0; c < cursor.length; c++) {
      cellStart[c] = acc;
      acc += cursor[c];
      cursor[c] = cellStart[c];
    }
    cellStart[cursor.length] = acc;
    for (let i = 0; i < M; i++) {
      if (!alive[i]) continue;
      cellItems[cursor[cellOf[i]]++] = i;
    }
  }

  private foodIndex(x: number, y: number, z: number): number {
    const F = this.F;
    const ix = clampInt(Math.floor(((x + 1) / 2) * F), 0, F - 1);
    const iy = clampInt(Math.floor(((y + 1) / 2) * F), 0, F - 1);
    const iz = clampInt(Math.floor(((z + 1) / 2) * F), 0, F - 1);
    return ix + F * (iy + F * iz);
  }

  private economy(): void {
    const { M, alive, p, pos, vel, energy, size, lord, food, tribIn, tribNext } = this;
    for (let i = 0; i < M; i++) {
      if (!alive[i]) continue;
      const c = this.foodIndex(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
      const f = food[c];
      const s = size[i];
      let intake = (p.harvestRate * s * f) / (f + p.harvestHalf);
      if (intake > f) intake = f;
      food[c] = f - intake;
      let income = intake + tribIn[i];
      const L = lord[i];
      if (L >= 0) {
        const pay = p.tribute * income;
        tribNext[L] += pay;
        income -= pay;
      }
      const vmax = p.maxSpeed / Math.sqrt(s);
      const sp2 = vel[3 * i] ** 2 + vel[3 * i + 1] ** 2 + vel[3 * i + 2] ** 2;
      energy[i] += income - p.metabolism * s * (1 + (0.6 * sp2) / (vmax * vmax));
      if (L >= 0 && energy[i] < p.welfareBelow * s) {
        const spare = energy[L] - 2 * p.welfareBelow * size[L];
        if (spare > 0) {
          const give = Math.min(spare * 0.5, p.welfareGive * s);
          energy[L] -= give;
          energy[i] += give;
        }
      }
      this.age[i] += 1;
      if (this.cooldown[i] > 0) this.cooldown[i]--;
    }
    this.tribIn = tribNext;
    this.tribNext = tribIn;
    this.tribNext.fill(0);
  }

  /** Trilinear food value and gradient at a point. Returns [value, gx, gy, gz]. */
  private foodField(x: number, y: number, z: number, out: Float32Array): void {
    const F = this.F;
    const fx = ((x + 1) / 2) * F - 0.5;
    const fy = ((y + 1) / 2) * F - 0.5;
    const fz = ((z + 1) / 2) * F - 0.5;
    const x0 = clampInt(Math.floor(fx), 0, F - 2);
    const y0 = clampInt(Math.floor(fy), 0, F - 2);
    const z0 = clampInt(Math.floor(fz), 0, F - 2);
    const tx = clamp(fx - x0, 0, 1);
    const ty = clamp(fy - y0, 0, 1);
    const tz = clamp(fz - z0, 0, 1);
    const f = this.food;
    const i000 = x0 + F * (y0 + F * z0);
    const v000 = f[i000];
    const v100 = f[i000 + 1];
    const v010 = f[i000 + F];
    const v110 = f[i000 + F + 1];
    const v001 = f[i000 + F * F];
    const v101 = f[i000 + F * F + 1];
    const v011 = f[i000 + F * F + F];
    const v111 = f[i000 + F * F + F + 1];
    const a00 = v000 + (v100 - v000) * tx;
    const a10 = v010 + (v110 - v010) * tx;
    const a01 = v001 + (v101 - v001) * tx;
    const a11 = v011 + (v111 - v011) * tx;
    const b0 = a00 + (a10 - a00) * ty;
    const b1 = a01 + (a11 - a01) * ty;
    out[0] = b0 + (b1 - b0) * tz;
    // d/dx
    const dx0 = (v100 - v000) + ((v110 - v010) - (v100 - v000)) * ty;
    const dx1 = (v101 - v001) + ((v111 - v011) - (v101 - v001)) * ty;
    out[1] = dx0 + (dx1 - dx0) * tz;
    // d/dy
    const dy0 = a10 - a00;
    const dy1 = a11 - a01;
    out[2] = dy0 + (dy1 - dy0) * tz;
    // d/dz
    out[3] = b1 - b0;
  }

  private moveAndMeet(): void {
    const { M, alive, p, pos, vel, acc, wander, root, power, tribe, lord, aggr, energy, size, rng } = this;
    const { gN, cellStart, cellItems, cellOf } = this;
    const sense2 = p.senseRadius * p.senseRadius;
    const sepR = p.sepRadius;
    const sep2 = sepR * sepR;
    const contact2 = p.contactRadius * p.contactRadius;
    const ff = new Float32Array(4);
    const sqrtSub = this.sqrtSub;
    for (let i = 0; i < M; i++) if (alive[i]) sqrtSub[i] = Math.sqrt(this.subSize[i]);
    let nContacts = 0;
    const maxContacts = this.contactA.length;
    for (let i = 0; i < M; i++) {
      if (!alive[i]) continue;
      const px = pos[3 * i];
      const py = pos[3 * i + 1];
      const pz = pos[3 * i + 2];
      const ri = root[i];
      const ti = tribe[i];
      const Pi = power[ri];
      const aggressive = aggr[ri] > 0.5;
      let sx = 0, sy = 0, sz = 0;
      let kx = 0, ky = 0, kz = 0, kn = 0;
      let fx = 0, fy = 0, fz = 0;
      let cx = 0, cy = 0, cz = 0;
      let hx = 0, hy = 0, hz = 0;
      let foreign = 0;
      let ownN = 0;
      const Li = lord[i];
      const c = cellOf[i];
      const gx = c % gN;
      const gy = Math.floor(c / gN) % gN;
      const gz = Math.floor(c / (gN * gN));
      for (let zz = Math.max(0, gz - 1); zz <= Math.min(gN - 1, gz + 1); zz++) {
        for (let yy = Math.max(0, gy - 1); yy <= Math.min(gN - 1, gy + 1); yy++) {
          for (let xx = Math.max(0, gx - 1); xx <= Math.min(gN - 1, gx + 1); xx++) {
            const cc = xx + gN * (yy + gN * zz);
            for (let k = cellStart[cc]; k < cellStart[cc + 1]; k++) {
              const j = cellItems[k];
              if (j === i) continue;
              const dx = pos[3 * j] - px;
              const dy = pos[3 * j + 1] - py;
              const dz = pos[3 * j + 2] - pz;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 > sense2) continue;
              const d = Math.sqrt(d2) + 1e-6;
              if (d2 < sep2) {
                const w = (1 - d / sepR) / d;
                sx -= dx * w;
                sy -= dy * w;
                sz -= dz * w;
              }
              if (tribe[j] === ti) {
                kx += dx;
                ky += dy;
                kz += dz;
                kn++;
              }
              if (Li >= 0 && lord[j] === Li) {
                const reach = p.sibSpread * (sqrtSub[i] + sqrtSub[j]);
                if (d < reach) {
                  const w = (1 - d / reach) / d;
                  hx -= dx * w;
                  hy -= dy * w;
                  hz -= dz * w;
                }
              }
              const rj = root[j];
              if (rj === ri) {
                ownN++;
                continue;
              }
              foreign++;
              const Pj = power[rj];
              const fall = (1 - d / p.senseRadius) / d;
              if (Pj > 1.5 * Pi) {
                fx -= dx * fall;
                fy -= dy * fall;
                fz -= dz * fall;
              } else if (aggressive && Pi > 1.5 * Pj) {
                cx += dx * fall;
                cy += dy * fall;
                cz += dz * fall;
              }
              if (j > i && d2 < contact2 && nContacts < maxContacts) {
                this.contactA[nContacts] = i;
                this.contactB[nContacts] = j;
                nContacts++;
              }
            }
          }
        }
      }
      this.threat[i] = foreign / (ownN + 1);

      // wander: a slowly turning random direction
      let wx = wander[3 * i] + rng.normal() * 0.15;
      let wy = wander[3 * i + 1] + rng.normal() * 0.15;
      let wz = wander[3 * i + 2] + rng.normal() * 0.15;
      const wl = Math.hypot(wx, wy, wz) + 1e-9;
      wx /= wl; wy /= wl; wz /= wl;
      wander[3 * i] = wx;
      wander[3 * i + 1] = wy;
      wander[3 * i + 2] = wz;

      this.foodField(px, py, pz, ff);
      const gl = Math.hypot(ff[1], ff[2], ff[3]);
      const gscale = gl > 1e-6 ? 1 / (gl + 0.5) : 0;
      const s = size[i];
      const hunger = clamp(1 - energy[i] / (s * p.reproduceAt), 0, 1);

      let ax = sx * p.wSep + hx * p.wSpread;
      let ay = sy * p.wSep + hy * p.wSpread;
      let az = sz * p.wSep + hz * p.wSpread;
      const L = lord[i];
      if (L >= 0) {
        // Aim for a spot just below the lord.
        const lx = pos[3 * L] - px;
        const ly = pos[3 * L + 1] - p.rankDrop - py;
        const lz = pos[3 * L + 2] - pz;
        const ld = Math.hypot(lx, ly, lz) + 1e-6;
        const pull = clamp((ld - p.followDist) / p.followDist, -0.5, 3) / ld;
        ax += lx * pull * p.wFollow;
        ay += ly * pull * p.wFollow;
        az += lz * pull * p.wFollow;
        const inv = 1 / (p.maxSpeed);
        ax += (vel[3 * L] - vel[3 * i]) * inv * p.wAlign;
        ay += (vel[3 * L + 1] - vel[3 * i + 1]) * inv * p.wAlign;
        az += (vel[3 * L + 2] - vel[3 * i + 2]) * inv * p.wAlign;
        const fw = p.wFood * p.followerForage * (0.5 + hunger);
        ax += ff[1] * gscale * fw + fx * p.wFlee * 0.3 + wx * p.wWander * 0.4;
        ay += ff[2] * gscale * fw + fy * p.wFlee * 0.3 + wy * p.wWander * 0.4;
        az += ff[3] * gscale * fw + fz * p.wFlee * 0.3 + wz * p.wWander * 0.4;
      } else {
        const fw = p.wFood * (0.5 + hunger);
        ax += ff[1] * gscale * fw + fx * p.wFlee + cx * p.wChase + wx * p.wWander;
        ay += ff[2] * gscale * fw + fy * p.wFlee + cy * p.wChase + wy * p.wWander;
        az += ff[3] * gscale * fw + fz * p.wFlee + cz * p.wChase + wz * p.wWander;
        if (kn > 0) {
          const kl = Math.hypot(kx, ky, kz) / kn + 1e-6;
          ax += (kx / kn / kl) * p.wKin * Math.min(1, kl / p.followDist);
          ay += (ky / kn / kl) * p.wKin * Math.min(1, kl / p.followDist);
          az += (kz / kn / kl) * p.wKin * Math.min(1, kl / p.followDist);
        }
      }
      // soft walls
      const edge = 0.86;
      if (px > edge) ax -= (px - edge) * 8; else if (px < -edge) ax -= (px + edge) * 8;
      if (py > edge) ay -= (py - edge) * 8; else if (py < -edge) ay -= (py + edge) * 8;
      if (pz > edge) az -= (pz - edge) * 8; else if (pz < -edge) az -= (pz + edge) * 8;
      acc[3 * i] = ax;
      acc[3 * i + 1] = ay;
      acc[3 * i + 2] = az;
    }
    this.nContacts = nContacts;

    for (let i = 0; i < M; i++) {
      if (!alive[i]) continue;
      const vmax = p.maxSpeed / Math.sqrt(size[i]);
      let vx = vel[3 * i] * p.damping + acc[3 * i] * p.accel;
      let vy = vel[3 * i + 1] * p.damping + acc[3 * i + 1] * p.accel;
      let vz = vel[3 * i + 2] * p.damping + acc[3 * i + 2] * p.accel;
      const sp = Math.hypot(vx, vy, vz);
      if (sp > vmax) {
        const k = vmax / sp;
        vx *= k; vy *= k; vz *= k;
      }
      vel[3 * i] = vx;
      vel[3 * i + 1] = vy;
      vel[3 * i + 2] = vz;
      pos[3 * i] = clamp(pos[3 * i] + vx, -0.98, 0.98);
      pos[3 * i + 1] = clamp(pos[3 * i + 1] + vy, -0.98, 0.98);
      pos[3 * i + 2] = clamp(pos[3 * i + 2] + vz, -0.98, 0.98);
    }
  }

  /** Sum of own power of polity `r` within battleRadius of a point (using this tick's roots). */
  private localStrength(r: number, mx: number, my: number, mz: number): number {
    const { gN, cellStart, cellItems, pos, root, own, p } = this;
    const b2 = p.battleRadius * p.battleRadius;
    const inv = gN / 2;
    const gx = clampInt(Math.floor((mx + 1) * inv), 0, gN - 1);
    const gy = clampInt(Math.floor((my + 1) * inv), 0, gN - 1);
    const gz = clampInt(Math.floor((mz + 1) * inv), 0, gN - 1);
    let sum = 0;
    for (let zz = Math.max(0, gz - 1); zz <= Math.min(gN - 1, gz + 1); zz++) {
      for (let yy = Math.max(0, gy - 1); yy <= Math.min(gN - 1, gy + 1); yy++) {
        for (let xx = Math.max(0, gx - 1); xx <= Math.min(gN - 1, gx + 1); xx++) {
          const cc = xx + gN * (yy + gN * zz);
          for (let k = cellStart[cc]; k < cellStart[cc + 1]; k++) {
            const j = cellItems[k];
            if (!this.alive[j] || root[j] !== r) continue;
            const dx = pos[3 * j] - mx;
            const dy = pos[3 * j + 1] - my;
            const dz = pos[3 * j + 2] - mz;
            if (dx * dx + dy * dy + dz * dz <= b2) sum += own[j];
          }
        }
      }
    }
    return sum;
  }

  private resolveContacts(): void {
    const { p, rng, pos, tribe, aggr, energy } = this;
    for (let n = 0; n < this.nContacts; n++) {
      const i = this.contactA[n];
      const j = this.contactB[n];
      if (!this.alive[i] || !this.alive[j]) continue;
      if (this.cooldown[i] > 0 || this.cooldown[j] > 0) continue;
      const ri = this.rootOf(i);
      const rj = this.rootOf(j);
      if (ri === rj) continue;
      const chance = p.fightChance * 0.5 * (aggr[ri] + aggr[rj]) * (tribe[i] === tribe[j] ? p.kinPeace : 1);
      if (!rng.chance(chance)) continue;
      const mx = (pos[3 * i] + pos[3 * j]) / 2;
      const my = (pos[3 * i + 1] + pos[3 * j + 1]) / 2;
      const mz = (pos[3 * i + 2] + pos[3 * j + 2]) / 2;
      const li = this.localStrength(this.root[i], mx, my, mz) + this.own[i] * 0.01;
      const lj = this.localStrength(this.root[j], mx, my, mz) + this.own[j] * 0.01;
      const gi = li ** p.gamma;
      const gj = lj ** p.gamma;
      const iWins = rng.chance(gi / (gi + gj));
      const w = iWins ? i : j;
      const l = iWins ? j : i;
      const lw = iWins ? li : lj;
      const ll = iWins ? lj : li;
      const dmg = p.damage * Math.max(0, energy[l]);
      energy[l] -= dmg;
      energy[w] += p.plunder * dmg;
      this.cooldown[i] = this.cooldown[j] = p.fightCooldown;
      this.stats.fights++;
      if (lw >= p.decisive * ll) this.conquer(w, l);
    }
  }

  private conquer(w: number, l: number): void {
    const rl = this.rootOf(l);
    const rw = this.rootOf(w);
    const loserWasRuler = this.lord[l] < 0;
    const taken = this.subSize[l];
    const realmL = this.realmOf[rl];
    const before = this.realmLabel(rl);
    const winner = this.realmLabel(rw);
    if (this.attach(l, w) < 0) return;
    this.stats.conquests++;
    if (loserWasRuler && realmL >= 0) {
      const r = this.realms[realmL];
      if (r.notable) {
        const verb = ['conquers', 'overruns', 'subdues'][r.id % 3];
        this.emit('conquest', `${winner} ${verb} ${r.name} and its ${taken}.`);
      }
      this.endRealm(realmL);
    } else if (taken >= 6 && realmL >= 0 && this.realms[realmL].notable) {
      this.emit('conquest', `${winner} takes ${taken} from ${before}.`);
    }
  }

  private socialChecks(): void {
    const { M, alive, uid, lord, p } = this;
    const t = this.tick;
    for (let i = 0; i < M; i++) {
      if (!alive[i] || (uid[i] + t) % p.checkEvery !== 0) continue;
      if (lord[i] < 0) this.consider(i);
      else this.discontent(i);
    }
  }

  /** A ruler (or loner) looks for a much stronger kin polity to join. */
  private consider(i: number): void {
    const { p, pos, tribe, root, power, gN, cellStart, cellItems, cellOf } = this;
    const need = p.deferRatio * power[i];
    const sense2 = p.senseRadius * p.senseRadius;
    let best = NONE;
    let bestP = 0;
    const c = cellOf[i];
    const gx = c % gN;
    const gy = Math.floor(c / gN) % gN;
    const gz = Math.floor(c / (gN * gN));
    for (let zz = Math.max(0, gz - 1); zz <= Math.min(gN - 1, gz + 1); zz++) {
      for (let yy = Math.max(0, gy - 1); yy <= Math.min(gN - 1, gy + 1); yy++) {
        for (let xx = Math.max(0, gx - 1); xx <= Math.min(gN - 1, gx + 1); xx++) {
          const cc = xx + gN * (yy + gN * zz);
          for (let k = cellStart[cc]; k < cellStart[cc + 1]; k++) {
            const j = cellItems[k];
            if (j === i || !this.alive[j] || tribe[j] !== tribe[i]) continue;
            const rj = root[j];
            if (rj === i || power[rj] < need) continue;
            const dx = pos[3 * j] - pos[3 * i];
            const dy = pos[3 * j + 1] - pos[3 * i + 1];
            const dz = pos[3 * j + 2] - pos[3 * i + 2];
            if (dx * dx + dy * dy + dz * dz > sense2) continue;
            if (power[j] > bestP) {
              bestP = power[j];
              best = j;
            }
          }
        }
      }
    }
    if (best < 0) return;
    const chance = p.joinBase + p.joinThreat * Math.min(1, this.threat[i]);
    if (!this.rng.chance(chance)) return;
    const realmI = this.realmOf[i];
    const host = this.realmLabel(this.rootOf(best));
    if (this.attach(i, best) < 0) return;
    this.stats.joins++;
    if (realmI >= 0) {
      const r = this.realms[realmI];
      if (r.notable) {
        const verb = ['bends the knee to', 'joins its kin in', 'submits to'][r.id % 3];
        this.emit('join', `${r.name} ${verb} ${host}.`);
      }
      this.endRealm(realmI);
    }
  }

  /** A follower weighs its strength against its ruler's. */
  private discontent(i: number): void {
    const { p, pos, lord, power, tribe } = this;
    const L = lord[i];
    const dx = pos[3 * L] - pos[3 * i];
    const dy = pos[3 * L + 1] - pos[3 * i + 1];
    const dz = pos[3 * L + 2] - pos[3 * i + 2];
    if (dx * dx + dy * dy + dz * dz > p.breakDist * p.breakDist) {
      this.unlink(i);
      return;
    }
    const r = this.rootOf(i);
    // The follower's branch against the rest of the realm.
    const ratio = power[i] / Math.max(1e-6, power[r] - power[i]);
    const s = 1 / (1 + Math.exp(-(ratio - p.rebelRatio) / 0.06));
    const foreign = tribe[i] !== tribe[r];
    const realm = this.realmOf[r];
    // Foreigners nearby rally followers around the ruler; a realm that has outlived
    // rulers before carries the weight of tradition.
    const rulers = realm >= 0 ? this.realms[realm].rulers : 1;
    const chance =
      (p.rebelChance * s * (foreign ? p.foreignRebel : 1)) /
      ((1 + p.rebelThreat * Math.min(2, this.threat[i])) * (1 + p.legitimacy * (rulers - 1)));
    if (!this.rng.chance(chance)) return;
    const realmName = realm >= 0 ? this.realms[realm].name : null;
    const notable = realm >= 0 && this.realms[realm].notable;
    if (L === r && ratio > p.coupRatio) {
      this.unlink(i);
      this.attach(r, i);
      this.stats.coups++;
      if (realm >= 0) {
        this.realmOf[i] = realm;
        this.realmOf[r] = NONE;
        const rr = this.realms[realm];
        rr.rulers++;
        rr.sovereign = i;
        if (notable) this.emit('coup', `Coup in ${realmName}: a ${TRIBE_NAMES[tribe[i]]} lord seizes the throne.`);
      }
      return;
    }
    const n = this.subSize[i];
    this.unlink(i);
    this.stats.rebellions++;
    if (notable && n >= Math.max(8, 0.1 * this.subSize[r])) {
      const who = foreign ? `${TRIBE_NAMES[tribe[i]]} subjects` : 'followers';
      this.emit('rebellion', `Rebellion: ${n} ${who} break away from ${realmName}.`);
    }
  }

  private deaths(): void {
    const { M, alive, energy, age, life } = this;
    for (let i = 0; i < M; i++) {
      if (!alive[i]) continue;
      if (energy[i] <= 0) {
        this.stats.starved++;
        this.kill(i);
      } else if (age[i] >= life[i]) {
        this.kill(i);
      }
    }
  }

  private kill(d: number): void {
    const kids = this.kids;
    let k = 0;
    for (let c = this.firstChild[d]; c >= 0; c = this.nextSib[c]) kids[k++] = c;
    const L = this.lord[d];
    for (let q = 0; q < k; q++) this.unlink(kids[q]);
    this.unlink(d);
    if (L >= 0) {
      for (let q = 0; q < k; q++) this.attach(kids[q], L);
    } else {
      this.succession(d, k);
    }
    this.stats.deaths++;
    this.release(d);
  }

  /** The ruler `d` died; its k former direct followers sit in this.kids, already detached. */
  private succession(d: number, k: number): void {
    const realmId = this.realmOf[d];
    this.realmOf[d] = NONE;
    const members = this.subSize[d] - 1;
    if (k === 0) {
      if (realmId >= 0) {
        const r = this.realms[realmId];
        if (r.notable) this.emit('fall', `${r.name} ends with its last ruler.`);
        this.endRealm(realmId);
      }
      return;
    }
    const kids = this.kids;
    let heir = kids[0];
    for (let q = 1; q < k; q++) if (this.power[kids[q]] > this.power[heir]) heir = kids[q];
    this.energy[heir] += this.p.inherit * Math.max(0, this.energy[d]);
    let kept = this.subSize[heir];
    const rulers = realmId >= 0 ? this.realms[realmId].rulers : 1;
    const needed = this.p.heirRatio / (1 + this.p.legitimacy * (rulers - 1));
    for (let q = 0; q < k; q++) {
      const c = kids[q];
      if (c === heir) continue;
      if (this.power[heir] >= needed * this.power[c]) {
        if (this.attach(c, heir) >= 0) kept += this.subSize[c];
      }
    }
    if (realmId < 0) return;
    const r = this.realms[realmId];
    const keep = kept / Math.max(1, members);
    if (keep >= this.p.govKeep) {
      this.realmOf[heir] = realmId;
      r.rulers++;
      r.sovereign = heir;
      if (members >= this.p.govSize) {
        this.stats.successions++;
        const pct = Math.round(keep * 100);
        const detail = `${r.name} outlives its ruler, and the heir keeps ${pct}% of ${members}.`;
        if (this.levels[L_GOVERNMENT] < 0 && this.levels[L_HIERARCHY] >= 0) this.reach(L_GOVERNMENT, `Government: ${detail}`);
        else this.emit('succession', detail);
      }
    } else {
      if (members >= this.p.govSize) {
        this.stats.fragmentations++;
        const pct = Math.round(keep * 100);
        this.emit('fragment', `${r.name} breaks apart when its ruler dies (the heir keeps ${pct}%).`);
      }
      this.endRealm(realmId);
    }
  }

  private births(): void {
    const { M, alive, energy, size, p, pos, vel, rng } = this;
    const firstNew = this.nextUid;
    const cap = Math.floor(p.maxN * 0.995);
    for (let i = 0; i < M; i++) {
      if (!alive[i] || this.uid[i] >= firstNew) continue;
      if (energy[i] <= p.reproduceAt * size[i] || this.count >= cap) continue;
      const j = this.alloc();
      if (j < 0) return;
      const e = energy[i] * 0.5;
      energy[i] -= e;
      energy[j] = e;
      const v = randomUnit(rng);
      pos[3 * j] = clamp(pos[3 * i] + v[0] * 0.02, -0.98, 0.98);
      pos[3 * j + 1] = clamp(pos[3 * i + 1] + v[1] * 0.02, -0.98, 0.98);
      pos[3 * j + 2] = clamp(pos[3 * i + 2] + v[2] * 0.02, -0.98, 0.98);
      this.prev[3 * j] = pos[3 * j];
      this.prev[3 * j + 1] = pos[3 * j + 1];
      this.prev[3 * j + 2] = pos[3 * j + 2];
      vel[3 * j] = vel[3 * i];
      vel[3 * j + 1] = vel[3 * i + 1];
      vel[3 * j + 2] = vel[3 * i + 2];
      size[j] = clamp(size[i] * Math.exp(rng.normal() * p.sizeMutation), 0.5, 2.2);
      this.aggr[j] = clamp(this.aggr[i] + rng.normal() * p.aggrMutation, 0, 1);
      this.tribe[j] = this.tribe[i];
      // Values for the rest of this tick, until computeTree runs again.
      this.root[j] = this.root[i];
      this.own[j] = size[j] * 0.8;
      this.power[j] = this.own[j];
      this.subSize[j] = 1;
      this.attach(j, i);
      this.stats.births++;
    }
  }

  private regrow(): void {
    const { food, cap, p } = this;
    const r = p.regrow;
    for (let c = 0; c < food.length; c++) food[c] += r * (cap[c] - food[c]);
  }

  // ---------------------------------------------------------------- measurement

  /** Every 30 ticks: found and update realms, check the ladder, record a sample. */
  private survey(): void {
    const { p, order, subSize, subDepth, tribeMask, realmOf, tribe } = this;
    let realms = 0;
    let major = 0;
    let organized = 0;
    let largest = 0;
    let deepest = 0;
    let tribesLed = 0;
    let hierarchy: { r: number; tribes: number; depth: number } | null = null;
    for (let h = 0; h < this.rootCount; h++) {
      const r = order[h];
      const size = subSize[r];
      if (size >= p.tribeMin) tribesLed++;
      if (size > largest) largest = size;
      let rid = realmOf[r];
      if (rid < 0 && size >= p.realmMin) {
        rid = this.realms.length;
        this.realms.push({
          id: rid, name: realmName(this.nameRng, this.names), tribe: tribe[r], founded: this.tick, ended: -1,
          rulers: 1, peak: size, size, depth: subDepth[r], tribes: 1, sovereign: r, notable: false,
        });
        realmOf[r] = rid;
      }
      if (rid < 0) continue;
      const realm = this.realms[rid];
      if (size < 3) {
        this.endRealm(rid);
        continue;
      }
      realms++;
      if (size >= p.notableSize) {
        major++;
        organized += size;
      }
      realm.size = size;
      realm.depth = subDepth[r];
      realm.tribes = popcount(tribeMask[r]);
      realm.sovereign = r;
      if (size > realm.peak) realm.peak = size;
      if (subDepth[r] > deepest) deepest = subDepth[r];
      if (!realm.notable && size >= p.notableSize) {
        realm.notable = true;
        const verb = ['rises', 'forms', 'takes shape'][realm.id % 3];
        this.emit('realm', `${realm.name} ${verb}: ${size} follow a ${TRIBE_NAMES[tribe[r]]} chief.`);
      }
      if (size >= p.hierSize && subDepth[r] >= p.hierDepth && realm.tribes >= p.hierTribes) {
        if (!hierarchy || size > subSize[hierarchy.r]) hierarchy = { r, tribes: realm.tribes, depth: subDepth[r] };
      }
    }
    if (tribesLed >= p.tribeCount) this.reach(L_TRIBES, `Tribes: ${tribesLed} kin groups now follow chiefs.`);
    if (hierarchy) {
      const name = this.realms[realmOf[hierarchy.r]].name;
      this.reach(L_HIERARCHY, `Hierarchy: ${name} rules ${hierarchy.tribes} tribes through ${hierarchy.depth + 1} ranks.`);
    }
    if (deepest > this.stats.maxDepth) this.stats.maxDepth = deepest;
    if (largest > this.stats.maxRealm) this.stats.maxRealm = largest;
    if (this.count > this.stats.popPeak) this.stats.popPeak = this.count;
    this.history.push({ tick: this.tick, pop: this.count, realms, major, organized, largest, depth: deepest });
  }

  private reach(level: number, text: string): void {
    if (this.levels[level] >= 0 || this.levels[level - 1] < 0) return;
    this.levels[level] = this.tick;
    this.emit('level', text, level);
  }

  private endRealm(id: number): void {
    const r = this.realms[id];
    if (r.ended >= 0) return;
    r.ended = this.tick;
    if (r.sovereign >= 0 && this.realmOf[r.sovereign] === id) this.realmOf[r.sovereign] = NONE;
  }

  private realmLabel(rootSlot: number): string {
    const rid = this.realmOf[rootSlot];
    if (rid >= 0) return this.realms[rid].name;
    return `a ${TRIBE_NAMES[this.tribe[rootSlot]]} band`;
  }

  private emit(kind: EventKind, text: string, level?: number): void {
    this.events.push({ tick: this.tick, kind, text, level });
    this.emitted++;
    if (this.events.length > 600) this.events.splice(0, 100);
  }

  /** Realms that currently stand, largest first. */
  standingRealms(): Realm[] {
    return this.realms.filter((r) => r.ended < 0).sort((a, b) => b.size - a.size);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function popcount(m: number): number {
  let n = 0;
  while (m) {
    n += m & 1;
    m >>= 1;
  }
  return n;
}

function randomUnit(rng: Rng): [number, number, number] {
  const z = rng.range(-1, 1);
  const t = rng.range(0, Math.PI * 2);
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(t), r * Math.sin(t), z];
}
