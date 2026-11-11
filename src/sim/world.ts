// One continuous world. The lattice runs from the start; whenever a form has held its shape long
// enough it comes loose and becomes an organism made of exactly those cells, in exactly that place,
// while the rest of the lattice keeps going. Nothing resets between levels. Once the lattice stands
// still or repeats a short cycle for long enough, the cells it has left can never come loose, so it
// ends and they dissolve. The organisms never read the lattice, so ending it changes nothing they do.

import { CellsWorld, DEFAULT_CELLS, type CellsParams } from './cells.ts';
import { Society, DEFAULT_SOCIETY, FOOD_MAPS, type FoodMap, type SocietyParams } from './society.ts';
import { makeRng, type Rng } from './rng.ts';

export const LADDER = ['Cells', 'Organisms', 'Tribes', 'Hierarchy', 'Government'] as const;

/**
 * How forms become founders. 'lattice' (the model): each form keeps its place and lineage.
 * 'shuffled' and 'scattered' are controls for the paper: same forms and timing, but with lineage
 * randomised, or with each form dropped at a random place, to test what the lower level passes up.
 */
export type FounderMode = 'lattice' | 'shuffled' | 'scattered';

export interface WorldParams {
  cells: CellsParams;
  society: SocietyParams;
  /** Society ticks per lattice generation. */
  ticksPerGen: number;
  founders: FounderMode;
  /** Fertile zones at the lineage homelands (true, the model) or at random places (a control). */
  homelands: boolean;
}

export const DEFAULT_WORLD: WorldParams = { cells: DEFAULT_CELLS, society: DEFAULT_SOCIETY, ticksPerGen: 15, founders: 'lattice', homelands: true };

export type Overrides = { cells?: Partial<CellsParams>; society?: Partial<SocietyParams>; ticksPerGen?: number; founders?: FounderMode; homelands?: boolean };

/**
 * The food maps a viewer can pick. Total food is a multiple of what the zones hold, and each map
 * comes with the multiple at which a typical world holds 400 to 900 organisms, well under maxN
 * (16 worlds each, 120 years). At 1 the plain holds about 270 organisms and the islands fill maxN.
 */
export const FOOD_PRESETS: readonly { map: FoodMap; capacity: number }[] = [
  { map: 'zones', capacity: 1 },
  { map: 'plain', capacity: 1.25 },
  { map: 'islands', capacity: 0.65 },
  { map: 'halves', capacity: 1 },
];

/** Overlay partial overrides (from a tuning file, the environment panel or a URL) on the defaults. */
export function withOverrides(o: Overrides = {}): WorldParams {
  const society = { ...DEFAULT_SOCIETY, ...(o.society ?? {}) };
  // A link can carry anything: an unknown map or a capacity that is not a positive number falls back.
  if (!FOOD_MAPS.includes(society.foodMap)) society.foodMap = DEFAULT_SOCIETY.foodMap;
  if (!(Number.isFinite(society.foodCapacity) && society.foodCapacity > 0)) society.foodCapacity = DEFAULT_SOCIETY.foodCapacity;
  return {
    cells: { ...DEFAULT_CELLS, ...(o.cells ?? {}) },
    society,
    ticksPerGen: o.ticksPerGen ?? DEFAULT_WORLD.ticksPerGen,
    founders: o.founders ?? DEFAULT_WORLD.founders,
    homelands: o.homelands ?? DEFAULT_WORLD.homelands,
  };
}

export class World {
  readonly params: WorldParams;
  readonly seed: string;
  readonly cells: CellsWorld;
  readonly society: Society;
  tick = 0;
  /** The lattice ends once it is empty, settled or old, and any cells left then dissolve. */
  latticeActive = true;
  /** Why the lattice ended, or '' while it runs. */
  latticeEnd: '' | 'empty' | 'settled' | 'old' = '';
  /** Tick at which the lattice ended, or -1 while it runs. */
  latticeEndTick = -1;
  /** The cycle the lattice had settled into when it ended (1 = still), or 0. */
  latticePeriod = 0;
  /** Cells left on the lattice when it ended. */
  dissolved = 0;
  /** Tick of the last lattice generation, for animating births and deaths between generations. */
  lastGenTick = 0;
  private controlRng: Rng;

