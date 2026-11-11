// The fold buttons. Each piece of the interface (the levels, the groups, the chronicle, the numbers)
// has a small button under it that folds the piece away and brings it back. A button shows only
// while the pointer is over its piece, so the world stays clear, and a folded piece leaves its
// button in view with its name. The pieces let the pointer through to the world, so they cannot
// report a hover themselves: this watches the pointer and compares it with each piece's box.

import type { Layer, View } from './view.ts';

/** The pointer counts as over a piece this many pixels outside its box. */
const MARGIN = 10;

interface Fold {
  btn: HTMLButtonElement;
  piece: HTMLElement;
}

export class Folds {
  private folds: Fold[] = [];
  private x = -1;
  private y = -1;
  private queued = false;

  constructor(view: View) {
    for (const btn of document.querySelectorAll<HTMLButtonElement>('.fold')) {
      const piece = document.getElementById(btn.dataset.piece ?? '');
      if (!piece) continue;
      this.folds.push({ btn, piece });
      btn.addEventListener('click', () => view.flip(btn.dataset.fold as Layer));
      // Space on a fold button presses it. It must not also pause the world.
      btn.addEventListener('keydown', (e) => {
        if (e.key === ' ') e.stopPropagation();
      });
    }
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      this.x = e.clientX;
      this.y = e.clientY;
      if (this.queued) return;
      this.queued = true;
      requestAnimationFrame(() => this.check());
    });
    document.documentElement.addEventListener('pointerleave', () => {
      this.x = this.y = -1;
      this.check();
    });
  }

  private check(): void {
    this.queued = false;
    for (const f of this.folds) f.btn.classList.toggle('near', this.over(f.piece) || this.over(f.btn));
  }

  private over(el: HTMLElement): boolean {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    return this.x >= r.left - MARGIN && this.x <= r.right + MARGIN && this.y >= r.top - MARGIN && this.y <= r.bottom + MARGIN;
  }
}
