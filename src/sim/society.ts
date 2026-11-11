// Organisms, polities and one allegiance rule.
//
// An organism is a body of lattice cells that held its shape and came loose (see world.ts). Its mass
// is its cell count. It eats from a regrowing food field at a rate that scales with mass^0.75
// (Kleiber's law), pays a basal cost on the same scale, builds a new cell when it has surplus energy,
// burns a cell when it starves, divides by fission when it reaches splitMass, and dies of age.
//
// Each organism may follow one other organism (its lord). Those links form trees, and a tree is a
// polity. The model has exactly three social mechanisms, all local:
//   1. Conflict  : members of different polities that touch may fight. The outcome follows a Tullock
//                  contest between the local masses of the two sides; the loser loses cells to the
//                  winner, which eats them.
//   2. Tribute   : a follower passes a fraction of its income to its lord, so income cascades upward.
//   3. Allegiance: every so often, and right after losing a fight, an organism chooses whom to
//                  follow, or no one, by one rule: maximise the log-odds of prevailing locally (allied
//                  mass against unallied mass within its perception radius) minus the log-cost of
//                  tribute, a small attention cost per direct follower of the candidate lord, and a
//                  distance cost. Kin discount tribute by relatedness and threaten one another less.
// No rule mentions tribes, chiefs, ranks, conquest, rebellion, heirs or government. Joining, conquest,
// secession and succession all come out of rule 3, and the ladder levels are measured in survey()
// and resolveSuccessions().

import type { Rng } from './rng.ts';
import { TRIBE_NAMES, groupName } from './names.ts';

/** Most cells one body can hold. */
export const MAXB = 32;

/**
 * Where food can grow (see placeFood). Every map is built from the same six centres:
 *   zones   : a wide fertile zone at each centre over a thin base. The model the paper measured.
 *   plain   : the zones' food spread evenly over every cell.
 *   islands : zones at half the width over nearly bare water, holding the zones' total food.
 *   halves  : the zones, with 0.4 times the food where x < 0 and 1.6 times where x >= 0.
 */
export type FoodMap = 'zones' | 'plain' | 'islands' | 'halves';
export const FOOD_MAPS: readonly FoodMap[] = ['zones', 'plain', 'islands', 'halves'];

/** The islands map: zone width as a share of zoneSigma, and the food base between islands. */
const ISLAND_WIDTH = 0.5;
const ISLAND_BASE = 0.01;
/** The halves map: food multiplier on the poor side (x < 0) and on the rich side. */
export const HALF_POOR = 0.4;
export const HALF_RICH = 1.6;

export interface SocietyParams {
  maxN: number;
  // world and food
  /** The shape of the food field. Read once, when the world is built. */
  foodMap: FoodMap;
  /** Food the field can hold, as a multiple of what the map holds at 1. Read once, like foodMap. */
  foodCapacity: number;
  foodRes: number;
  foodZones: number;
  zoneSigma: number;
  zoneSpread: number;
  foodBase: number;
  regrow: number;
  // bodies
  /** Lattice edge in cells; maps lattice coordinates to the world cube [-1, 1]. */
  latticeSize: number;
  /** A body cell's size as a fraction of a lattice cell, once the organism has condensed. */
  bodyScale: number;
  minMass: number;
  splitMass: number;
  metabolism: number;
  harvestRate: number;
  harvestHalf: number;
  moveCost: number;
  /** Energy to build one cell; burning a cell returns half of it. */
  cellCost: number;
  /** Energy per cell above which the body grows. */
  growAt: number;
  /** Energy per cell needed to divide. */
  splitAt: number;
  lifespan: number;
  lifeSpread: number;
  // movement
  maxSpeed: number;
  accel: number;
  damping: number;
  senseRadius: number;
  sepRadius: number;
  followDist: number;
  /** Followers of the same lord spread apart, further for bigger branches. */
  sibSpread: number;
  wSpread: number;
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
  battleRadius: number;
  fightChance: number;
  /** Kin fight this much less often, and count this much as a threat. */
  kinPeace: number;
  /** Tullock exponent: returns to local numbers in a fight. */
  gamma: number;
  /** Cells the loser of a fight loses to the winner. */
  bite: number;
  fightCooldown: number;
  // allegiance
  tribute: number;
  /** Relatedness discount on tribute paid to a kin lord (Hamilton's r). */
  kinShare: number;
  /** Utility cost per direct follower the candidate lord already has. */
  attention: number;
  /** Utility cost per perception radius of distance to the candidate lord. */
  distanceCost: number;
  /** Utility bonus for keeping the current choice. */
  loyalty: number;
  /**
   * Fear: weight on unallied mass as a threat in the allegiance rule (1 = the model). At 0 nobody
   * fears anyone, and the rule has no reason to pay tribute to anyone.
   */
  fear: number;
  /**
   * Control loss per rank (Williamson 1967): protection reaching a follower decays with every link
   * between it and the ruler, so following someone at depth d costs controlLoss * (d + 1).
   */
  controlLoss: number;
  choiceEvery: number;
  /** Softmax temperature of the choice. 0 = always the best option. */
  temperature: number;
  // what counts as each ladder level
  realmMin: number;
  notableSize: number;
  tribeMin: number;
  tribeCount: number;
  /** A tribe: a polity of tribeMin+ in which at least this share are the ruler's kin. */
  tribeKin: number;
  hierSize: number;
  hierDepth: number;
  hierTribes: number;
  /** Hierarchy: at least this share of the realm's members come from other tribes than the ruler's. */
  hierForeign: number;
  govSize: number;
  govKeep: number;
  /** Ticks after a ruler dies before we check who its members follow. */
  govWindow: number;
}

// Tuned by scripts/sweep.ts (v2-sweep1, then v2-sweep2 with a depth term, 2026-11-09) over 27
// parameters. On 16 fresh seeds every world reached Tribes, Hierarchy and Government, at medians of
// 900, 1,770 and 3,676 ticks (about 15 s, 30 s and 61 s at 1x). No rule in this file mentions any of
// those levels. See tuning/best.json. That search still held followers a fixed drop below their lord;
// the drop now exists only in the renderer, and followDist went from 0.030 to 0.036 so realms graze
// as wide a volume as before (late population about 450 on 24 seeds, as with the drop).
export const DEFAULT_SOCIETY: SocietyParams = {
  maxN: 1400,
  foodMap: 'zones',
  foodCapacity: 1,
  foodRes: 16,
  foodZones: 6,
  zoneSigma: 0.4,
  zoneSpread: 0.55,
  foodBase: 0.0792,
  regrow: 0.0115,
  latticeSize: 48,
  bodyScale: 0.62,
  minMass: 3,
  splitMass: 12,
  metabolism: 0.000709,
  harvestRate: 0.0146,
  harvestHalf: 0.25,
  moveCost: 0.3,
  cellCost: 0.5,
  growAt: 0.783,
  splitAt: 1,
  lifespan: 3347,
  lifeSpread: 0.25,
  maxSpeed: 0.0042,
  accel: 0.0007,
  damping: 0.9,
  senseRadius: 0.16,
  sepRadius: 0.0383,
  followDist: 0.036,
  sibSpread: 0.018,
  wSpread: 0.9,
  followerForage: 0.706,
  wSep: 1.2,
  wKin: 0.821,
  wFood: 1,
  wFollow: 1,
  wAlign: 0.5,
  wWander: 0.25,
  wFlee: 1.07,
  wChase: 1.01,
  battleRadius: 0.1,
  fightChance: 0.0142,
  kinPeace: 0.596,
  gamma: 2.64,
  bite: 1,
  fightCooldown: 90,
  tribute: 0.118,
  kinShare: 0.3,
  attention: 0,
  distanceCost: 0.098,
  loyalty: 0.222,
  fear: 1,
  controlLoss: 0.0766,
  choiceEvery: 100,
  temperature: 0.0162,
  realmMin: 5,
  notableSize: 15,
  tribeMin: 10,
  tribeCount: 3,
  tribeKin: 0.75,
  hierSize: 30,
  hierDepth: 3,
  hierTribes: 2,
  hierForeign: 0.2,
  govSize: 30,
  govKeep: 0.6,
  govWindow: 240,
};

