// The climate dial: where the world is in its food cycle. One cycle is drawn as a wave, a dot marks
// the present, and the words beside it give the food the water can hold now and whether that is
// rising or falling. With the cycle off there is no dial. It reads the simulation and changes
// nothing in it.

import type { App } from '../app.ts';
import { CLIMATE_MAX_SWING } from '../sim/world.ts';

const W = 56;
const H = 20;
const PAD = 3;

export class Climate {
  private app: App;
  private row = document.createElement('div');
  private wave: SVGPathElement;
  private dot: SVGCircleElement;
  private value: HTMLSpanElement;
  private word: HTMLSpanElement;
  private on = false;
  private amp = 0;

  constructor(app: App) {
    this.app = app;
    this.row.className = 'clim';
    this.row.innerHTML =
      '<dt title="The food the water can hold now, as a share of the usual. It rises and falls on one slow cycle.">Food</dt>' +
      `<dd><svg class="clim-wave" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">` +
      `<line x1="${PAD}" y1="${H / 2}" x2="${W - PAD}" y2="${H / 2}" /><path /><circle r="2.6" /></svg>` +
      '<span class="clim-v"></span><span class="clim-w"></span></dd>';
    this.wave = this.row.querySelector('path')!;
    this.dot = this.row.querySelector('circle')!;
    this.value = this.row.querySelector('.clim-v')!;
    this.word = this.row.querySelector('.clim-w')!;
    app.onStart.push(() => this.start());
    app.onFrame.push(() => this.frame());
    this.start();
  }

  /** The dial's point for a share of the cycle from 0 to 1. */
  private point(share: number): [number, number] {
    return [PAD + share * (W - 2 * PAD), H / 2 - this.amp * Math.sin(2 * Math.PI * share)];
  }

  private start(): void {
    const s = this.app.world.society;
    this.on = s.climateOn;
    this.app.hud.setReadoutExtra(this.on ? this.row : null);
    document.documentElement.classList.toggle('clim-on', this.on);
    if (!this.on) return;
    // A mild cycle draws a lower wave than a strong one.
    this.amp = (H / 2 - PAD) * Math.min(1, s.p.climateSwing / CLIMATE_MAX_SWING);
    const pts = Array.from({ length: 41 }, (_, k) => this.point(k / 40).map((v) => v.toFixed(1)).join(' '));
    this.wave.setAttribute('d', `M${pts.join('L')}`);
    this.frame();
  }

  private frame(): void {
    if (!this.on) return;
    const s = this.app.world.society;
    const period = s.p.climatePeriod;
    const [x, y] = this.point((s.tick % period) / period);
    this.dot.setAttribute('cx', x.toFixed(1));
    this.dot.setAttribute('cy', y.toFixed(1));
    const value = `${Math.round(s.climateAt() * 100)}%`;
    const word = s.climateRising() ? 'rising' : 'falling';
    if (this.value.textContent !== value) this.value.textContent = value;
    if (this.word.textContent !== word) {
      this.word.textContent = word;
      // A narrow stage shows an arrow in place of the word.
      this.word.dataset.dir = word === 'rising' ? 'up' : 'down';
    }
  }
}
