// Draws the lattice: one shaded, ink-edged cube per live cell. Newborn cells grow in and dying
// cells shrink away between generations, so the rule reads as motion, not flicker. Cells that come
// loose as an organism leave without a death animation, because the organism's body takes their place.
// When the lattice ends, its last cells are drawn as dying and the app slows their shrink to a
// couple of seconds, then empties the layer.

import type { CellsWorld } from '../sim/cells.ts';
import { CubeLayer } from './cubes.ts';
import { hexToRgb } from './palette.ts';
import type { Theme } from './theme.ts';

const STEADY = 0;
const BORN = 1;
const DIED = 2;
const BASE = 0.84;

export class Voxels {
  readonly layer: CubeLayer;
  private kinds: Uint8Array;
  private readonly G: number;
  private fills: [number, number, number][];
  private lineage: Uint8Array;

  constructor(world: CellsWorld, theme: Theme) {
    this.G = world.G;
    this.layer = new CubeLayer(24000, 2 / this.G);
    this.kinds = new Uint8Array(this.layer.capacity);
    this.lineage = new Uint8Array(this.layer.capacity);
    this.fills = theme.fills.map(hexToRgb);
    this.layer.setTheme(theme);
    this.sync(world);
  }

  setTheme(theme: Theme): void {
    this.fills = theme.fills.map(hexToRgb);
    this.layer.setTheme(theme);
    const { colors } = this.layer;
    for (let n = 0; n < this.layer.count; n++) {
      const c = this.fills[this.lineage[n]];
      colors[3 * n] = c[0];
      colors[3 * n + 1] = c[1];
      colors[3 * n + 2] = c[2];
    }
    this.layer.commit(this.layer.count, { colors: true });
  }

  /** Rebuild the instance list after a generation: steady, newborn and dying cells. */
  sync(world: CellsWorld): void {
    const { G } = this;
    const { alive, prevAlive, lineage, prevLineage, N } = world;
    const { offsets, colors, capacity } = this.layer;
    const G2 = G * G;
    const scale = 2 / G;
    let n = 0;
    for (let i = 0; i < N && n < capacity; i++) {
      const a = alive[i];
      const b = prevAlive[i];
      if (!a && !b) continue;
      offsets[3 * n] = ((i % G) + 0.5) * scale - 1;
      offsets[3 * n + 1] = ((Math.floor(i / G) % G) + 0.5) * scale - 1;
      offsets[3 * n + 2] = (Math.floor(i / G2) + 0.5) * scale - 1;
      const lin = a ? lineage[i] : prevLineage[i];
      this.lineage[n] = lin;
      const c = this.fills[lin];
      colors[3 * n] = c[0];
      colors[3 * n + 1] = c[1];
      colors[3 * n + 2] = c[2];
      this.kinds[n] = a && b ? STEADY : a ? BORN : DIED;
      n++;
    }
    this.layer.commit(n, { offsets: true, colors: true });
    this.animate(0);
  }

  /** t in [0, 1]: progress from the previous generation to the current one. */
  animate(t: number): void {
    const grow = 1 - (1 - t) * (1 - t);
    const fade = 1 - t * t;
    const { scales, count } = this.layer;
    for (let k = 0; k < count; k++) {
      const kind = this.kinds[k];
      scales[k] = BASE * (kind === STEADY ? 1 : kind === BORN ? grow : fade);
    }
    this.layer.commit(count, { scales: true });
  }

  /** Draw nothing until the next sync. */
  clear(): void {
    if (this.layer.count) this.layer.commit(0, {});
  }

  dispose(): void {
    this.layer.dispose();
  }
}