  constructor(seed: string, params: WorldParams = DEFAULT_WORLD) {
    this.seed = seed;
    this.params = params;
    this.cells = new CellsWorld(params.cells, makeRng(`${seed}:cells`));
    this.controlRng = makeRng(`${seed}:control`);
    const G = params.cells.size;
    const homelands = this.cells.sporeCenters.map((c) => ({ x: (c.x / G) * 2 - 1, y: (c.y / G) * 2 - 1, z: (c.z / G) * 2 - 1 }));
    this.society = new Society({ ...params.society, latticeSize: G }, makeRng(`${seed}:society`), params.homelands ? homelands : undefined);
  }

  step(): void {
    if (this.latticeActive && this.tick % this.params.ticksPerGen === 0) {
      this.cells.step();
      this.lastGenTick = this.tick;
      if (this.cells.generation % 5 === 0) this.detach();
      const { cells } = this;
      if (cells.population === 0) this.endLattice('empty');
      else if (cells.settled) this.endLattice('settled');
      else if (cells.generation >= this.params.cells.maxGens) this.endLattice('old');
    }
    this.society.step();
    this.tick++;
  }

  /** Stop the lattice and dissolve whatever it has left: none of it can come loose any more. */
  private endLattice(why: 'empty' | 'settled' | 'old'): void {
    this.latticeActive = false;
    this.latticeEnd = why;
    this.latticeEndTick = this.tick;
    this.latticePeriod = why === 'settled' ? this.cells.period : 0;
    this.dissolved = this.cells.dissolve();
    if (this.dissolved > 0) {
      const how = why !== 'settled' ? 'ends' : this.latticePeriod === 1 ? 'goes still' : `settles into a ${this.latticePeriod}-generation cycle`;
      this.society.emit('life', `The lattice ${how}. Its last ${this.dissolved.toLocaleString('en-US')} cells could never come loose, and they dissolve.`);
    }
  }

  /** Lift every form that has held for holdGens generations off the lattice. */
  private detach(): void {
    const { cells } = this;
    const held = new Set<number>();
    cells.forms.forEach((f, label) => {
      if (f.cells >= cells.p.minForm && f.age >= cells.p.holdGens) held.add(label);
    });
    if (!held.size) return;
    const lineages = new Map<number, number>();
    for (const l of held) lineages.set(l, cells.forms[l].lineage);
    const G = cells.G;
    for (const [label, coords] of cells.extract(held)) {
      let lineage = lineages.get(label)!;
      if (this.params.founders === 'shuffled') lineage = this.controlRng.int(cells.p.lineages);
      if (this.params.founders === 'scattered') {
        // Same shape, new place: shift the whole form to a random spot inside the lattice.
        const lo = [G, G, G];
        const hi = [0, 0, 0];
        for (let k = 0; k < coords.length; k += 3) {
          for (let a = 0; a < 3; a++) {
            lo[a] = Math.min(lo[a], coords[k + a]);
            hi[a] = Math.max(hi[a], coords[k + a]);
          }
        }
        const shift = [0, 1, 2].map((a) => Math.floor(this.controlRng.range(2, G - 2 - (hi[a] - lo[a]))) - lo[a]);
        for (let k = 0; k < coords.length; k += 3) for (let a = 0; a < 3; a++) coords[k + a] += shift[a];
      }
      this.society.spawnForm(coords, lineage);
    }
  }

  run(ticks: number): void {
    while (this.tick < ticks) this.step();
  }
}

/** Build a world; the headless scripts and the browser both start here. */
export function grow(seed: string, params: WorldParams = DEFAULT_WORLD): World {
  return new World(seed, params);
}
