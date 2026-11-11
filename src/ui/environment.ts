// The Environment panel: sliders for the society's main rules. Society code reads its parameters
// every tick, so a slider changes the running world at once. The values also become the overrides
// for the next restart or new world, and go into the page link as ?p= so Share passes them on.
// The food map, the water and the food capacity are different: a world reads them once, when it is
// built, so they set the next world and the panel says a restart is needed. The climate follows
// them, because its cycle starts with the world.

import { TICKS_PER_YEAR, type App } from '../app.ts';
import { CLEAR, CLEAREST, DEFAULT_SOCIETY, FOOD_MAPS, HALF_POOR, HALF_RICH, MURKY, WATER_MAPS, type FoodMap, type WaterMap } from '../sim/society.ts';
import { CLIMATE_PERIODS, CLIMATE_PRESETS, FOOD_PRESETS, WATER_PRESETS, type Overrides } from '../sim/world.ts';
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

/** Each water as a small tank: the darker the tint, the shorter the sight. */
const tank = (inside: string) => `<rect x="1.5" y="2.5" width="31" height="17" rx="3" style="fill:none;stroke:var(--ink);stroke-opacity:0.45" />${inside}`;
const tint = (x: number, w: number, o: number) => `<rect x="${x}" y="3" width="${w}" height="16" rx="2.5" opacity="${o}" />`;
const far = (c: number) => `${+c.toFixed(2)} times as far as usual`;