export type EventKind = 'level' | 'life' | 'realm' | 'conquest' | 'join' | 'rebellion' | 'succession' | 'fragment' | 'fall' | 'hand';

export interface SimEvent {
  tick: number;
  kind: EventKind;
  text: string;
  level?: number;
  /** The organism the event is about, for a viewer's camera: its slot and uid, when there is one. */
  slot?: number;
  uid?: number;
}

export interface Realm {
  id: number;
  name: string;
  tribe: number;
  founded: number;
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
  spawned: number;
  deaths: number;
  starved: number;
  killed: number;
  fights: number;
  conquests: number;
  joins: number;
  secessions: number;
  /** Secessions big enough to make the chronicle. */
  rebellions: number;
  successions: number;
  fragmentations: number;
  maxDepth: number;
  maxRealm: number;
  popPeak: number;
}

export interface Sample {
  tick: number;
  pop: number;
  realms: number;
  major: number;
  organized: number;
  largest: number;
  depth: number;
  /** Normalised negentropy of the partition of organisms into polities (see syntropy()). */
  syntropy: number;
  meanMass: number;
}

/** A finished succession test, kept for analysis. */
export interface SuccessionRecord {
  tick: number;
  /** The realm whose ruler died. */
  realm: number;
  members: number;
  keep: number;
  /** Share of the dead ruler's realm held by its largest direct branch at the moment of death. */
  heirShare: number;
  /** Mean distance of members from the realm's centre at death, in perception radii. */
  spread: number;
  survived: boolean;
}

/**
 * One option an organism weighs when it chooses whom to follow. `u` is the utility the rule uses;
 * the other fields are its terms, kept so a viewer can see why the option scored as it did.
 */
export interface Option {
  /** The candidate lord's slot, or -1 for answering to no one. */
  lord: number;
  root: number;
  u: number;
  /** Mass on the organism's side within its perception radius if it takes this option. */
  allies: number;
  /** Weighted unallied mass that would still threaten it. */
  threat: number;
  /** ln of the share kept after tribute (0 when it follows no one). */
  tax: number;
  /** Control loss for the candidate's depth. */
  rank: number;
  /** Attention and distance costs, net of the loyalty bonus. */
  other: number;
}

/** A succession test in progress: a ruler died and its former members are choosing again. */
export interface SuccessionWatch {
  realm: number;
  name: string;
  tribe: number;
  start: number;
  due: number;
  members: number;
  /** Members still alive, and their slots. */
  alive: number;
  slots: number[];
  /** Share of the original members now under the largest single root. */
  keep: number;
  /** Centre of the surviving members, in world coordinates. */
  x: number;
  y: number;
  z: number;
}

export const L_TRIBES = 2;
export const L_HIERARCHY = 3;
export const L_GOVERNMENT = 4;

const NONE = -1;

interface PendingSuccession {
  realm: number;
  due: number;
  slots: number[];
  uids: number[];
  heirShare: number;
  spread: number;
}

export class Society {
  readonly p: SocietyParams;
  readonly M: number;
  /** World units per lattice cell. */
  readonly cell: number;
  tick = 0;
  count = 0;

  alive: Uint8Array;
  pos: Float32Array;
  prev: Float32Array;
  vel: Float32Array;
  energy: Float32Array;
  mass: Uint8Array;
  radius: Float32Array;
  body: Int8Array;
  age: Float32Array;
  life: Float32Array;
  born: Int32Array;
  /** 1 = came off the lattice, 2 = born by fission. */
  origin: Uint8Array;
  tribe: Uint8Array;
  uid: Int32Array;
  cooldown: Uint16Array;
  /** How many times each organism has changed whom it follows. */
  switches: Uint16Array;
  lord: Int32Array;
  firstChild: Int32Array;
  nextSib: Int32Array;
  prevSib: Int32Array;
  nChild: Int32Array;
  root: Int32Array;
  depth: Int32Array;
  subSize: Int32Array;
  subDepth: Int32Array;
  subMass: Float32Array;
  /** Per root: members that share the ruler's tribe. */
  kinCount: Int32Array;
  tribeMask: Uint8Array;
  realmOf: Int32Array;

  readonly F: number;
  food: Float32Array;
  cap: Float32Array;
  /** The most food one cell can hold on this map. No rule reads it; a viewer scales the stipple by it. */
  foodCeil = 1;
  zones: { x: number; y: number; z: number }[] = [];

  events: SimEvent[] = [];
  emitted = 0;
  realms: Realm[] = [];
  levels: number[] = [-1, -1, -1, -1, -1];
  stats: SocietyStats = {
    births: 0, spawned: 0, deaths: 0, starved: 0, killed: 0, fights: 0, conquests: 0, joins: 0,
    secessions: 0, rebellions: 0, successions: 0, fragmentations: 0, maxDepth: 0, maxRealm: 0, popPeak: 0,
  };
  history: Sample[] = [];
  successions: SuccessionRecord[] = [];
  rootCount = 0;
  /** Organisms a viewer removed from outside the model (see strike()). */
  strikes = 0;
  /** Mechanisms an experiment can switch off (see scripts/experiments.ts). */
  ablate = { tribute: false, conflict: false, allegiance: false, kin: false, attention: false };

  private rng: Rng;
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
  private lostTo: Int32Array;
  private queue: Int32Array;
  private queued: Uint8Array;
  private queueLen = 0;
  private stamp: Int32Array;
  private stampNow = 0;
  private rootStamp: Int32Array;
  private rootMass: Float32Array;
  private rootHost: Float32Array;
  private rootBest: Int32Array;
  private rootCost: Float32Array;
  private touched: Int32Array;
  private pending: PendingSuccession[] = [];
  private pendingUid = new Set<number>();
  private nextUid = 1;
  /** Groups founded so far by each lineage, for their names. */
  private nameCounts: number[] = [];
  private gN: number;
  private cellSize: number;
  private cellStart: Int32Array;
  private cellItems: Int32Array;
  private cellOf: Int32Array;
  private cursor: Int32Array;

