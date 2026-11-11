// The Environment panel: sliders for the society's main rules. Society code reads its parameters
// every tick, so a slider changes the running world at once. The values also become the overrides
// for the next restart or new world, and go into the page link as ?p= so Share passes them on.
// The food map and its capacity are different: a world reads them once, when it is built, so they
// set the next world and the panel says a restart is needed.

import { TICKS_PER_YEAR, type App } from '../app.ts';
import { DEFAULT_SOCIETY, FOOD_MAPS, HALF_POOR, HALF_RICH, type FoodMap } from '../sim/society.ts';
import { FOOD_PRESETS, type Overrides } from '../sim/world.ts';
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

const times = (v: number) => `${+v.toFixed(2)}×`;

/** Where each map's six centres sit in its small picture, and how each map draws them. */
const SPOTS = [[7, 7], [17, 5], [27, 8], [8, 16], [18, 17], [27, 16]];
const spots = (r: (x: number) => number, o: (x: number) => number) => SPOTS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r(x)}" opacity="${o(x)}" />`).join('');
const grid = Array.from({ length: 40 }, (_, k) => `<circle cx="${3 + (k % 8) * 4}" cy="${3 + Math.floor(k / 8) * 4}" r="0.9" opacity="0.6" />`).join('');

const FOOD: Record<FoodMap, { label: string; hint: string; glyph: string }> = {
  zones: { label: 'Six zones', hint: 'A wide fertile zone where each of the six lineages began. This is the world the paper measured.', glyph: spots(() => 5.5, () => 0.4) },
  plain: { label: 'Plain', hint: 'The same food, spread evenly through the water.', glyph: grid },
  islands: { label: 'Islands', hint: 'Six tight islands of food, with almost bare water between them.', glyph: spots(() => 2.4, () => 0.85) },
  halves: { label: 'Rich and poor', hint: `The six zones, with ${HALF_RICH} times the food on one half of the world and ${HALF_POOR} times on the other.`, glyph: spots((x) => (x > 17 ? 5.5 : 4), (x) => (x > 17 ? 0.7 : 0.16)) },
};

const CAPACITY: Knob = {
  key: 'foodCapacity', label: 'Food capacity', note: 'applies on restart', min: 0.25, max: 2, step: 0.05, show: times,
  hint: 'How much food the map can hold, as a multiple of what the six zones hold. Picking a map sets the amount at which a typical world holds 400 to 900 organisms.',
};

