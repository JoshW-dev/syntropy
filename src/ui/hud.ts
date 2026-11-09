// The text layer: the ladder of levels, the chronicle, controls, readouts, realm labels and a
// hover tip. Text is the legend: tribe and realm names appear in their stroke colour.

import { TRIBE_NAMES } from '../sim/names.ts';
import { TRIBE_STROKE } from '../render/palette.ts';

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
    for (const [i, s] of steps.entries()) {
      const li = document.createElement('li');
      li.className = 'step';
      li.dataset.state = 'next';
      li.innerHTML = `<span class="mark" aria-hidden="true"></span><div class="body"><div class="head"><span class="num">${i + 1}</span><span class="name">${s.name}</span><span class="when"></span></div><p class="rule">${s.rule}</p><p class="crit">${s.done}</p></div>`;
      this.ladder.appendChild(li);
      this.rows.push(li);
    }
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

  /** `reached[i]` is the label for a reached level ("gen 64", "year 12") or null. */
  setLadder(reached: (string | null)[]): void {
    const now = reached.findIndex((r) => r === null);
    this.rows.forEach((li, i) => {
      const state = reached[i] !== null ? 'done' : i === now ? 'now' : 'next';
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

  private colorize(text: string): string {
    const esc = text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
    const names = [...this.realmTribe.keys(), ...TRIBE_NAMES];
    if (!names.length) return esc;
    const re = new RegExp(`\\b(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g');
    return esc.replace(re, (m) => {
      const t = this.realmTribe.get(m) ?? TRIBE_NAMES.indexOf(m as (typeof TRIBE_NAMES)[number]);
      return t >= 0 ? `<b style="color:${TRIBE_STROKE[t]}">${m}</b>` : m;
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
      const html = `<b style="color:${TRIBE_STROKE[l.tribe]}">${l.name}</b> <span>${l.size}</span>`;
      if (el.innerHTML !== html) el.innerHTML = html;
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
    return `<b style="color:${TRIBE_STROKE[t]}">${TRIBE_NAMES[t]}</b>`;
  }
}