  /**
   * `homelands` (world coordinates) put the fertile zones where the lattice lineages began, so each
   * tribe starts on its own land; without them the zones are placed at random.
   */
  constructor(params: SocietyParams, rng: Rng, homelands?: { x: number; y: number; z: number }[]) {
    this.p = params;
    this.rng = rng;
    // Group names once came from a forked stream. The fork still happens, and its result is unused,
    // so the main stream is where it always was and every seed keeps its history.
    rng.fork();
    this.cell = 2 / params.latticeSize;
    const M = (this.M = params.maxN);
    this.alive = new Uint8Array(M);
    this.pos = new Float32Array(3 * M);
    this.prev = new Float32Array(3 * M);
    this.vel = new Float32Array(3 * M);
    this.acc = new Float32Array(3 * M);
    this.wander = new Float32Array(3 * M);
    this.energy = new Float32Array(M);
    this.mass = new Uint8Array(M);
    this.radius = new Float32Array(M);
    this.body = new Int8Array(M * MAXB * 3);
    this.age = new Float32Array(M);
    this.life = new Float32Array(M);
    this.born = new Int32Array(M);
    this.origin = new Uint8Array(M);
    this.tribe = new Uint8Array(M);
    this.uid = new Int32Array(M);
    this.cooldown = new Uint16Array(M);
    this.switches = new Uint16Array(M);
    this.lord = new Int32Array(M).fill(NONE);
    this.firstChild = new Int32Array(M).fill(NONE);
    this.nextSib = new Int32Array(M).fill(NONE);
    this.prevSib = new Int32Array(M).fill(NONE);
    this.nChild = new Int32Array(M);
    this.root = new Int32Array(M).fill(NONE);
    this.depth = new Int32Array(M);
    this.subSize = new Int32Array(M);
    this.subDepth = new Int32Array(M);
    this.subMass = new Float32Array(M);
    this.kinCount = new Int32Array(M);
    this.tribeMask = new Uint8Array(M);
    this.realmOf = new Int32Array(M).fill(NONE);
    this.tribIn = new Float32Array(M);
    this.tribNext = new Float32Array(M);
    this.order = new Int32Array(M);
    this.kids = new Int32Array(M);
    this.sqrtSub = new Float32Array(M);
    this.contactA = new Int32Array(M * 4);
    this.contactB = new Int32Array(M * 4);
    this.lostTo = new Int32Array(M).fill(NONE);
    this.queue = new Int32Array(M);
    this.queued = new Uint8Array(M);
    this.stamp = new Int32Array(M);
    this.rootStamp = new Int32Array(M);
    this.rootMass = new Float32Array(M);
    this.rootHost = new Float32Array(M);
    this.rootBest = new Int32Array(M);
    this.rootCost = new Float32Array(M);
    this.touched = new Int32Array(M);
    this.freeStack = new Int32Array(M);
    for (let i = 0; i < M; i++) this.freeStack[i] = M - 1 - i;
    this.freeTop = M;

    this.cellSize = params.senseRadius;
    this.gN = Math.max(1, Math.ceil(2 / this.cellSize));
    const nCells = this.gN ** 3;
    this.cellStart = new Int32Array(nCells + 1);
    this.cursor = new Int32Array(nCells);
    this.cellItems = new Int32Array(M);
    this.cellOf = new Int32Array(M);

    this.F = params.foodRes;
    this.food = new Float32Array(this.F ** 3);
    this.cap = new Float32Array(this.F ** 3);
    this.placeFood(homelands);
    this.levels[0] = 0;
  }

  // ---------------------------------------------------------------- setup

  private placeFood(homelands?: { x: number; y: number; z: number }[]): void {
    const { p, rng, F } = this;
    const centres: { x: number; y: number; z: number; amp: number }[] = (homelands ?? []).map((h) => ({ ...h, amp: rng.range(0.75, 1) }));
    for (let k = centres.length; k < p.foodZones; k++) {
      let best = { x: 0, y: 0, z: 0 };
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
      centres.push({ ...best, amp: rng.range(0.75, 1) });
    }
    this.zones = centres.map(({ x, y, z }) => ({ x, y, z }));
    const cap = this.cap;
    // A base level plus one Gaussian zone per centre, at most 1 per cell. Returns the total.
    const paint = (sigma: number, base: number): number => {
      const inv2s2 = 1 / (2 * sigma * sigma);
      let total = 0;
      for (let z = 0; z < F; z++) {
        for (let y = 0; y < F; y++) {
          for (let x = 0; x < F; x++) {
            const wx = ((x + 0.5) / F) * 2 - 1;
            const wy = ((y + 0.5) / F) * 2 - 1;
            const wz = ((z + 0.5) / F) * 2 - 1;
            let c = base;
            for (const o of centres) c += o.amp * Math.exp(-((wx - o.x) ** 2 + (wy - o.y) ** 2 + (wz - o.z) ** 2) * inv2s2);
            const i = x + F * (y + F * z);
            cap[i] = Math.min(1, c);
            total += cap[i];
          }
        }
      }
      return total;
    };
    // Every map starts from the zones, and the other three rearrange that food. The capacity dial
    // then scales the whole field. With the zones at capacity 1 nothing below changes a cell.
    const zonesTotal = paint(p.zoneSigma, p.foodBase);
    let ceil = 1;
    if (p.foodMap === 'plain') {
      ceil = zonesTotal / cap.length;
      cap.fill(ceil);
    } else if (p.foodMap === 'islands') {
      ceil = zonesTotal / paint(p.zoneSigma * ISLAND_WIDTH, ISLAND_BASE);
      for (let i = 0; i < cap.length; i++) cap[i] *= ceil;
    } else if (p.foodMap === 'halves') {
      ceil = HALF_RICH;
      for (let i = 0; i < cap.length; i++) cap[i] *= i % F < F / 2 ? HALF_POOR : HALF_RICH;
    }
    if (p.foodCapacity !== 1) for (let i = 0; i < cap.length; i++) cap[i] *= p.foodCapacity;
    this.foodCeil = ceil * p.foodCapacity;
    this.food.set(cap);
  }

