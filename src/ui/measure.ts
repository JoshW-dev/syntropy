// The fingerprint, live: six of the outside measures of this world's society, in the Environment
// panel beside the settings that move them. Four are averages over the world's last ten years, and
// two are counts over its whole run. It reads the simulation and changes nothing in it.

import { TICKS_PER_YEAR, type App } from '../app.ts';
import { REGROUP_MIN, census, fingerprint, type Census, type Fingerprint } from '../sim/score.ts';

/**
 * Ticks between censuses, and how many are kept. The society surveys itself every 30 ticks, so a
 * census every third survey and twelve of them span 990 ticks: ten years.
 */
const EVERY = 90;
const KEEP = 12;
/** Seconds between repaints. */
const REPAINT = 0.5;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pct = (v: number) => `${Math.round(v * 100)}%`;

interface Tile {
  value: HTMLElement;
  label: HTMLElement;
}

export class Measure {
  private app: App;
  private el = $<HTMLElement>('fp');
  private when = $<HTMLSpanElement>('fp-when');
  private tiles: Tile[] = [];
  private censuses: Census[] = [];
  private since = REPAINT;
  private fresh = true;

  constructor(app: App) {
    this.app = app;
    const list = $<HTMLDListElement>('fp-list');
    for (let k = 0; k < 6; k++) {
      const cell = document.createElement('div');
      cell.innerHTML = '<dd></dd><dt></dt>';
      list.appendChild(cell);
      this.tiles.push({ value: cell.firstElementChild as HTMLElement, label: cell.lastElementChild as HTMLElement });
    }
    app.onStart.push(() => {
      this.censuses = [];
      this.fresh = true;
    });
    app.onSurvey.push(() => this.survey());
    app.onFrame.push((dt) => {
      this.since += dt;
      if (!this.fresh || this.since < REPAINT) return;
      this.since = 0;
      this.fresh = false;
      this.paint();
    });
    this.paint();
  }

  /** The fingerprint of the last ten years, for tests and the console. */
  read(): Fingerprint {
    return fingerprint(this.app.world.society, this.censuses);
  }

  private survey(): void {
    const s = this.app.world.society;
    const last = this.censuses[this.censuses.length - 1];
    if (last && s.tick - last.tick < EVERY) return;
    this.censuses.push(census(s));
    if (this.censuses.length > KEEP) this.censuses.shift();
    this.fresh = true;
  }

  private paint(): void {
    const s = this.app.world.society;
    const f = this.read();
    const some = f.pop > 0;
    // Before the first organism there is nothing to measure, and the block says so.
    this.el.classList.toggle('empty', !some);
    const years = Math.round((f.to - f.from) / TICKS_PER_YEAR);
    const span = some && years > 0 ? `last ${years} year${years === 1 ? '' : 's'}` : '';
    if (this.when.textContent !== span) this.when.textContent = span;
    const show = (v: number, text: (v: number) => string) => (some && !Number.isNaN(v) ? text(v) : '-');
    const rows: [string, string][] = [
      [show(f.inGroups, pct), `live in groups of ${s.p.notableSize} or more`],
      [show(f.outside, pct), `live outside any group of ${s.p.realmMin}`],
      [show(f.inView, (v) => v.toFixed(1)), 'others in view of each organism'],
      [show(f.ranks, (v) => v.toFixed(1)), 'ranks below a leader'],
      [show(f.fights, (v) => v.toFixed(0)), 'fights per 1,000 organisms in 10 years'],
      [show(f.regroup, pct), f.leaderDeaths ? `of ${f.leaderDeaths} groups of ${REGROUP_MIN}+ outlived their leader` : `of groups of ${REGROUP_MIN}+ outlive their leader`],
    ];
    rows.forEach(([value, label], k) => {
      const t = this.tiles[k];
      if (t.value.textContent !== value) t.value.textContent = value;
      if (t.label.textContent !== label) t.label.textContent = label;
    });
  }
}