const WATER: Record<WaterMap, { label: string; hint: string; glyph: string }> = {
  even: { label: 'Usual', hint: 'The same water everywhere. This is the world the paper measured.', glyph: tank(tint(2, 30, 0.18)) },
  clear: { label: 'Clear', hint: `Clear water everywhere. Every organism sees ${far(CLEAREST)}.`, glyph: tank('') },
  murky: { label: 'Murky', hint: `Murky water everywhere. Every organism sees ${far(MURKY)}.`, glyph: tank(tint(2, 30, 0.5)) },
  halves: { label: 'Half murky', hint: `Murky water on one half of the world, clear on the other. Sight is ${+MURKY.toFixed(2)} and ${CLEAR} times the usual.`, glyph: tank(tint(2, 15, 0.5)) },
  pockets: { label: 'Murky pockets', hint: `Clear water, with a ball of murk around three of the six food centres. Sight is ${+MURKY.toFixed(2)} and ${CLEAR} times the usual.`, glyph: tank([[9, 8], [19, 14], [27, 7]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.6" opacity="0.5" />`).join('')) },
};

/** Each climate as one cycle of its food: a flat line, a low wave, a tall wave. */
const wave = (amp: number) => {
  const pts = Array.from({ length: 31 }, (_, k) => `${(2 + k).toFixed(0)},${(11 - amp * Math.sin((2 * Math.PI * k) / 30)).toFixed(1)}`).join(' ');
  return `<line x1="2" y1="11" x2="32" y2="11" style="stroke:var(--ink);stroke-opacity:0.3;stroke-dasharray:1.5 2.5" /><polyline points="${pts}" style="fill:none;stroke:var(--ink);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round" />`;
};
const range = (swing: number) => `${Math.round((1 - swing) * 100)}% and ${Math.round((1 + swing) * 100)}%`;

type ClimateName = (typeof CLIMATE_PRESETS)[number]['name'];
const CLIMATE: Record<ClimateName, { label: string; glyph: string }> = {
  steady: { label: 'Steady', glyph: wave(0) },
  mild: { label: 'Mild cycle', glyph: wave(4) },
  strong: { label: 'Strong cycle', glyph: wave(8.5) },
};

/** What a climate does, in one or two sentences. */
function climateHint(swing: number, period: number): string {
  if (!(swing > 0)) return 'The water holds the same food all the time. This is the world the paper measured.';
  const seconds = Math.round(period / 60);
  // The one pair of presets that kills worlds says so (16 worlds, 300 years).
  const deadly = swing >= 0.9 && period >= 12000 ? ' A low this long is deadly: 6 of 16 test worlds died out within 300 years.' : '';
  return `The food the water can hold rises and falls everywhere at once, between ${range(swing)} of the usual. One cycle takes ${Math.round(period / TICKS_PER_YEAR)} years, which is ${seconds} seconds at 1×.${deadly}`;
}

const CAPACITY: Knob = {
  key: 'foodCapacity', label: 'Food capacity', note: 'applies on restart', min: 0.25, max: 2, step: 0.05, show: times,
  hint: 'How much food the map can hold, as a multiple of what the six zones hold. Picking a food map or a water sets the amount at which a typical world holds 400 to 900 organisms.',
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
  private waterRadios: HTMLInputElement[] = [];
  private waterHint = $<HTMLParagraphElement>('water-hint');
  private waterWhen = $<HTMLSpanElement>('water-when');
  private climateRadios: HTMLInputElement[] = [];
  private periodRadios: HTMLInputElement[] = [];
  private periodRow = $<HTMLDivElement>('climate-periods');
  private climateHint = $<HTMLParagraphElement>('climate-hint');
  private climateWhen = $<HTMLSpanElement>('climate-when');
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

  /** The food map picker, the water picker, the capacity dial and the climate. All set the next world. */
  private buildFood(): void {
    const picker = <K extends string>(host: string, name: string, keys: readonly K[], info: Record<K, { label: string; hint: string; glyph: string }>, pick: (key: K) => void) =>
      keys.map((key) => {
        const label = document.createElement('label');
        label.className = 'opt';
        label.title = info[key].hint;
        label.innerHTML =
          `<input type="radio" name="${name}" value="${key}" />` +
          `<svg class="map-ico" viewBox="0 0 34 22" width="34" height="22" aria-hidden="true">${info[key].glyph}</svg>` +
          `<span class="nm">${info[key].label}</span>`;
        const radio = label.querySelector('input')!;
        radio.addEventListener('change', () => {
          if (radio.checked) pick(key);
        });
        $<HTMLDivElement>(host).appendChild(label);
        return radio;
      });
    // A food map and a water each come with a capacity at which the world is neither empty nor
    // full, and the two multiply.
    const paired = (map: FoodMap, water: WaterMap) =>
      +((FOOD_PRESETS.find((f) => f.map === map)?.capacity ?? 1) * (WATER_PRESETS.find((f) => f.map === water)?.capacity ?? 1)).toFixed(4);
    this.mapRadios = picker('food-maps', 'food-map', FOOD_MAPS, FOOD, (map) => this.remember({ ...this.nextFood(), map, capacity: paired(map, this.nextFood().water) }));
    this.waterRadios = picker('water-maps', 'water-map', WATER_MAPS, WATER, (water) => this.remember({ ...this.nextFood(), water, capacity: paired(this.nextFood().map, water) }));
    this.capacity = this.addKnob($<HTMLDivElement>('food-knob'), CAPACITY, this.nextFood().capacity, (v) => this.remember({ ...this.nextFood(), capacity: v }));
    // The climate: how far food swings, and how long one cycle takes. A climate's mean is the usual
    // food, so picking one leaves the capacity alone.
    const names = CLIMATE_PRESETS.map((c) => c.name);
    const swingOf = (name: ClimateName) => CLIMATE_PRESETS.find((c) => c.name === name)!.swing;
    const info = Object.fromEntries(names.map((n) => [n, { ...CLIMATE[n], hint: swingOf(n) > 0 ? `Food swings between ${range(swingOf(n))} of the usual.` : climateHint(0, 0) }])) as Record<ClimateName, { label: string; hint: string; glyph: string }>;
    this.climateRadios = picker('climate-maps', 'climate', names, info, (name) => this.remember({ ...this.nextFood(), swing: swingOf(name) }));
    this.periodRadios = CLIMATE_PERIODS.map((period) => {
      const label = document.createElement('label');
      label.className = 'opt';
      label.title = `One cycle takes ${period / TICKS_PER_YEAR} years: ${Math.round(period / 60)} seconds at 1×.`;
      label.innerHTML = `<input type="radio" name="climate-period" value="${period}" /><span class="nm">${period / TICKS_PER_YEAR} years</span>`;
      const radio = label.querySelector('input')!;
      radio.addEventListener('change', () => {
        if (radio.checked) this.remember({ ...this.nextFood(), period });
      });
      this.periodRow.appendChild(label);
      return radio;
    });
  }

  /** The food, water and climate settings the next world will be built with. */
  private nextFood(): { map: FoodMap; water: WaterMap; capacity: number; swing: number; period: number } {
    const s = this.app.params.society;
    return { map: s.foodMap, water: s.waterMap, capacity: s.foodCapacity, swing: s.climateSwing, period: s.climatePeriod };
  }

  private paintFood(): void {
    const next = this.nextFood();
    const running = this.app.world.params.society;
    for (const r of this.mapRadios) r.checked = r.value === next.map;
    for (const r of this.waterRadios) r.checked = r.value === next.water;
    this.mapHint.textContent = FOOD[next.map].hint;
    this.waterHint.textContent = WATER[next.water].hint;
    this.capacity.input.value = String(next.capacity);
    this.paint(this.capacity, next.capacity);
    // The climate: a preset when the swing is one, and the cycle length only while a cycle is on.
    for (const r of this.climateRadios) r.checked = near(CLIMATE_PRESETS.find((c) => c.name === r.value)!.swing, next.swing);
    for (const r of this.periodRadios) r.checked = Number(r.value) === next.period;
    this.periodRow.hidden = !(next.swing > 0);
    this.climateHint.textContent = climateHint(next.swing, next.period);
    const food = next.map !== running.foodMap || !near(next.capacity, running.foodCapacity);
    const water = next.water !== running.waterMap;
    // With the cycle off in both worlds, a different cycle length changes nothing.
    const climate = !near(next.swing, running.climateSwing) || (next.swing > 0 && next.period !== running.climatePeriod);
    for (const [el, waiting] of [[this.mapWhen, food], [this.waterWhen, water], [this.climateWhen, climate]] as [HTMLElement, boolean][]) {
      el.textContent = waiting ? 'restart to apply' : 'applies on restart';
      el.classList.toggle('due', waiting);
    }
    this.restartBtn.classList.toggle('due', food || water || climate);
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
    return next.map === DEFAULT_SOCIETY.foodMap && next.water === DEFAULT_SOCIETY.waterMap && near(next.capacity, DEFAULT_SOCIETY.foodCapacity) && !(next.swing > 0);
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
    this.remember({ map: DEFAULT_SOCIETY.foodMap, water: DEFAULT_SOCIETY.waterMap, capacity: DEFAULT_SOCIETY.foodCapacity, swing: DEFAULT_SOCIETY.climateSwing, period: DEFAULT_SOCIETY.climatePeriod });
    this.sync();
  }

  /**
   * Fold the sliders and the food, water and climate settings into the app's overrides and the page
   * link. Other overrides are kept. `food` replaces those settings; without it they stay as they are.
   */
  private remember(food = this.nextFood()): void {
    const live = this.live();
    const current = this.app.getOverrides();
    const society = { ...(current.society ?? {}) } as Record<string, number | string>;
    let changed = 0;
    if (food.map === DEFAULT_SOCIETY.foodMap) delete society.foodMap;
    else society.foodMap = food.map;
    if (food.water === DEFAULT_SOCIETY.waterMap) delete society.waterMap;
    else society.waterMap = food.water;
    if (near(food.capacity, DEFAULT_SOCIETY.foodCapacity)) delete society.foodCapacity;
    else society.foodCapacity = food.capacity;
    // A link carries the swing while a cycle is on, and the cycle length when it is not the usual one.
    if (food.swing > 0) society.climateSwing = food.swing;
    else delete society.climateSwing;
    if (food.swing > 0 && food.period !== DEFAULT_SOCIETY.climatePeriod) society.climatePeriod = food.period;
    else delete society.climatePeriod;
    changed += Number('foodMap' in society) + Number('waterMap' in society) + Number('foodCapacity' in society) + Number('climateSwing' in society);
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