const KNOBS: Knob[] = [
  { key: 'fear', label: 'Fear', hint: 'Weight each organism gives to unallied mass nearby when it chooses whom to follow. At 0 no leader is worth its tax, and nothing forms.', min: 0, max: 2, step: 0.05, show: plain },
  { key: 'regrow', label: 'Food regrowth', hint: 'How fast eaten food grows back.', min: 0.003, max: 0.04, step: 0.0005, show: percent },
  { key: 'fightChance', label: 'Fight chance', hint: 'How likely two touching rivals are to fight. Hungry ones fight more, kin less.', min: 0, max: 0.15, step: 0.005, show: percent },
  { key: 'tribute', label: 'Tax', hint: 'Share of income each follower passes up to its leader.', min: 0, max: 0.9, step: 0.01, show: percent },
  { key: 'kinShare', label: 'Kin discount', hint: 'How much less tax an organism pays a leader of its own lineage.', min: 0, max: 1, step: 0.01, show: percent },
  { key: 'controlLoss', label: 'Control loss', hint: 'Protection lost for each rank between a follower and its top leader. Higher keeps groups flatter.', min: 0, max: 0.3, step: 0.005, show: plain },
  { key: 'lifespan', label: 'Lifespan', hint: 'Average life of an organism. Applies to organisms born after the change.', note: 'applies to newborns', min: 1500, max: 6000, step: 50, show: years },
  { key: 'temperature', label: 'Choice noise', hint: 'How often organisms follow someone other than the best leader. At 0 they always pick the best.', min: 0, max: 0.2, step: 0.005, show: plain },
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
  private restartBtn = $<HTMLButtonElement>('env-restart');
  private mapRadios: HTMLInputElement[] = [];
  private mapHint = $<HTMLParagraphElement>('food-hint');
  private mapWhen = $<HTMLSpanElement>('food-when');
  private capacity!: Row;
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
      const row = this.addKnob(host, knob, live[knob.key] ?? def, (v) => {
        this.live()[knob.key] = v;
        this.paint(row, v);
        this.remember();
      });
      this.rows.push(row);
    }
    this.buildFood();
    this.sync();

    this.btn.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    $<HTMLButtonElement>('env-close').addEventListener('click', () => this.close());
    this.resetBtn.addEventListener('click', () => this.reset());
    this.restartBtn.addEventListener('click', () => {
      this.app.start(this.app.seed, this.app.getOverrides());
      // On a phone the sheet covers the world, so get out of the way of the new one.
      if (this.narrow.matches) this.close();
    });
    // Any new world, from here or from New world, has taken the food settings.
    app.onStart.push(() => this.sync());
  }

  /** Build one slider row. `write` gets each value the viewer sets. */
  private addKnob(host: HTMLElement, knob: Knob, now: number, write: (v: number) => void): Row {
    const def = DEFAULTS[knob.key];
    // Widen the range if a retuned default or a shared link falls outside it.
    const min = Math.min(knob.min, def, now);
    const max = Math.max(knob.max, def, now);
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
    const apply = () => write(Number(Number(row.input.value).toFixed(decimals(step) + 1)));
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
    return row;
  }

  /** The food map picker and its capacity dial. Both set the next world. */
  private buildFood(): void {
    const list = $<HTMLDivElement>('food-maps');
    for (const map of FOOD_MAPS) {
      const label = document.createElement('label');
      label.className = 'opt';
      label.title = FOOD[map].hint;
      label.innerHTML =
        `<input type="radio" name="food-map" value="${map}" />` +
        `<svg class="map-ico" viewBox="0 0 34 22" width="34" height="22" aria-hidden="true">${FOOD[map].glyph}</svg>` +
        `<span class="nm">${FOOD[map].label}</span>`;
      const radio = label.querySelector('input')!;
      radio.addEventListener('change', () => {
        // A map comes with the capacity at which its world is neither empty nor full.
        if (radio.checked) this.remember({ map, capacity: FOOD_PRESETS.find((f) => f.map === map)?.capacity ?? 1 });
      });
      this.mapRadios.push(radio);
      list.appendChild(label);
    }
    this.capacity = this.addKnob($<HTMLDivElement>('food-knob'), CAPACITY, this.nextFood().capacity, (v) => this.remember({ map: this.nextFood().map, capacity: v }));
  }

  /** The food settings the next world will be built with. */
  private nextFood(): { map: FoodMap; capacity: number } {
    const s = this.app.params.society;
    return { map: s.foodMap, capacity: s.foodCapacity };
  }

  private paintFood(): void {
    const next = this.nextFood();
    const running = this.app.world.params.society;
    for (const r of this.mapRadios) r.checked = r.value === next.map;
    this.mapHint.textContent = FOOD[next.map].hint;
    this.capacity.input.value = String(next.capacity);
    this.paint(this.capacity, next.capacity);
    const waiting = next.map !== running.foodMap || !near(next.capacity, running.foodCapacity);
    this.mapWhen.textContent = waiting ? 'restart to apply' : 'applies on restart';
    this.mapWhen.classList.toggle('due', waiting);
    this.restartBtn.classList.toggle('due', waiting);
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
    this.paintFood();
    this.resetBtn.disabled = this.rows.every((r) => near(live[r.knob.key], DEFAULTS[r.knob.key])) && this.foodIsDefault();
  }

  private foodIsDefault(): boolean {
    const next = this.nextFood();
    return next.map === DEFAULT_SOCIETY.foodMap && near(next.capacity, DEFAULT_SOCIETY.foodCapacity);
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
    this.remember({ map: DEFAULT_SOCIETY.foodMap, capacity: DEFAULT_SOCIETY.foodCapacity });
    this.sync();
  }

  /**
   * Fold the sliders and the food settings into the app's overrides and the page link. Other
   * overrides are kept. `food` replaces the food settings; without it they stay as they are.
   */
  private remember(food = this.nextFood()): void {
    const live = this.live();
    const current = this.app.getOverrides();
    const society = { ...(current.society ?? {}) } as Record<string, number | string>;
    let changed = 0;
    if (food.map === DEFAULT_SOCIETY.foodMap) delete society.foodMap;
    else society.foodMap = food.map;
    if (near(food.capacity, DEFAULT_SOCIETY.foodCapacity)) delete society.foodCapacity;
    else society.foodCapacity = food.capacity;
    changed += Number('foodMap' in society) + Number('foodCapacity' in society);
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
    this.paintFood();
    this.resetBtn.disabled = changed === 0;
    // Browsers rate-limit history writes, so wait for the slider to settle.
    clearTimeout(this.urlTimer);
    this.urlTimer = window.setTimeout(() => writeQuery('p', isEmpty(next) ? null : encodeOverrides(next)), 250);
  }
}