  /**
   * A form that held its shape comes off the lattice and becomes one organism, or several if it
   * is bigger than one body can be. `cells` holds lattice coordinates [x, y, z, ...].
   */
  spawnForm(cells: number[], lineage: number): number[] {
    const n = cells.length / 3;
    if (n < this.p.minMass) return [];
    const idx = Array.from({ length: n }, (_, k) => k);
    // Split along the longest extent into pieces no bigger than a body that is about to divide.
    const ext = [0, 1, 2].map((a) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = 0; k < n; k++) {
        lo = Math.min(lo, cells[3 * k + a]);
        hi = Math.max(hi, cells[3 * k + a]);
      }
      return hi - lo;
    });
    const axis = ext.indexOf(Math.max(...ext));
    idx.sort((a, b) => cells[3 * a + axis] - cells[3 * b + axis]);
    const pieces = Math.ceil(n / Math.max(this.p.minMass, this.p.splitMass - 2));
    const per = Math.ceil(n / pieces);
    const made: number[] = [];
    for (let q = 0; q < pieces; q++) {
      const part = idx.slice(q * per, (q + 1) * per);
      if (part.length < this.p.minMass) continue;
      const i = this.alloc();
      if (i < 0) break;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (const k of part) {
        cx += cells[3 * k];
        cy += cells[3 * k + 1];
        cz += cells[3 * k + 2];
      }
      const ox = Math.round(cx / part.length);
      const oy = Math.round(cy / part.length);
      const oz = Math.round(cz / part.length);
      let m = 0;
      const base = i * MAXB * 3;
      for (const k of part) {
        if (m >= MAXB) break;
        this.body[base + 3 * m] = clampInt(cells[3 * k] - ox, -127, 127);
        this.body[base + 3 * m + 1] = clampInt(cells[3 * k + 1] - oy, -127, 127);
        this.body[base + 3 * m + 2] = clampInt(cells[3 * k + 2] - oz, -127, 127);
        m++;
      }
      this.mass[i] = m;
      this.updateRadius(i);
      const G = this.p.latticeSize;
      this.pos[3 * i] = ((ox + 0.5) / G) * 2 - 1;
      this.pos[3 * i + 1] = ((oy + 0.5) / G) * 2 - 1;
      this.pos[3 * i + 2] = ((oz + 0.5) / G) * 2 - 1;
      this.prev[3 * i] = this.pos[3 * i];
      this.prev[3 * i + 1] = this.pos[3 * i + 1];
      this.prev[3 * i + 2] = this.pos[3 * i + 2];
      this.tribe[i] = lineage;
      this.energy[i] = m * this.p.growAt * this.rng.range(0.6, 0.9);
      this.age[i] = 0;
      this.origin[i] = 1;
      this.queueChoice(i);
      this.stats.spawned++;
      made.push(i);
    }
    if (made.length && this.levels[1] < 0) {
      this.levels[1] = this.tick;
      this.emit('level', `Organisms: a ${TRIBE_NAMES[lineage]} form holds together and comes loose from the lattice.`, 1, made[0]);
    }
    return made;
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
    this.switches[i] = 0;
    this.tribIn[i] = 0;
    this.tribNext[i] = 0;
    this.lostTo[i] = NONE;
    this.vel[3 * i] = this.vel[3 * i + 1] = this.vel[3 * i + 2] = 0;
    const w = randomUnit(this.rng);
    this.wander[3 * i] = w[0];
    this.wander[3 * i + 1] = w[1];
    this.wander[3 * i + 2] = w[2];
    this.born[i] = this.tick;
    this.life[i] = this.p.lifespan * (1 + this.p.lifeSpread * this.rng.range(-1, 1));
    this.root[i] = i;
    this.depth[i] = 0;
    this.subSize[i] = 1;
    this.subMass[i] = 0;
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

  private updateRadius(i: number): void {
    this.radius[i] = 0.55 * this.cell * this.p.bodyScale * Math.cbrt(this.mass[i]) + 0.004;
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

  private attach(x: number, y: number): boolean {
    if (this.isAbove(x, y)) return false;
    this.unlink(x);
    this.link(x, y);
    return true;
  }

  private queueChoice(i: number): void {
    if (this.queued[i]) return;
    this.queued[i] = 1;
    this.queue[this.queueLen++] = i;
  }

  // ---------------------------------------------------------------- tick

  step(): void {
    this.prev.set(this.pos);
    this.computeTree();
    if (this.tick % 30 === 0) this.survey();
    this.buildGrid();
    this.economy();
    this.moveAndMeet();
    if (!this.ablate.conflict) this.resolveContacts();
    this.choices();
    this.deaths();
    this.births();
    this.regrow();
    this.resolveSuccessions();
    this.tick++;
  }

  private computeTree(): void {
    const { M, alive, lord, firstChild, nextSib, order, depth, root } = this;
    let len = 0;
    for (let i = 0; i < M; i++) if (alive[i]) depth[i] = -1;
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
      for (let i = 0; i < M; i++) if (alive[i] && depth[i] < 0) this.unlink(i);
      this.computeTree();
      return;
    }
    for (let h = 0; h < len; h++) {
      const i = order[h];
      this.subSize[i] = 1;
      this.subDepth[i] = 0;
      this.subMass[i] = this.mass[i];
      this.tribeMask[i] = 1 << this.tribe[i];
      this.kinCount[i] = 0;
    }
    for (let h = 0; h < len; h++) {
      const i = order[h];
      if (this.tribe[i] === this.tribe[root[i]]) this.kinCount[root[i]]++;
    }
    for (let h = len - 1; h >= 0; h--) {
      const i = order[h];
      const L = lord[i];
      if (L < 0) continue;
      this.subSize[L] += this.subSize[i];
      this.subMass[L] += this.subMass[i];
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
    for (let i = 0; i < M; i++) if (alive[i]) cellItems[cursor[cellOf[i]]++] = i;
  }

  private foodIndex(x: number, y: number, z: number): number {
    const F = this.F;
    const ix = clampInt(Math.floor(((x + 1) / 2) * F), 0, F - 1);
    const iy = clampInt(Math.floor(((y + 1) / 2) * F), 0, F - 1);
    const iz = clampInt(Math.floor(((z + 1) / 2) * F), 0, F - 1);
    return ix + F * (iy + F * iz);
  }

  private economy(): void {
    const { M, alive, p, pos, vel, energy, mass, lord, food, tribIn, tribNext } = this;
    const tribute = this.ablate.tribute ? 0 : p.tribute;
    for (let i = 0; i < M; i++) {
      if (!alive[i]) continue;
      const m = mass[i];
      const k = Math.pow(m, 0.75);
      const c = this.foodIndex(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
      const f = food[c];
      let intake = (p.harvestRate * k * f) / (f + p.harvestHalf);
      if (intake > f) intake = f;
      food[c] = f - intake;
      let income = intake + tribIn[i];
      const L = lord[i];
      if (L >= 0 && tribute > 0) {
        const pay = tribute * income;
        tribNext[L] += pay;
        income -= pay;
      }
      const vmax = this.vmax(i);
      const sp2 = vel[3 * i] ** 2 + vel[3 * i + 1] ** 2 + vel[3 * i + 2] ** 2;
      energy[i] += income - p.metabolism * k * (1 + (p.moveCost * sp2) / (vmax * vmax));
      // The body follows the energy budget: build a cell on surplus, burn one in deficit.
      if (energy[i] > p.growAt * m * 1.15 && m < p.splitMass) {
        if (this.grow(i)) energy[i] -= p.cellCost;
      } else if (energy[i] < 0 && m > p.minMass) {
        this.shrink(i);
        energy[i] += p.cellCost * 0.5;
      }
      this.age[i] += 1;
      if (this.cooldown[i] > 0) this.cooldown[i]--;
    }
    this.tribIn = tribNext;
    this.tribNext = tribIn;
    this.tribNext.fill(0);
  }

  private vmax(i: number): number {
    return this.p.maxSpeed * Math.pow(8 / Math.max(1, this.mass[i]), 0.25);
  }

  /** Add one cell on the body's surface. */
  private grow(i: number): boolean {
    const m = this.mass[i];
    if (m >= MAXB) return false;
    const base = i * MAXB * 3;
    for (let attempt = 0; attempt < 8; attempt++) {
      const from = this.rng.int(m);
      const axis = this.rng.int(3);
      const dir = this.rng.chance(0.5) ? 1 : -1;
      const nx = this.body[base + 3 * from] + (axis === 0 ? dir : 0);
      const ny = this.body[base + 3 * from + 1] + (axis === 1 ? dir : 0);
      const nz = this.body[base + 3 * from + 2] + (axis === 2 ? dir : 0);
      let taken = false;
      for (let q = 0; q < m && !taken; q++) {
        taken = this.body[base + 3 * q] === nx && this.body[base + 3 * q + 1] === ny && this.body[base + 3 * q + 2] === nz;
      }
      if (taken || Math.abs(nx) > 6 || Math.abs(ny) > 6 || Math.abs(nz) > 6) continue;
      this.body[base + 3 * m] = nx;
      this.body[base + 3 * m + 1] = ny;
      this.body[base + 3 * m + 2] = nz;
      this.mass[i] = m + 1;
      this.updateRadius(i);
      return true;
    }
    return false;
  }

  /** Remove the cell farthest from the body's centre (the most exposed one). */
  private shrink(i: number, n = 1): void {
    const base = i * MAXB * 3;
    for (let t = 0; t < n && this.mass[i] > 0; t++) {
      const m = this.mass[i];
      let far = 0;
      let farD = -1;
      for (let q = 0; q < m; q++) {
        const d = this.body[base + 3 * q] ** 2 + this.body[base + 3 * q + 1] ** 2 + this.body[base + 3 * q + 2] ** 2;
        if (d > farD) {
          farD = d;
          far = q;
        }
      }
      const last = m - 1;
      this.body[base + 3 * far] = this.body[base + 3 * last];
      this.body[base + 3 * far + 1] = this.body[base + 3 * last + 1];
      this.body[base + 3 * far + 2] = this.body[base + 3 * last + 2];
      this.mass[i] = last;
    }
    this.updateRadius(i);
  }

  /** Trilinear food value and gradient at a point: out = [value, gx, gy, gz]. */
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
    const dx0 = v100 - v000 + (v110 - v010 - (v100 - v000)) * ty;
    const dx1 = v101 - v001 + (v111 - v011 - (v101 - v001)) * ty;
    out[1] = dx0 + (dx1 - dx0) * tz;
    out[2] = a10 - a00 + (a11 - a01 - (a10 - a00)) * tz;
    out[3] = b1 - b0;
  }

  private moveAndMeet(): void {
    const { M, alive, p, pos, vel, acc, wander, root, subMass, tribe, lord, energy, mass, rng } = this;
    const { gN, cellStart, cellItems, cellOf } = this;
    const sense2 = p.senseRadius * p.senseRadius;
    const sepR = p.sepRadius;
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
      const Pi = subMass[ri];
      const Li = lord[i];
      const hunger = clamp(1 - energy[i] / (mass[i] * p.growAt), 0, 1);
      let sx = 0, sy = 0, sz = 0;
      let kx = 0, ky = 0, kz = 0, kn = 0;
      let fx = 0, fy = 0, fz = 0;
      let cx = 0, cy = 0, cz = 0;
      let hx = 0, hy = 0, hz = 0;
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
              const reach = sepR + this.radius[i] + this.radius[j];
              if (d < reach) {
                const w = (1 - d / reach) / d;
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
                const spread = p.sibSpread * (sqrtSub[i] + sqrtSub[j]);
                if (d < spread) {
                  const w = (1 - d / spread) / d;
                  hx -= dx * w;
                  hy -= dy * w;
                  hz -= dz * w;
                }
              }
              const rj = root[j];
              if (rj === ri) continue;
              const Pj = subMass[rj];
              const fall = (1 - d / p.senseRadius) / d;
              if (Pj > 1.5 * Pi) {
                fx -= dx * fall;
                fy -= dy * fall;
                fz -= dz * fall;
              } else if (Pi > 1.5 * Pj && hunger > 0.3) {
                cx += dx * fall;
                cy += dy * fall;
                cz += dz * fall;
              }
              if (j > i && d < this.radius[i] + this.radius[j] + 0.008 && nContacts < maxContacts) {
                this.contactA[nContacts] = i;
                this.contactB[nContacts] = j;
                nContacts++;
              }
            }
          }
        }
      }

      let wx = wander[3 * i] + rng.normal() * 0.15;
      let wy = wander[3 * i + 1] + rng.normal() * 0.15;
      let wz = wander[3 * i + 2] + rng.normal() * 0.15;
      const wl = Math.hypot(wx, wy, wz) + 1e-9;
      wx /= wl;
      wy /= wl;
      wz /= wl;
      wander[3 * i] = wx;
      wander[3 * i + 1] = wy;
      wander[3 * i + 2] = wz;

      this.foodField(px, py, pz, ff);
      // Steer by the direction of the food gradient; its size matters only when it is faint.
      const gl = Math.hypot(ff[1], ff[2], ff[3]);
      const gscale = gl > 1e-6 ? 1 / (gl + 0.03) : 0;

      let ax = sx * p.wSep + hx * p.wSpread;
      let ay = sy * p.wSep + hy * p.wSpread;
      let az = sz * p.wSep + hz * p.wSpread;
      if (Li >= 0) {
        const lx = pos[3 * Li] - px;
        const ly = pos[3 * Li + 1] - py;
        const lz = pos[3 * Li + 2] - pz;
        const ld = Math.hypot(lx, ly, lz) + 1e-6;
        const pull = clamp((ld - p.followDist) / p.followDist, -0.5, 3) / ld;
        ax += lx * pull * p.wFollow;
        ay += ly * pull * p.wFollow;
        az += lz * pull * p.wFollow;
        const inv = 1 / p.maxSpeed;
        ax += (vel[3 * Li] - vel[3 * i]) * inv * p.wAlign;
        ay += (vel[3 * Li + 1] - vel[3 * i + 1]) * inv * p.wAlign;
        az += (vel[3 * Li + 2] - vel[3 * i + 2]) * inv * p.wAlign;
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
          const s = (p.wKin * Math.min(1, kl / 0.05)) / (kn * kl);
          ax += kx * s;
          ay += ky * s;
          az += kz * s;
        }
      }
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
      // A freshly condensed organism holds still while it pulls its cells together.
      const settling = this.origin[i] === 1 && this.tick - this.born[i] < 40;
      const vmax = settling ? 0 : this.vmax(i);
      let vx = vel[3 * i] * p.damping + acc[3 * i] * p.accel;
      let vy = vel[3 * i + 1] * p.damping + acc[3 * i + 1] * p.accel;
      let vz = vel[3 * i + 2] * p.damping + acc[3 * i + 2] * p.accel;
      const sp = Math.hypot(vx, vy, vz);
      if (sp > vmax) {
        const k = vmax / (sp + 1e-12);
        vx *= k;
        vy *= k;
        vz *= k;
      }
      vel[3 * i] = vx;
      vel[3 * i + 1] = vy;
      vel[3 * i + 2] = vz;
      pos[3 * i] = clamp(pos[3 * i] + vx, -0.98, 0.98);
      pos[3 * i + 1] = clamp(pos[3 * i + 1] + vy, -0.98, 0.98);
      pos[3 * i + 2] = clamp(pos[3 * i + 2] + vz, -0.98, 0.98);
    }
  }

  /** Mass of polity `r` within battleRadius of a point. */
  private localMass(r: number, mx: number, my: number, mz: number): number {
    const { gN, cellStart, cellItems, pos, root, mass, p } = this;
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
            if (dx * dx + dy * dy + dz * dz <= b2) sum += mass[j];
          }
        }
      }
    }
    return sum;
  }

  private resolveContacts(): void {
    const { p, rng, pos, tribe, energy, mass } = this;
    for (let n = 0; n < this.nContacts; n++) {
      const i = this.contactA[n];
      const j = this.contactB[n];
      if (!this.alive[i] || !this.alive[j]) continue;
      if (this.cooldown[i] > 0 || this.cooldown[j] > 0) continue;
      const ri = this.rootOf(i);
      const rj = this.rootOf(j);
      if (ri === rj) continue;
      // Hungry organisms pick fights; kin mostly don't.
      const hi = clamp(1 - energy[i] / (mass[i] * p.growAt), 0, 1);
      const hj = clamp(1 - energy[j] / (mass[j] * p.growAt), 0, 1);
      const chance = p.fightChance * (0.4 + Math.max(hi, hj)) * (tribe[i] === tribe[j] ? p.kinPeace : 1);
      if (!rng.chance(chance)) continue;
      const mx = (pos[3 * i] + pos[3 * j]) / 2;
      const my = (pos[3 * i + 1] + pos[3 * j + 1]) / 2;
      const mz = (pos[3 * i + 2] + pos[3 * j + 2]) / 2;
      const li = this.localMass(this.root[i], mx, my, mz) + mass[i] * 0.01;
      const lj = this.localMass(this.root[j], mx, my, mz) + mass[j] * 0.01;
      const gi = li ** p.gamma;
      const gj = lj ** p.gamma;
      const iWins = rng.chance(gi / (gi + gj));
      const w = iWins ? i : j;
      const l = iWins ? j : i;
      this.cooldown[i] = this.cooldown[j] = p.fightCooldown;
      this.stats.fights++;
      // The winner eats part of the loser's body.
      const taken = Math.min(p.bite, mass[l]);
      this.shrink(l, taken);
      for (let q = 0; q < taken; q++) if (!this.grow(w)) break;
      if (mass[l] < p.minMass) {
        energy[l] = -1;
        this.stats.killed++;
      } else {
        this.lostTo[l] = this.rootOf(w);
        this.queueChoice(l);
      }
    }
  }

  // ---------------------------------------------------------------- allegiance

  private choices(): void {
    const { M, alive, uid, p } = this;
    const t = this.tick;
    if (this.ablate.allegiance) {
      // Ablation: nobody ever chooses a lord, so no polity can form.
      for (let q = 0; q < this.queueLen; q++) this.queued[this.queue[q]] = 0;
      this.queueLen = 0;
      return;
    }
    for (let i = 0; i < M; i++) if (alive[i] && (uid[i] + t) % p.choiceEvery === 0) this.queueChoice(i);
    for (let q = 0; q < this.queueLen; q++) {
      const i = this.queue[q];
      this.queued[i] = 0;
      if (alive[i]) this.choose(i);
    }
    this.queueLen = 0;
  }

  /**
   * The one allegiance rule, first half: list what organism i could do and score each option. See
   * the header comment and the paper for the derivation. It changes nothing but scratch arrays and
   * draws no random numbers, so explain() can call it for a viewer without disturbing the world.
   */
  private weigh(i: number): Option[] {
    const { p, pos, mass, tribe, lord, nChild, gN, cellStart, cellItems, cellOf } = this;
    const R = p.senseRadius;
    const R2 = R * R;
    // Mark i's own subtree: those come along whatever i chooses.
    const s = ++this.stampNow;
    let ownNear = mass[i];
    {
      const stack = this.kids;
      let top = 0;
      stack[top++] = i;
      while (top > 0) {
        const k = stack[--top];
        this.stamp[k] = s;
        for (let c = this.firstChild[k]; c >= 0; c = this.nextSib[c]) stack[top++] = c;
      }
    }
    const kinPeace = this.ablate.kin ? 1 : p.kinPeace;
    let totalHost = 0;
    let nTouched = 0;
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
            if (j === i || !this.alive[j]) continue;
            const dx = pos[3 * j] - pos[3 * i];
            const dy = pos[3 * j + 1] - pos[3 * i + 1];
            const dz = pos[3 * j + 2] - pos[3 * i + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > R2) continue;
            if (this.stamp[j] === s) {
              ownNear += mass[j];
              continue;
            }
            const r = this.rootOf(j);
            if (this.rootStamp[r] !== s) {
              this.rootStamp[r] = s;
              this.rootMass[r] = 0;
              this.rootHost[r] = 0;
              this.rootBest[r] = NONE;
              this.rootCost[r] = Infinity;
              this.touched[nTouched++] = r;
            }
            const w = (tribe[j] === tribe[i] ? kinPeace : 1) * p.fear;
            this.rootMass[r] += mass[j];
            this.rootHost[r] += w * mass[j];
            totalHost += w * mass[j];
            const cost = (this.ablate.attention ? 0 : p.attention * nChild[j]) + (p.distanceCost * Math.sqrt(d2)) / R;
            if (cost < this.rootCost[r]) {
              this.rootCost[r] = cost;
              this.rootBest[r] = j;
            }
          }
        }
      }
    }

    const L = lord[i];
    const curRoot = L >= 0 ? this.rootOf(i) : NONE;
    const tribute = this.ablate.tribute ? 0 : p.tribute;
    const kinShare = this.ablate.kin ? 0 : p.kinShare;
    // Options: 0 = answer to no one; then one per neighbouring polity.
    const opts: Option[] = [];
    opts.push({
      lord: NONE, root: NONE, u: Math.log(ownNear / (ownNear + totalHost)) + (L < 0 ? p.loyalty : 0),
      allies: ownNear, threat: totalHost, tax: 0, rank: 0, other: L < 0 ? -p.loyalty : 0,
    });
    let sawCurrent = false;
    for (let q = 0; q < nTouched; q++) {
      const r = this.touched[q];
      let j = this.rootBest[r];
      let cost = this.rootCost[r];
      if (r === curRoot && L >= 0) {
        // Keeping the current lord is also on the table, with a small loyalty bonus.
        const d = Math.hypot(pos[3 * L] - pos[3 * i], pos[3 * L + 1] - pos[3 * i + 1], pos[3 * L + 2] - pos[3 * i + 2]);
        const cl = (this.ablate.attention ? 0 : p.attention * Math.max(0, nChild[L] - 1)) + (p.distanceCost * d) / R - p.loyalty;
        if (cl <= cost) {
          j = L;
          cost = cl;
        }
        sawCurrent = true;
      }
      if (j < 0) continue;
      const A = ownNear + this.rootMass[r];
      const H = Math.max(0, totalHost - this.rootHost[r]);
      const kin = tribe[j] === tribe[i];
      const tax = Math.log(1 - tribute * (kin ? 1 - kinShare : 1));
      const loss = p.controlLoss * (this.depth[j] + 1);
      opts.push({ lord: j, root: r, u: Math.log(A / (A + H)) + tax - cost - loss, allies: A, threat: H, tax, rank: loss, other: cost });
    }
    if (L >= 0 && !sawCurrent) {
      // The current lord's polity has no one nearby: staying buys no local protection.
      const d = Math.hypot(pos[3 * L] - pos[3 * i], pos[3 * L + 1] - pos[3 * i + 1], pos[3 * L + 2] - pos[3 * i + 2]);
      const kin = tribe[L] === tribe[i];
      const tax = Math.log(1 - tribute * (kin ? 1 - kinShare : 1));
      opts.push({
        lord: L, root: curRoot, u: Math.log(ownNear / (ownNear + totalHost)) + tax - (p.distanceCost * d) / R + p.loyalty - p.controlLoss * (this.depth[L] + 1),
        allies: ownNear, threat: totalHost, tax, rank: p.controlLoss * (this.depth[L] + 1), other: (p.distanceCost * d) / R - p.loyalty,
      });
    }
    return opts;
  }

  /** The one allegiance rule, second half: pick an option and act on it. */
  private choose(i: number): void {
    const { p, tribe } = this;
    const L = this.lord[i];
    const curRoot = L >= 0 ? this.rootOf(i) : NONE;
    const opts = this.weigh(i);

    // Softmax choice.
    let pick = 0;
    if (p.temperature > 0) {
      let max = -Infinity;
      for (const o of opts) max = Math.max(max, o.u);
      let sum = 0;
      const w = opts.map((o) => {
        const e = Math.exp((o.u - max) / p.temperature);
        sum += e;
        return e;
      });
      let x = this.rng.next() * sum;
      for (pick = 0; pick < w.length - 1; pick++) {
        x -= w[pick];
        if (x <= 0) break;
      }
    } else {
      for (let q = 1; q < opts.length; q++) if (opts[q].u > opts[pick].u) pick = q;
    }
    const choice = opts[pick];
    const lostTo = this.lostTo[i];
    this.lostTo[i] = NONE;
    if (choice.lord === L) return;

    const wasRuler = L < 0;
    const realmI = this.realmOf[i];
    if (choice.lord === NONE) {
      const n = this.subSize[i];
      const from = curRoot >= 0 ? this.realmOf[curRoot] : NONE;
      this.unlink(i);
      this.switches[i]++;
      this.stats.secessions++;
      if (from >= 0 && this.realms[from].notable && n >= Math.max(8, 0.15 * this.realms[from].size)) {
        const foreign = tribe[i] !== this.realms[from].tribe;
        this.stats.rebellions++;
        this.emit('rebellion', `${n} ${foreign ? `${TRIBE_NAMES[tribe[i]]} members` : 'members'} split from ${this.realms[from].name}.`, undefined, i);
      }
      return;
    }
    if (!this.attach(i, choice.lord)) return;
    this.switches[i]++;
    this.stats.joins++;
    const hostRoot = this.rootOf(choice.lord);
    if (lostTo >= 0 && lostTo === hostRoot) this.stats.conquests++;
    if (wasRuler && realmI >= 0) {
      const r = this.realms[realmI];
      const host = this.realmLabel(hostRoot);
      if (r.notable) {
        const verb = lostTo === hostRoot ? 'is taken over by' : tribe[i] === tribe[hostRoot] ? 'joins its kin in' : 'joins';
        this.emit(lostTo === hostRoot ? 'conquest' : 'join', `${r.name} ${verb} ${host} (${this.subSize[i]}).`, undefined, i);
      }
      this.endRealm(realmI);
    }
  }

  // ---------------------------------------------------------------- life and death

  private deaths(): void {
    const { M, alive, energy, age, life, mass, p } = this;
    for (let i = 0; i < M; i++) {
      if (!alive[i]) continue;
      if (mass[i] < p.minMass) {
        this.kill(i); // eaten down in a fight, counted there
      } else if (energy[i] < 0 && mass[i] <= p.minMass) {
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
    const wasRoot = this.lord[d] < 0;
    const realmId = this.realmOf[d];
    if (wasRoot && realmId >= 0) this.openSuccession(d, realmId);
    for (let q = 0; q < k; q++) {
      this.unlink(kids[q]);
      this.queueChoice(kids[q]);
    }
    this.unlink(d);
    this.realmOf[d] = NONE;
    this.stats.deaths++;
    this.release(d);
  }

  /** A ruler died: note who belonged to its realm, and check later whether they regrouped. */
  private openSuccession(d: number, realmId: number): void {
    const members: number[] = [];
    const uids: number[] = [];
    const stack: number[] = [];
    for (let c = this.firstChild[d]; c >= 0; c = this.nextSib[c]) stack.push(c);
    let biggest = 0;
    for (let c = this.firstChild[d]; c >= 0; c = this.nextSib[c]) biggest = Math.max(biggest, this.subSize[c]);
    let cx = 0;
    let cy = 0;
    let cz = 0;
    while (stack.length) {
      const k = stack.pop()!;
      members.push(k);
      uids.push(this.uid[k]);
      cx += this.pos[3 * k];
      cy += this.pos[3 * k + 1];
      cz += this.pos[3 * k + 2];
      for (let c = this.firstChild[k]; c >= 0; c = this.nextSib[c]) stack.push(c);
    }
    const n = members.length;
    if (n === 0) {
      const r = this.realms[realmId];
      if (r.notable) this.emit('fall', `${r.name} ends when its last leader dies.`);
      this.endRealm(realmId);
      return;
    }
    cx /= n;
    cy /= n;
    cz /= n;
    let spread = 0;
    for (const k of members) spread += Math.hypot(this.pos[3 * k] - cx, this.pos[3 * k + 1] - cy, this.pos[3 * k + 2] - cz);
    this.pending.push({
      realm: realmId,
      due: this.tick + this.p.govWindow,
      slots: members,
      uids,
      heirShare: biggest / n,
      spread: spread / n / this.p.senseRadius,
    });
    for (const u of uids) this.pendingUid.add(u);
    this.realms[realmId].sovereign = NONE;
  }

  private resolveSuccessions(): void {
    if (!this.pending.length) return;
    const still: PendingSuccession[] = [];
    for (const ps of this.pending) {
      if (ps.due > this.tick) {
        still.push(ps);
        continue;
      }
      const counts = new Map<number, number>();
      for (let q = 0; q < ps.slots.length; q++) {
        const k = ps.slots[q];
        if (!this.alive[k] || this.uid[k] !== ps.uids[q]) continue;
        const r = this.rootOf(k);
        counts.set(r, (counts.get(r) ?? 0) + 1);
      }
      for (const u of ps.uids) this.pendingUid.delete(u);
      let bestRoot = NONE;
      let best = 0;
      for (const [r, n] of counts) if (n > best) [best, bestRoot] = [n, r];
      const members = ps.slots.length;
      const keep = best / Math.max(1, members);
      const realm = this.realms[ps.realm];
      // Regrouping under a ruler that already heads another realm is absorption, not succession.
      const survived = bestRoot >= 0 && keep >= this.p.govKeep && this.realmOf[bestRoot] < 0;
      this.successions.push({ tick: this.tick, realm: ps.realm, members, keep, heirShare: ps.heirShare, spread: ps.spread, survived });
      if (survived) {
        this.realmOf[bestRoot] = ps.realm;
        realm.sovereign = bestRoot;
        realm.rulers++;
        if (members >= this.p.govSize) {
          this.stats.successions++;
          const detail = `${realm.name} outlives its leader: ${Math.round(keep * 100)}% of ${members} regroup under a new leader.`;
          if (this.levels[L_GOVERNMENT] < 0 && this.levels[L_HIERARCHY] >= 0) this.reach(L_GOVERNMENT, `Government: ${detail}`, bestRoot);
          else this.emit('succession', detail, undefined, bestRoot);
        }
      } else {
        if (members >= this.p.govSize) {
          this.stats.fragmentations++;
          this.emit('fragment', `${realm.name} breaks apart after its leader dies (the largest piece keeps ${Math.round(keep * 100)}%).`);
        }
        this.endRealm(ps.realm);
      }
    }
    this.pending = still;
  }

  private births(): void {
    const { M, alive, energy, mass, p, pos, vel } = this;
    const firstNew = this.nextUid;
    const cap = Math.floor(p.maxN * 0.995);
    for (let i = 0; i < M; i++) {
      if (!alive[i] || this.uid[i] >= firstNew) continue;
      const m = mass[i];
      if (m < p.splitMass || energy[i] < p.splitAt * m || this.count >= cap) continue;
      const j = this.alloc();
      if (j < 0) return;
      // Fission: cut the body across its longest axis.
      const base = i * MAXB * 3;
      const ext = [0, 1, 2].map((a) => {
        let lo = 99;
        let hi = -99;
        for (let q = 0; q < m; q++) {
          lo = Math.min(lo, this.body[base + 3 * q + a]);
          hi = Math.max(hi, this.body[base + 3 * q + a]);
        }
        return hi - lo;
      });
      const axis = ext.indexOf(Math.max(...ext));
      const idx = Array.from({ length: m }, (_, q) => q).sort((a, b) => this.body[base + 3 * a + axis] - this.body[base + 3 * b + axis]);
      const keepN = Math.ceil(m / 2);
      const keep = idx.slice(0, keepN).map((q) => [this.body[base + 3 * q], this.body[base + 3 * q + 1], this.body[base + 3 * q + 2]]);
      const give = idx.slice(keepN).map((q) => [this.body[base + 3 * q], this.body[base + 3 * q + 1], this.body[base + 3 * q + 2]]);
      const recenter = (cells: number[][], slot: number) => {
        const c = [0, 1, 2].map((a) => Math.round(cells.reduce((s, v) => s + v[a], 0) / cells.length));
        const b = slot * MAXB * 3;
        cells.forEach((v, q) => {
          this.body[b + 3 * q] = v[0] - c[0];
          this.body[b + 3 * q + 1] = v[1] - c[1];
          this.body[b + 3 * q + 2] = v[2] - c[2];
        });
        this.mass[slot] = cells.length;
        this.updateRadius(slot);
        return c;
      };
      const ci = recenter(keep, i);
      const cj = recenter(give, j);
      const unit = this.cell * p.bodyScale;
      const ox = pos[3 * i];
      const oy = pos[3 * i + 1];
      const oz = pos[3 * i + 2];
      pos[3 * i] = clamp(ox + ci[0] * unit, -0.98, 0.98);
      pos[3 * i + 1] = clamp(oy + ci[1] * unit, -0.98, 0.98);
      pos[3 * i + 2] = clamp(oz + ci[2] * unit, -0.98, 0.98);
      pos[3 * j] = clamp(ox + cj[0] * unit, -0.98, 0.98);
      pos[3 * j + 1] = clamp(oy + cj[1] * unit, -0.98, 0.98);
      pos[3 * j + 2] = clamp(oz + cj[2] * unit, -0.98, 0.98);
      this.prev[3 * j] = pos[3 * j];
      this.prev[3 * j + 1] = pos[3 * j + 1];
      this.prev[3 * j + 2] = pos[3 * j + 2];
      vel[3 * j] = vel[3 * i];
      vel[3 * j + 1] = vel[3 * i + 1];
      vel[3 * j + 2] = vel[3 * i + 2];
      const e = energy[i] * (give.length / m);
      energy[i] -= e;
      energy[j] = e;
      this.tribe[j] = this.tribe[i];
      this.origin[j] = 2;
      this.age[j] = 0;
      this.root[j] = j;
      this.subMass[j] = this.mass[j];
      this.queueChoice(j);
      this.stats.births++;
    }
  }

  private regrow(): void {
    const { food, cap, p } = this;
    const r = p.regrow;
    for (let c = 0; c < food.length; c++) food[c] += r * (cap[c] - food[c]);
  }

  // ---------------------------------------------------------------- measurement

  /**
   * Syntropy of the social level: 1 minus the Shannon entropy of the partition of organisms into
   * polities, divided by its maximum (log N, everyone alone). 0 = everyone alone, 1 = one polity.
   */
  syntropy(): number {
    const N = this.count;
    if (N <= 1) return 0;
    let H = 0;
    for (let h = 0; h < this.rootCount; h++) {
      const q = this.subSize[this.order[h]] / N;
      H -= q * Math.log(q);
    }
    return 1 - H / Math.log(N);
  }

  private survey(): void {
    const { p, order, subSize, subDepth, tribeMask, realmOf, tribe, uid } = this;
    let realms = 0;
    let major = 0;
    let organized = 0;
    let largest = 0;
    let deepest = 0;
    let tribesLed = 0;
    let massSum = 0;
    let hierarchy: { r: number; tribes: number; depth: number } | null = null;
    for (let i = 0; i < this.M; i++) if (this.alive[i]) massSum += this.mass[i];
    for (let h = 0; h < this.rootCount; h++) {
      const r = order[h];
      const size = subSize[r];
      if (size >= p.tribeMin && this.kinCount[r] >= p.tribeKin * size) tribesLed++;
      if (size > largest) largest = size;
      let rid = realmOf[r];
      if (rid < 0 && size >= p.realmMin && !this.pendingUid.has(uid[r])) {
        rid = this.realms.length;
        this.realms.push({
          id: rid, name: groupName(tribe[r], this.nameCounts), tribe: tribe[r], founded: this.tick, ended: -1,
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
        const verb = ['comes together', 'forms', 'takes shape'][realm.id % 3];
        this.emit('realm', `${realm.name} ${verb}: ${size} organisms under one leader.`, undefined, r);
      }
      if (size >= p.hierSize && subDepth[r] >= p.hierDepth && realm.tribes >= p.hierTribes && size - this.kinCount[r] >= p.hierForeign * size) {
        if (!hierarchy || size > subSize[hierarchy.r]) hierarchy = { r, tribes: realm.tribes, depth: subDepth[r] };
      }
    }
    if (tribesLed >= p.tribeCount) this.reach(L_TRIBES, `Tribes: ${tribesLed} kin groups now follow leaders.`);
    if (hierarchy) {
      const name = this.realms[realmOf[hierarchy.r]].name;
      this.reach(L_HIERARCHY, `Hierarchy: ${name} has ${hierarchy.depth + 1} ranks and members from ${hierarchy.tribes} lineages.`, hierarchy.r);
    }
    if (deepest > this.stats.maxDepth) this.stats.maxDepth = deepest;
    if (largest > this.stats.maxRealm) this.stats.maxRealm = largest;
    if (this.count > this.stats.popPeak) this.stats.popPeak = this.count;
    this.history.push({
      tick: this.tick, pop: this.count, realms, major, organized, largest, depth: deepest,
      syntropy: this.syntropy(), meanMass: this.count ? massSum / this.count : 0,
    });
  }

  private reach(level: number, text: string, slot?: number): void {
    if (this.levels[level] >= 0 || this.levels[level - 1] < 0) return;
    this.levels[level] = this.tick;
    this.emit('level', text, level, slot);
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
    return `a small ${TRIBE_NAMES[this.tribe[rootSlot]]} group`;
  }

  emit(kind: EventKind, text: string, level?: number, slot?: number): void {
    const at = slot !== undefined && slot >= 0 && this.alive[slot] ? { slot, uid: this.uid[slot] } : {};
    this.events.push({ tick: this.tick, kind, text, level, ...at });
    this.emitted++;
    if (this.events.length > 600) this.events.splice(0, 100);
  }

  standingRealms(): Realm[] {
    return this.realms.filter((r) => r.ended < 0 && r.sovereign >= 0).sort((a, b) => b.size - a.size);
  }

  // ---------------------------------------------------------------- for viewers
  // Nothing below is called by step(). These let an observer look inside the world, and strike()
  // lets one reach in; the world's answer to a strike still comes from the rules above.

  /**
   * What organism i would weigh if it chose right now: every option with its terms, the option it
   * holds and the best one. Null for an organism too new to be in the neighbour grid.
   */
  explain(i: number): { options: Option[]; current: number; best: number } | null {
    if (i < 0 || !this.alive[i] || this.born[i] >= this.tick - 1 || this.tick < 2) return null;
    const options = this.weigh(i);
    const L = this.lord[i];
    let current = 0;
    let best = 0;
    for (let q = 0; q < options.length; q++) {
      if (options[q].lord === L) current = q;
      if (options[q].u > options[best].u) best = q;
    }
    return { options, current, best };
  }

  /**
   * A viewer removes an organism from outside the model. If it ruled a realm, the ordinary
   * succession test opens. The chronicle records the strike so the history stays honest.
   */
  strike(slot: number): boolean {
    if (slot < 0 || !this.alive[slot]) return false;
    const rid = this.lord[slot] < 0 ? this.realmOf[slot] : NONE;
    const who = rid >= 0 ? `the leader of ${this.realms[rid].name}` : `a ${TRIBE_NAMES[this.tribe[slot]]} organism`;
    this.emit('hand', `Intervention: ${who} is removed from outside the model.`);
    this.strikes++;
    this.kill(slot);
    return true;
  }

  /** Mean distance of a ruler's members from their centre, in perception radii (as in openSuccession). */
  cohesion(rootSlot: number): number {
    if (rootSlot < 0 || !this.alive[rootSlot]) return NaN;
    const members: number[] = [];
    const stack: number[] = [];
    for (let c = this.firstChild[rootSlot]; c >= 0; c = this.nextSib[c]) stack.push(c);
    let cx = 0;
    let cy = 0;
    let cz = 0;
    while (stack.length) {
      const k = stack.pop()!;
      members.push(k);
      cx += this.pos[3 * k];
      cy += this.pos[3 * k + 1];
      cz += this.pos[3 * k + 2];
      for (let c = this.firstChild[k]; c >= 0; c = this.nextSib[c]) stack.push(c);
    }
    const n = members.length;
    if (!n) return NaN;
    cx /= n;
    cy /= n;
    cz /= n;
    let spread = 0;
    for (const k of members) spread += Math.hypot(this.pos[3 * k] - cx, this.pos[3 * k + 1] - cy, this.pos[3 * k + 2] - cz);
    return spread / n / this.p.senseRadius;
  }

  /** Succession tests in progress, with how far each realm has regrouped so far. */
  watching(): SuccessionWatch[] {
    return this.pending.map((ps) => {
      const counts = new Map<number, number>();
      let alive = 0;
      let x = 0;
      let y = 0;
      let z = 0;
      const slots: number[] = [];
      for (let q = 0; q < ps.slots.length; q++) {
        const k = ps.slots[q];
        if (!this.alive[k] || this.uid[k] !== ps.uids[q]) continue;
        alive++;
        slots.push(k);
        x += this.pos[3 * k];
        y += this.pos[3 * k + 1];
        z += this.pos[3 * k + 2];
        const r = this.rootOf(k);
        counts.set(r, (counts.get(r) ?? 0) + 1);
      }
      let best = 0;
      for (const n of counts.values()) if (n > best) best = n;
      const realm = this.realms[ps.realm];
      const d = Math.max(1, alive);
      return {
        realm: ps.realm, name: realm.name, tribe: realm.tribe, start: ps.due - this.p.govWindow, due: ps.due,
        members: ps.slots.length, alive, slots, keep: best / Math.max(1, ps.slots.length), x: x / d, y: y / d, z: z / d,
      };
    });
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
