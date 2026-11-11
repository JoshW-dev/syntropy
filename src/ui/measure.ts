// The fingerprint, live: outside measures of this world's society, in the Environment panel beside
// the settings that move them. Most are averages over the world's last ten years, and regrouping
// counts the whole run. A world with two kinds of water is measured once per water, side by side,
// so the two societies in it can be compared. It reads the simulation and changes nothing in it.

import { TICKS_PER_YEAR, type App } from '../app.ts';
import { REGROUP_MIN, census, fingerprint, waterRegions, type Census, type Fingerprint, type Region } from '../sim/score.ts';

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
const blank = (v: number, text: (v: number) => string) => (Number.isNaN(v) ? '-' : text(v));

interface Tile {
  value: HTMLElement;
  label: HTMLElement;
}

/** One part of the world being measured: all of it, or one of its two waters. */
interface Part {
  name: string;
  has?: Region;
  censuses: Census[];
}

const PART_NAMES: Record<string, string> = { murky: 'Murky water', clear: 'Clear water' };

export class Measure {
  private app: App;
  private el = $<HTMLElement>('fp');
  private when = $<HTMLSpanElement>('fp-when');
  private table = $<HTMLTableElement>('fp-table');
  private tiles: Tile[] = [];
  private whole: Part = { name: 'world', censuses: [] };
  private parts: Part[] = [];
  private since = REPAINT;
  private fresh = true;
  private tableKey = '';

  constructor(app: App) {
    this.app = app;
    const list = $<HTMLDListElement>('fp-list');
    for (let k = 0; k < 6; k++) {
      const cell = document.createElement('div');
      cell.innerHTML = '<dd></dd><dt></dt>';
      list.appendChild(cell);
      this.tiles.push({ value: cell.firstElementChild as HTMLElement, label: cell.lastElementChild as HTMLElement });
    }
    app.onStart.push(() => this.reset());
    app.onSurvey.push(() => this.survey());
    app.onFrame.push((dt) => {
      this.since += dt;
      if (!this.fresh || this.since < REPAINT) return;
      this.since = 0;
      this.fresh = false;
      this.paint();
    });
    this.reset();
    this.paint();
  }

  /** The fingerprint of the last ten years: the whole world, then each water when there are two. */
  read(): { world: Fingerprint; parts: { name: string; fingerprint: Fingerprint }[] } {
    const s = this.app.world.society;
    return {
      world: fingerprint(s, this.whole.censuses),
      parts: this.parts.map((p) => ({ name: p.name, fingerprint: fingerprint(s, p.censuses, p.has) })),
    };
  }

  private reset(): void {
    this.whole = { name: 'world', censuses: [] };
    this.parts = waterRegions(this.app.world.society).map((r) => ({ name: r.name, has: r.has, censuses: [] }));
    this.fresh = true;
  }

  private survey(): void {
    const s = this.app.world.society;
    const last = this.whole.censuses[this.whole.censuses.length - 1];
    if (last && s.tick - last.tick < EVERY) return;
    for (const part of [this.whole, ...this.parts]) {
      part.censuses.push(census(s, part.has));
      if (part.censuses.length > KEEP) part.censuses.shift();
    }
    this.fresh = true;
  }

  private paint(): void {
    const s = this.app.world.society;
    const { world: f, parts } = this.read();
    const some = f.pop > 0;
    // Before the first organism there is nothing to measure, and the block says so.
    this.el.classList.toggle('empty', !some);
    this.el.classList.toggle('two', parts.length === 2);
    const years = Math.round((f.to - f.from) / TICKS_PER_YEAR);
    const span = some && years > 0 ? `last ${years} year${years === 1 ? '' : 's'}` : '';
    if (this.when.textContent !== span) this.when.textContent = span;
    if (parts.length === 2) {
      this.paintTable(parts);
      return;
    }
    const show = (v: number, text: (v: number) => string) => (some ? blank(v, text) : '-');
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

  /** Two waters: one column each, so the same measure reads across. */
  private paintTable(parts: { name: string; fingerprint: Fingerprint }[]): void {
    const s = this.app.world.society;
    const rows: [string, (f: Fingerprint) => string, string][] = [
      ['organisms', (f) => blank(f.pop, (v) => v.toFixed(0)), 'Organisms that sit in this water.'],
      [`in groups of ${s.p.notableSize} or more`, (f) => blank(f.inGroups, pct), 'Share of the organisms here whose group has that many members, wherever the members are.'],
      [`outside any group of ${s.p.realmMin}`, (f) => blank(f.outside, pct), 'Share of the organisms here that follow no one, or sit in a smaller group.'],
      ['others in view', (f) => blank(f.inView, (v) => v.toFixed(1)), 'How many others an organism here can see. It sees less far in murky water.'],
      ['ranks below a leader', (f) => blank(f.ranks, (v) => v.toFixed(1)), 'The deepest chain in each group led from this water, averaged.'],
      ['fights per 1,000 in 10 years', (f) => blank(f.fights, (v) => v.toFixed(0)), 'Fights that happened in this water, per 1,000 organisms here.'],
      [`groups of ${REGROUP_MIN}+ that outlived their leader`, (f) => (f.leaderDeaths ? `${pct(f.regroup)} of ${f.leaderDeaths}` : '-'), 'Over the whole run, by where the group was when its leader died.'],
      ['follow a leader in the other water', (f) => blank(f.across, pct), 'Share of the organisms here whose top leader sits in the other water.'],
    ];
    const head = `<tr><th></th>${parts.map((p) => `<th>${PART_NAMES[p.name] ?? p.name}</th>`).join('')}</tr>`;
    const body = rows.map(([label, cell, title]) => `<tr title="${title}"><th>${label}</th>${parts.map((p) => `<td>${cell(p.fingerprint)}</td>`).join('')}</tr>`).join('');
    const html = head + body;
    if (html === this.tableKey) return;
    this.tableKey = html;
    this.table.innerHTML = html;
  }
}
