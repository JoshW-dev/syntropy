// One continuous world. The lattice runs from the start; whenever a form has held its shape long
// enough it comes loose and becomes an organism made of exactly those cells, in exactly that place,
// while the rest of the lattice keeps going. Nothing resets between levels.

import { CellsWorld, DEFAULT_CELLS, type CellsParams } from './cells.ts';
import { Society, DEFAULT_SOCIETY, type SocietyParams } from './society.ts';
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

/** Overlay partial overrides (from a tuning file, the environment panel or a URL) on the defaults. */
export function withOverrides(o: Overrides = {}): WorldParams {
  return {
    cells: { ...DEFAULT_CELLS, ...(o.cells ?? {}) },
    society: { ...DEFAULT_SOCIETY, ...(o.society ?? {}) },
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
  /** The lattice stops once it is empty or old; whatever is left stays as it is. */
  latticeActive = true;
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
      if (this.cells.population === 0 || this.cells.generation >= this.params.cells.maxGens) this.latticeActive = false;
    }
    this.society.step();
    this.tick++;
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
