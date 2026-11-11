// The text layer: the ladder of levels, the chronicle, controls, readouts, realm labels and a
// hover tip. Text is the legend: tribe and realm names appear in their stroke colour. Those colours
// are custom properties (--t0 to --t5), so a new theme recolours lines already on screen.

import { TRIBE_NAMES } from '../sim/names.ts';
import type { Theme } from '../render/theme.ts';

export interface Step {
  name: string;
  rule: string;
  done: string;
}

export interface Handlers {
  pause(): void;
  speed(n: number): void;
  newWorld(): void;
  share(): Promise<boolean>;
  skip(): void;
}

export interface Label {
  x: number;
  y: number;
  name: string;
  size: number;
  tribe: number;
  /** The ruler's slot, so a click on the label can pick it. */
  slot: number;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Hud {
  private ladder = $<HTMLOListElement>('ladder');
  private chronicle = $<HTMLElement>('chronicle');
  private readout = $<HTMLDListElement>('readout');
  private labels = $<HTMLDivElement>('labels');
  private tip = $<HTMLDivElement>('tip');
  private pauseBtn = $<HTMLButtonElement>('pause');
  private skipBtn = $<HTMLButtonElement>('skip');
  private seedLabel = $<HTMLSpanElement>('seed-label');
  private speedBtns: HTMLButtonElement[];
  private rows: HTMLLIElement[] = [];
  private labelEls: HTMLDivElement[] = [];
  private lines: HTMLParagraphElement[] = [];
  private realmTribe = new Map<string, number>();
  private readoutKey = '';

  constructor(steps: Step[], handlers: Handlers) {
    this.setSteps(steps);
    this.speedBtns = [...document.querySelectorAll<HTMLButtonElement>('#speed button')];
    this.pauseBtn.addEventListener('click', () => handlers.pause());
    this.skipBtn.addEventListener('click', () => handlers.skip());
    $('new').addEventListener('click', () => handlers.newWorld());
    const share = $<HTMLButtonElement>('share');
    share.addEventListener('click', async () => {
      const ok = await handlers.share();
      share.textContent = ok ? 'Link copied' : 'Copy failed';
      setTimeout(() => (share.textContent = 'Share'), 1600);
    });
    for (const b of this.speedBtns) b.addEventListener('click', () => handlers.speed(Number(b.dataset.speed)));
  }

  setSteps(steps: Step[]): void {
    this.ladder.replaceChildren();
    this.rows = [];
    for (const [i, s] of steps.entries()) {
      const li = document.createElement('li');
      li.className = 'step';
      li.dataset.state = 'next';
      li.innerHTML = `<span class="mark" aria-hidden="true"></span><div class="body"><div class="head"><span class="num">${i + 1}</span><span class="name">${s.name}</span><span class="when"></span></div><p class="rule">${s.rule}</p><p class="crit">${s.done}</p></div>`;
      this.ladder.appendChild(li);
      this.rows.push(li);
    }
  }

  /** Apply a theme's HUD colours and use its tribe strokes for names in text. */
  setTheme(theme: Theme): void {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(theme.css)) root.style.setProperty(k, v);
    theme.strokes.forEach((c, i) => root.style.setProperty(`--t${i}`, c));
    root.style.colorScheme = theme.dark ? 'dark' : '';
    root.dataset.theme = theme.id;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.ground);
  }

  /**
   * `reached[i]` is the label for a reached level ("gen 64", "year 12") or null. The highest level
   * reached is where the world is now, and it shows its rule. The level after it shows what would
   * count as reaching it. So a fresh world reads as Cells, with Organisms as the next thing to watch for.
   */
  setLadder(reached: (string | null)[]): void {
    let now = 0;
    reached.forEach((r, i) => {
      if (r !== null) now = i;
    });
    this.rows.forEach((li, i) => {
      const state = i < now ? 'done' : i === now ? 'now' : i === now + 1 ? 'up' : 'next';
      if (li.dataset.state !== state) li.dataset.state = state;
      const when = li.querySelector('.when')!;
      const text = reached[i] ?? '';
      if (when.textContent !== text) when.textContent = text;
    });
  }

  setPaused(paused: boolean): void {
    this.pauseBtn.classList.toggle('paused', paused);
    this.pauseBtn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
  }

  setSpeed(n: number): void {
    for (const b of this.speedBtns) b.setAttribute('aria-checked', String(Number(b.dataset.speed) === n));
  }

  setSkippable(on: boolean): void {
    this.skipBtn.hidden = !on;
  }

  setSeed(seed: string): void {
    this.seedLabel.textContent = `world ${seed}`;
  }

  rememberRealm(name: string, tribe: number): void {
    this.realmTribe.set(name, tribe);
  }

  clearChronicle(): void {
    this.chronicle.replaceChildren();
    this.lines = [];
    this.realmTribe.clear();
  }

  /** Add one chronicle line. Older lines fade; four stay visible. */
  push(when: string, text: string, kind: string): void {
    const p = document.createElement('p');
    p.className = `ev ev-${kind}`;
    const yr = document.createElement('span');
    yr.className = 'yr';
    yr.textContent = when;
    p.appendChild(yr);
    p.insertAdjacentHTML('beforeend', ` ${this.colorize(text)}`);
    this.chronicle.appendChild(p);
    this.lines.push(p);
    while (this.lines.length > 5) this.lines.shift()!.remove();
    const n = this.lines.length;
    this.lines.forEach((el, i) => (el.style.opacity = String([1, 0.7, 0.45, 0.28, 0.16][n - 1 - i] ?? 0.1)));
  }

  /** Escape a line of chronicle text and colour the realm and tribe names in it. */
  colorize(text: string): string {
    const esc = text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
    // A group's name is a lineage and a number ("Blue 3"), and a lineage alone is one capitalised
    // word. Colour each one that we know, the group's number included.
    return esc.replace(/\b([A-Z][a-z]+)( \d+)?\b/g, (m, word: string, num?: string) => {
      const group = num ? this.realmTribe.get(m) : undefined;
      if (group !== undefined) return `<b style="color:var(--t${group})">${m}</b>`;
      const t = TRIBE_NAMES.indexOf(word as (typeof TRIBE_NAMES)[number]);
      return t >= 0 ? `<b style="color:var(--t${t})">${word}</b>${num ?? ''}` : m;
    });
  }

  setReadout(items: [string, string][]): void {
    const key = items.map((i) => i.join(':')).join('|');
    if (key === this.readoutKey) return;
    this.readoutKey = key;
    this.readout.replaceChildren(
      ...items.flatMap(([k, v]) => {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        return [dt, dd];
      }),
    );
  }

  setLabels(list: Label[]): void {
    while (this.labelEls.length < list.length) {
      const el = document.createElement('div');
      el.className = 'label';
      this.labels.appendChild(el);
      this.labelEls.push(el);
    }
    this.labelEls.forEach((el, i) => {
      const l = list[i];
      if (!l || !Number.isFinite(l.x)) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      el.style.transform = `translate(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px) translate(-50%, -100%)`;
      // The size goes in brackets, so it does not run into the number in the name.
      const html = `<b style="color:var(--t${l.tribe})">${l.name}</b> <span>(${l.size})</span>`;
      if (el.innerHTML !== html) el.innerHTML = html;
      el.dataset.slot = String(l.slot);
    });
  }

  setTip(x: number, y: number, html: string | null): void {
    if (!html) {
      this.tip.hidden = true;
      return;
    }
    this.tip.hidden = false;
    if (this.tip.innerHTML !== html) this.tip.innerHTML = html;
    this.tip.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 14)}px)`;
  }

  tribeWord(t: number): string {
    return `<b style="color:var(--t${t})">${TRIBE_NAMES[t]}</b>`;
  }
}
