// The list of realms: who rules, how many follow, how deep the chain of command runs and which
// lineages are inside. It is the legend for the picture. Pointing at a row lights that realm in the
// world and pales the rest; a click picks its ruler, which opens the card and moves the camera there.
// The list reads the same measurements as the ladder and changes nothing in the simulation.

import type { App } from '../app.ts';

/** Seconds between repaints. */
const REPAINT = 0.4;
const ROWS = 8;
/** Heights in px of the heading, one row and the closing line, to tell how many rows fit. */
const HEAD = 24;
const ROW = 27;
const REST = 24;
/** Room the two fold buttons take in the left column. */
const FOLDS = 56; // two buttons of 22px with their 6px gaps

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface Row {
  el: HTMLDivElement;
  dot: HTMLElement;
  name: HTMLElement;
  mix: HTMLElement;
  n: HTMLElement;
  d: HTMLElement;
  key: string;
}

export class Realms {
  private app: App;
  private el = $<HTMLElement>('realms');
  private list = $<HTMLDivElement>('realms-list');
  private rest = $<HTMLParagraphElement>('realms-rest');
  private left = this.el.parentElement as HTMLElement;
  private ladder = $<HTMLElement>('ladder');
  private rows: Row[] = [];
  private since = REPAINT;
  private hovered: HTMLElement | null = null;

  constructor(app: App) {
    this.app = app;
    for (let k = 0; k < ROWS + 1; k++) {
      const el = document.createElement('div');
      el.className = 'realm-row';
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.innerHTML = '<i class="opt-dot"></i><span class="realm-name"></span><span class="realm-mix"></span><span class="realm-n"></span><span class="realm-d"></span>';
      const [dot, name, mix, n, d] = [...el.children] as HTMLElement[];
      this.list.appendChild(el);
      this.rows.push({ el, dot, name, mix, n, d, key: '' });
      el.addEventListener('pointerenter', () => (this.hovered = el));
      el.addEventListener('pointerleave', () => {
        if (this.hovered === el) this.hovered = null;
      });
      const pick = () => {
        const slot = Number(el.dataset.slot);
        if (slot >= 0) app.select(slot);
      };
      el.addEventListener('click', pick);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          pick();
        }
      });
    }
    app.onStart.push(() => (this.since = REPAINT));
    app.onFrame.push((dt) => this.frame(dt));
  }

  private frame(dt: number): void {
    const { app } = this;
    // The lit realm follows the row under the pointer, even when the rows reorder beneath it.
    const slot = this.hovered && !this.el.hidden && this.hovered.dataset.realm === '1' ? Number(this.hovered.dataset.slot) : -1;
    app.spotRoot = slot;
    this.since += dt;
    if (this.since < REPAINT) return;
    this.since = 0;
    this.paint();
  }

  private paint(): void {
    const s = this.app.world.society;
    this.el.hidden = s.count === 0;
    if (s.count === 0) return;
    const standing = s.standingRealms();
    // Members of each realm by lineage, and everyone outside a realm.
    const mix = new Map<number, number[]>();
    for (const r of standing) mix.set(r.sovereign, [0, 0, 0, 0, 0, 0]);
    let outside = 0;
    let loner = -1;
    for (let i = 0; i < s.M; i++) {
      if (!s.alive[i]) continue;
      const m = mix.get(s.root[i]);
      if (m) m[s.tribe[i]]++;
      else {
        outside++;
        if (loner < 0 || s.mass[i] > s.mass[loner]) loner = i;
      }
    }
    // Show only whole rows: as many groups as fit between the ladder and the chronicle, with room
    // kept for the heading, the "In no group" row and the line that counts the rest.
    const room = this.left.clientHeight - this.ladder.offsetHeight - 6 - FOLDS;
    const fit = Math.floor((room - HEAD - ROW - REST) / ROW);
    const shown = standing.slice(0, Math.max(1, Math.min(ROWS, fit)));
    const picked = this.app.selected >= 0 ? s.rootOf(this.app.selected) : -1;
    this.rows.forEach((row, k) => {
      row.el.classList.toggle('sel', !!shown[k] && shown[k].sovereign === picked);
      const r = shown[k];
      const last = k === shown.length;
      if (!r && !last) {
        if (row.key !== '') {
          row.key = '';
          row.el.style.display = 'none';
        }
        return;
      }
      let key: string;
      let html: string[];
      if (r) {
        const m = mix.get(r.sovereign)!;
        const bars = m.map((n, t) => (n ? `<i style="flex:${n};background:var(--t${t})" title="${n} ${this.tribeName(t)}"></i>` : '')).join('');
        const ranks = r.depth + 1;
        // The count is the last survey's, the same number the labels and the readout show.
        html = [`var(--t${r.tribe})`, r.name, bars, String(r.size), `${ranks} rank${ranks === 1 ? '' : 's'}`];
        key = `r${r.sovereign}|${html.join('|')}`;
        row.el.dataset.slot = String(r.sovereign);
        row.el.dataset.realm = '1';
        row.el.title = `${r.name}: the ${ordinal(Number(r.name.split(' ')[1]))} group a ${this.tribeName(r.tribe)} leader founded. It formed in year ${Math.floor(r.founded / 100)} and is on leader number ${r.rulers}. Click to follow it.`;
      } else {
        html = ['', 'In no group', '', String(outside), ''];
        key = `o|${outside}`;
        row.el.dataset.slot = String(loner);
        row.el.dataset.realm = '0';
        row.el.title = 'Organisms that follow no one, or sit in a group too small to count. Click to pick one.';
      }
      if (key === row.key) return;
      row.key = key;
      row.el.style.display = '';
      row.el.classList.toggle('out', !r);
      row.dot.style.background = html[0];
      row.name.textContent = html[1];
      row.name.style.color = html[0];
      row.mix.innerHTML = html[2];
      row.n.textContent = html[3];
      row.d.textContent = html[4];
    });
    const more = standing.length - shown.length;
    const text = standing.length === 0 ? 'No group yet. A group is five or more organisms under one leader.' : more > 0 ? `and ${more} smaller group${more === 1 ? '' : 's'} of ${s.p.realmMin} or more` : '';
    if (this.rest.textContent !== text) this.rest.textContent = text;
    this.rest.hidden = text === '';
  }

  private tribeName(t: number): string {
    return ['Blue', 'Red', 'Gold', 'Green', 'Violet', 'Rose'][t] ?? '';
  }
}

function ordinal(n: number): string {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${tail}`;
}
