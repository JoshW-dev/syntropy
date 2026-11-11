// The Environment panel: sliders for the society's main rules. Society code reads its parameters
// every tick, so a slider changes the running world at once. The values also become the overrides
// for the next restart or new world, and go into the page link as ?p= so Share passes them on.

import { TICKS_PER_YEAR, type App } from '../app.ts';
import { DEFAULT_SOCIETY } from '../sim/society.ts';
import type { Overrides } from '../sim/world.ts';
import { encodeOverrides, isEmpty, writeQuery } from './query.ts';

interface Knob {
  key: string;
  label: string;
  hint: string;
  /** A short caveat shown next to the parameter name. */
  note?: string;
  min: number;
  max: number;
  step: number;
  show(v: number): string;
}

const percent = (v: number) => `${+(v * 100).toFixed(2)}%`;
const plain = (v: number) => `${+v.toFixed(4)}`;
const years = (v: number) => `${+(v / TICKS_PER_YEAR).toFixed(1)} years`;

const KNOBS: Knob[] = [
  { key: 'fear', label: 'Fear', hint: 'Weight each organism gives to unallied mass nearby when it chooses whom to follow. At 0 no lord is worth its tribute, and nothing forms.', min: 0, max: 2, step: 0.05, show: plain },
  { key: 'regrow', label: 'Food regrowth', hint: 'How fast eaten food grows back.', min: 0.003, max: 0.04, step: 0.0005, show: percent },
  { key: 'fightChance', label: 'Fight chance', hint: 'How likely two touching rivals are to fight. Hungry ones fight more, kin less.', min: 0, max: 0.15, step: 0.005, show: percent },
  { key: 'tribute', label: 'Tribute', hint: 'Share of income each follower passes up to its lord.', min: 0, max: 0.9, step: 0.01, show: percent },
  { key: 'kinShare', label: 'Kin discount', hint: 'How much less tribute an organism pays a lord of its own tribe.', min: 0, max: 1, step: 0.01, show: percent },
  { key: 'controlLoss', label: 'Control loss', hint: 'Protection lost for each rank between a follower and its ruler. Higher keeps realms flatter.', min: 0, max: 0.3, step: 0.005, show: plain },
  { key: 'lifespan', label: 'Lifespan', hint: 'Average life of an organism. Applies to organisms born after the change.', note: 'applies to newborns', min: 1500, max: 6000, step: 50, show: years },
  { key: 'temperature', label: 'Choice noise', hint: 'How often organisms follow someone other than the best lord. At 0 they always pick the best.', min: 0, max: 0.2, step: 0.005, show: plain },
];

// Read at runtime, so a retune of the defaults shows up here without edits.
const DEFAULTS = DEFAULT_SOCIETY as unknown as Record<string, number>;

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const decimals = (step: number) => (String(step).split('.')[1] ?? '').length;

/**
 * The slider's step, made finer when needed so the default sits exactly on a stop and dragging
 * back to it is possible. A retuned default like 0.0142 on a 0.005 grid gets a 0.0002 grid.
 */
