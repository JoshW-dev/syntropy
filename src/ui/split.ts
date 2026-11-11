// The paper beside the world. On screens 1180px and wider the paper loads in a pane on the right, so a
// reader can follow the text while the world runs on the left. Either side collapses to a tab on its
// edge, the divider drags to resize, and P folds the paper away or brings it back. Narrower screens
// keep the plain Paper link. The choice to keep the paper folded is remembered in this browser.

import { load, save } from './query.ts';

type Layout = 'split' | 'sim' | 'paper';

const LAYOUT_KEY = 'syntropy.layout';
const WIDTH_KEY = 'syntropy.paperWidth';
/** The world keeps at least this much room while dragging; less and it folds away. */
const MIN_STAGE = 420;
const MIN_PANE = 360;
/** Drag closer than this to an edge and that side folds. */
const SNAP = 160;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Split {
  private root = document.documentElement;
  private wide = window.matchMedia('(min-width: 1180px)');
  private divider = $<HTMLDivElement>('divider');
  private pane = $<HTMLElement>('paper-pane');
  private frame = $<HTMLIFrameElement>('paper-frame');
  private layout: Layout = load(LAYOUT_KEY) === 'sim' ? 'sim' : 'split';

  constructor() {
    const width = Number(load(WIDTH_KEY));
    if (width >= MIN_PANE) this.root.style.setProperty('--pane', `${width}px`);

    $('fold-paper').addEventListener('click', () => this.set('sim'));
    $('fold-sim').addEventListener('click', () => this.set('paper'));
    $('open-paper').addEventListener('click', () => this.set('split'));
    $('open-sim').addEventListener('click', () => this.set('split'));
    $<HTMLAnchorElement>('paper-link').addEventListener('click', (e) => {
      if (!this.wide.matches) return;
      e.preventDefault();
      this.set('split');
    });
    this.wide.addEventListener('change', () => this.apply());
    this.bindDrag();
    this.apply();
  }

  /** P: fold the paper away, or bring it back beside the world. */
  toggle(): void {
    if (this.wide.matches) this.set(this.layout === 'split' ? 'sim' : 'split');
  }

  /** Make sure the world is on screen (the paper asked it to do something). */
  reveal(): void {
    if (this.wide.matches && this.layout === 'paper') this.set('split');
  }

  private set(layout: Layout): void {
    this.layout = layout;
    // Folding the world away is for this visit; the next one opens side by side again.
    save(LAYOUT_KEY, layout === 'sim' ? 'sim' : null);
    this.apply();
  }

  private apply(): void {
    const on = this.wide.matches;
    this.divider.hidden = !on;
    this.pane.hidden = !on;
    if (!on) {
      delete this.root.dataset.layout;
      return;
    }
    this.root.dataset.layout = this.layout;
    // Load the paper the first time it shows, so phones and folded sessions never fetch it.
    if (this.layout !== 'sim' && !this.frame.src) this.frame.src = '/paper/';
  }

  private bindDrag(): void {
    let dragging = false;
    let before = '';
    this.divider.addEventListener('pointerdown', (e) => {
      if (this.layout !== 'split' || (e.target as Element).closest('button')) return;
      dragging = true;
      before = this.root.style.getPropertyValue('--pane');
      this.divider.setPointerCapture(e.pointerId);
      // The iframe would swallow the pointer, and the width should follow it without easing.
      this.root.classList.add('dragging');
      e.preventDefault();
    });
    this.divider.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const vw = window.innerWidth;
      const pane = Math.min(vw - MIN_STAGE, Math.max(MIN_PANE, vw - e.clientX));
      this.root.style.setProperty('--pane', `${Math.round(pane)}px`);
    });
    const end = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      this.root.classList.remove('dragging');
      const vw = window.innerWidth;
      const snapped: Layout | null = vw - e.clientX < SNAP ? 'sim' : e.clientX < SNAP ? 'paper' : null;
      if (snapped) {
        // A fold keeps the width the pane had before the drag, so it reopens the same size.
        if (before) this.root.style.setProperty('--pane', before);
        else this.root.style.removeProperty('--pane');
        this.set(snapped);
      } else save(WIDTH_KEY, String(Math.round(Math.min(vw - MIN_STAGE, Math.max(MIN_PANE, vw - e.clientX)))));
    };
    this.divider.addEventListener('pointerup', end);
    this.divider.addEventListener('pointercancel', end);
  }
}
