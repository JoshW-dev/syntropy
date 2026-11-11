// View options, all behind the Look button: the theme, which layers show (chronicle, command lines,
// ruler rings, food) and hiding the UI entirely. The theme is remembered in this browser and kept in
// ?look= so a shared link opens in the same look. Layer choices are remembered in this browser only.

import type { App } from '../app.ts';
import { PAPER, THEMES, themeById, type Theme } from '../render/theme.ts';
import { load, readQuery, save, writeQuery } from './query.ts';

const LOOK_KEY = 'syntropy.look';
const SHOW_KEY = 'syntropy.show';

type Layer = 'chronicle' | 'lines' | 'rings' | 'food' | 'captions' | 'camera' | 'spin';
const LAYERS: Layer[] = ['chronicle', 'lines', 'rings', 'food', 'captions', 'camera', 'spin'];

/** The Guide switches act outside the renderer: the narrator, the guided camera and the slow turn. */
export interface Guide {
  captions(on: boolean): void;
  camera(on: boolean): void;
  spin(on: boolean): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class View {
  private app: App;
  private wrap = $<HTMLDivElement>('look');
  private btn = $<HTMLButtonElement>('look-btn');
  private pop = $<HTMLDivElement>('look-pop');
  private showBtn = $<HTMLButtonElement>('show-ui');
  private radios: HTMLInputElement[] = [];
  private boxes = new Map<Layer, HTMLInputElement>();
  private shown: Record<Layer, boolean>;
  private guide: Guide;
  private stillByDefault: boolean;
  private hidden = false;
  /** Called before the UI hides, so other panels can close. */
  onHide: () => void = () => undefined;
  /** Called when the popover opens, so the Environment panel can make room. */
  onOpen: () => void = () => undefined;

  constructor(app: App, guide: Guide, reducedMotion: boolean) {
    this.app = app;
    this.guide = guide;
    this.stillByDefault = reducedMotion;
    this.buildList();

    // A link's ?look= wins over this browser's last choice; either one goes into the address.
    const fromLink = themeById(readQuery('look'));
    const theme = fromLink ?? themeById(load(LOOK_KEY)) ?? PAPER;
    this.setLook(theme, false);

    const shown = (this.shown = this.loadShown());
    for (const box of this.pop.querySelectorAll<HTMLInputElement>('input[data-show]')) {
      const layer = box.dataset.show as Layer;
      this.boxes.set(layer, box);
      box.checked = shown[layer];
      this.applyLayer(layer, shown[layer]);
      box.addEventListener('change', () => {
        this.applyLayer(layer, box.checked);
        shown[layer] = box.checked;
        save(SHOW_KEY, JSON.stringify(shown));
      });
    }

    this.btn.addEventListener('click', () => (this.pop.hidden ? this.openLook() : this.closeLook()));
    $<HTMLButtonElement>('hide-ui').addEventListener('click', () => this.setHidden(true));
    this.showBtn.addEventListener('click', () => this.setHidden(false));
    // Close on any press outside the popover, including the start of an orbit drag.
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.pop.hidden && !this.wrap.contains(e.target as Node)) this.closeLook();
      },
      true,
    );
    this.wrap.addEventListener('focusout', (e) => {
      const to = e.relatedTarget as Node | null;
      if (to && !this.wrap.contains(to)) this.closeLook();
    });
  }

  setLook(theme: Theme, remember: boolean): void {
    this.app.setTheme(theme);
    for (const r of this.radios) r.checked = r.value === theme.id;
    writeQuery('look', theme === PAPER ? null : theme.id);
    if (remember) save(LOOK_KEY, theme === PAPER ? null : theme.id);
  }

  /** Flip one switch from the keyboard, keeping its checkbox and this browser's memory in step. */
  flip(layer: Layer): void {
    const on = !this.shown[layer];
    this.shown[layer] = on;
    const box = this.boxes.get(layer);
    if (box) box.checked = on;
    this.applyLayer(layer, on);
    save(SHOW_KEY, JSON.stringify(this.shown));
  }

  openLook(): void {
    this.onOpen();
    this.pop.hidden = false;
    this.btn.setAttribute('aria-expanded', 'true');
    this.radios.find((r) => r.checked)?.focus({ preventScroll: true });
  }

  /** Returns true when the popover was open. */
  closeLook(returnFocus = false): boolean {
    if (this.pop.hidden) return false;
    this.pop.hidden = true;
    this.btn.setAttribute('aria-expanded', 'false');
    if (returnFocus) this.btn.focus();
    return true;
  }

  toggleHidden(): void {
    this.setHidden(!this.hidden);
  }

  /** Hide every overlay except a small Show UI button. Returns true when the state changed. */
  setHidden(hide: boolean): boolean {
    if (hide === this.hidden) return false;
    this.hidden = hide;
    const focusWasOn = document.activeElement;
    if (hide) {
      this.closeLook();
      this.onHide();
    }
    document.documentElement.classList.toggle('ui-hidden', hide);
    this.showBtn.hidden = !hide;
    // Keep keyboard focus on something visible.
    if (hide && focusWasOn instanceof HTMLElement && focusWasOn !== document.body) this.showBtn.focus();
    if (!hide && focusWasOn === this.showBtn) this.btn.focus();
    return true;
  }

  private buildList(): void {
    const list = $<HTMLDivElement>('look-list');
    for (const t of THEMES) {
      const label = document.createElement('label');
      label.className = 'opt';
      // Each dot hints at how the look draws a body: an ink ring, a glow or a haze of light.
      const halo = (c: string) =>
        (t.cubeAlpha ?? 1) < 1 ? `0 0 5px 1px ${c}` : t.glow > 0.5 ? `0 0 3px ${c}` : `0 0 0 ${t.edge >= 0.09 ? 1.5 : 1}px ${t.outline}`;
      const dots = t.fills
        .slice(0, 3)
        .map((c) => `<i style="background:${c};box-shadow:${halo(c)}"></i>`)
        .join('');
      label.innerHTML =
        `<input type="radio" name="look" value="${t.id}" />` +
        `<span class="sw" aria-hidden="true" style="background:${t.ground}">${dots}</span>` +
        `<span class="nm">${t.name}</span>` +
        '<svg class="tick" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>';
      const radio = label.querySelector('input')!;
      radio.addEventListener('change', () => {
        if (radio.checked) this.setLook(t, true);
      });
      this.radios.push(radio);
      list.appendChild(label);
    }
  }

  private applyLayer(layer: Layer, on: boolean): void {
    if (layer === 'chronicle') document.documentElement.classList.toggle('no-chronicle', !on);
    else if (layer === 'captions' || layer === 'camera' || layer === 'spin') this.guide[layer](on);
    else this.app.setShow(layer, on);
  }

  private loadShown(): Record<Layer, boolean> {
    // With reduced motion asked for, the camera stays still unless the viewer turns it on.
    const move = !this.stillByDefault;
    const shown = { chronicle: true, lines: true, rings: true, food: true, captions: true, camera: move, spin: move };
    try {
      const saved = JSON.parse(load(SHOW_KEY) ?? '{}');
      for (const k of LAYERS) if (typeof saved[k] === 'boolean') shown[k] = saved[k];
    } catch {
      // Unreadable storage: start with everything shown.
    }
    return shown;
  }
}