function alignedStep(step: number, min: number, def: number): number {
  for (const div of [1, 2, 5, 10, 20, 25, 50, 100]) {
    const s = step / div;
    const k = (def - min) / s;
    if (Math.abs(k - Math.round(k)) < 1e-6) return Number(s.toPrecision(6));
  }
  return step;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface Row {
  knob: Knob;
  el: HTMLDivElement;
  input: HTMLInputElement;
  output: HTMLOutputElement;
  min: number;
  max: number;
}

export class Environment {
  private app: App;
  private panel = $<HTMLElement>('env');
  private btn = $<HTMLButtonElement>('env-btn');
  private resetBtn = $<HTMLButtonElement>('env-reset');
  private rows: Row[] = [];
  private urlTimer = 0;
  private narrow = window.matchMedia('(max-width: 760px)');
  isOpen = false;
  /** Called when the panel opens, so the Look popover can close. */
  onOpen: () => void = () => undefined;

  constructor(app: App) {
    this.app = app;
    const host = $<HTMLDivElement>('env-knobs');
    const live = this.live();
    for (const knob of KNOBS) {
      const def = DEFAULTS[knob.key];
      if (typeof def !== 'number') continue; // a parameter the sim no longer has
      // Widen the range if a retuned default or a shared link falls outside it.
      const min = Math.min(knob.min, def, live[knob.key] ?? def);
      const max = Math.max(knob.max, def, live[knob.key] ?? def);
      const step = alignedStep(knob.step, min, def);
      const el = document.createElement('div');
      el.className = 'knob';
      const id = `k-${knob.key}`;
      const note = knob.note ? `<span class="knob-note">${knob.note}</span>` : '';
      el.innerHTML =
        `<div class="knob-top"><label for="${id}" title="${knob.hint}">${knob.label}</label><output for="${id}"></output></div>` +
        `<span class="knob-key">${knob.key}${note}</span>` +
        `<div class="knob-track"><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" aria-describedby="${id}-hint" />` +
        `<span class="knob-def" style="--def:${(def - min) / (max - min)}" aria-hidden="true"></span></div>` +
        `<span class="sr" id="${id}-hint">${knob.hint} Default ${knob.show(def)}.</span>`;
      const row: Row = { knob, el, input: el.querySelector('input')!, output: el.querySelector('output')!, min, max };
      const apply = () => {
        const v = Number(Number(row.input.value).toFixed(decimals(step) + 1));
        this.live()[knob.key] = v;
        this.paint(row, v);
        this.remember();
      };
      row.input.addEventListener('input', apply);
      // Arrow keys move by the usual step even when the grid is finer, and stop on the default.
      row.input.addEventListener('keydown', (e) => {
        const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
        if (!dir || step === knob.step) return;
        e.preventDefault();
        const cur = Number(row.input.value);
        let next = cur + dir * knob.step;
        if ((def - cur) * dir > step / 2 && (next - def) * dir > step / 2) next = def;
        row.input.value = String(Math.min(max, Math.max(min, next)));
        apply();
      });
      host.appendChild(el);
      this.rows.push(row);
    }
    this.sync();

    this.btn.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    $<HTMLButtonElement>('env-close').addEventListener('click', () => this.close());
    this.resetBtn.addEventListener('click', () => this.reset());
    $<HTMLButtonElement>('env-restart').addEventListener('click', () => {
      this.app.start(this.app.seed, this.app.getOverrides());
      this.sync();
      // On a phone the sheet covers the world, so get out of the way of the new one.
      if (this.narrow.matches) this.close();
    });
  }

  open(): void {
    if (this.isOpen) return;
    this.onOpen();
    this.sync();
    this.isOpen = true;
    this.panel.classList.add('open');
    this.btn.setAttribute('aria-expanded', 'true');
    $<HTMLButtonElement>('env-close').focus({ preventScroll: true });
  }

  /** Returns true when the panel was open. */
  close(returnFocus = true): boolean {
    if (!this.isOpen) return false;
    this.isOpen = false;
    this.panel.classList.remove('open');
    this.btn.setAttribute('aria-expanded', 'false');
    if (returnFocus && this.panel.contains(document.activeElement)) this.btn.focus({ preventScroll: true });
    return true;
  }

  /**
   * Set parameters on the running world, as if the sliders had been moved: the panel, the next
   * restart and the page link all follow. Used by the paper's experiments.
   */
  set(values: Record<string, number>): void {
    const live = this.live();
    for (const [key, v] of Object.entries(values)) if (typeof DEFAULTS[key] === 'number') live[key] = v;
    this.sync();
    this.remember();
  }

  /** The running world's value of one parameter, and its default. */
  value(key: string): { now: number; def: number } {
    return { now: this.live()[key], def: DEFAULTS[key] };
  }

  /** The running world's parameters; writing a field takes effect on the next tick. */
  private live(): Record<string, number> {
    return this.app.world.society.p as unknown as Record<string, number>;
  }

  /** Show the running world's values. */
  sync(): void {
    const live = this.live();
    for (const row of this.rows) {
      const v = live[row.knob.key];
      row.input.value = String(v);
      this.paint(row, v);
    }
    this.resetBtn.disabled = this.rows.every((r) => near(live[r.knob.key], DEFAULTS[r.knob.key]));
  }

  private paint(row: Row, v: number): void {
    const text = row.knob.show(v);
    row.output.textContent = text;
    row.input.setAttribute('aria-valuetext', text);
    row.input.style.setProperty('--fill', `${(100 * (v - row.min)) / (row.max - row.min)}%`);
    row.el.classList.toggle('changed', !near(v, DEFAULTS[row.knob.key]));
  }

  private reset(): void {
    const live = this.live();
    for (const row of this.rows) live[row.knob.key] = DEFAULTS[row.knob.key];
    this.sync();
    this.remember();
  }

  /** Fold the sliders into the app's overrides and the page link. Other overrides are kept. */
  private remember(): void {
    const live = this.live();
    const current = this.app.getOverrides();
    const society = { ...(current.society ?? {}) } as Record<string, number>;
    let changed = 0;
    for (const { knob } of this.rows) {
      const v = live[knob.key];
      if (near(v, DEFAULTS[knob.key])) delete society[knob.key];
      else {
        society[knob.key] = v;
        changed++;
      }
    }
    const next: Overrides = { ...current };
    if (Object.keys(society).length) next.society = society as Overrides['society'];
    else delete next.society;
    this.app.setOverrides(next);
    this.resetBtn.disabled = changed === 0;
    // Browsers rate-limit history writes, so wait for the slider to settle.
    clearTimeout(this.urlTimer);
    this.urlTimer = window.setTimeout(() => writeQuery('p', isEmpty(next) ? null : encodeOverrides(next)), 250);
  }
}
