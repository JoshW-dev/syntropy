// The whole ladder, headless: Cells run until their forms hold, the forms become founders,
// and the Society runs from there. The browser app and the tuning scripts both use this.

import { CellsWorld, DEFAULT_CELLS, type CellsParams } from './cells.ts';
import { Society, DEFAULT_SOCIETY, type Founder, type SocietyParams } from './society.ts';
import { makeRng } from './rng.ts';

export const LADDER = ['Cells', 'Organisms', 'Tribes', 'Hierarchy', 'Government'] as const;

/**
 * Each form that held its shape becomes one founding organism, at the same place. Forms that
 * were still churning are left behind (unless too few held, then every form crosses over).
 * `label` is the form's index in cells.forms, for the lift animation.
 */
export function foundersFrom(cells: CellsWorld): (Founder & { label: number })[] {
  const G = cells.G;
  const all = cells.forms.map((f, label) => ({ f, label })).filter(({ f }) => f.cells >= cells.p.minForm);
  const held = all.filter(({ f }) => f.age >= cells.p.holdGens);
  const chosen = held.length >= 12 ? held : all;
  return chosen.map(({ f, label }) => ({
    x: (f.x / G) * 2 - 1,
    y: (f.y / G) * 2 - 1,
    z: (f.z / G) * 2 - 1,
    size: 0.55 + 0.18 * Math.cbrt(f.cells),
    tribe: f.lineage,
    label,
  }));
}

export interface WorldParams {
  cells: CellsParams;
  society: SocietyParams;
}

export const DEFAULT_WORLD: WorldParams = { cells: DEFAULT_CELLS, society: DEFAULT_SOCIETY };

/** Overlay partial overrides (e.g. from a tuning file or URL) on the defaults. */
export function withOverrides(overrides: { cells?: Partial<CellsParams>; society?: Partial<SocietyParams> } = {}): WorldParams {
  return {
    cells: { ...DEFAULT_CELLS, ...(overrides.cells ?? {}) },
    society: { ...DEFAULT_SOCIETY, ...(overrides.society ?? {}) },
  };
}

/** Run the Cells level to completion and build the Society from its forms. */
export function grow(seed: string, params: WorldParams = DEFAULT_WORLD): { cells: CellsWorld; society: Society } {
  const cells = new CellsWorld(params.cells, makeRng(`${seed}:cells`));
  while (!cells.complete) cells.step();
  cells.scanForms();
  const society = new Society(params.society, makeRng(`${seed}:society`), foundersFrom(cells));
  society.levels[0] = 0;
  society.levels[1] = 0;
  return { cells, society };
}
