// The guided camera. It eases the orbit centre onto whatever the story or the viewer points at
// (the first organism, a realm whose ruler just died, a picked organism), moves in, and eases back
// to the whole box afterwards. The viewer always wins: a drag or a zoom takes the distance back at
// once, and cancels a look the viewer did not ask for.

import * as THREE from 'three';
import type { Stage } from '../render/stage.ts';

type Aim = () => THREE.Vector3 | null;

/** How fast the camera closes on its goal, per second. */
const EASE = 2.4;
/** After the viewer moves the camera, story looks wait this long (ms). */
const YIELD_MS = 20000;
/** The orbit centre stays this far inside the box. */
const REACH = 0.82;

export class Director {
  /** The viewer's setting: when off, nothing here moves the camera. */
  enabled = true;
  private stage: Stage;
  private aim: Aim | null = null;
  private dist: number | null = null;
  private until = 0;
  private byViewer = false;
  private steering = false;
  private returnDist: number | null = null;
  private homeDist = 0;
  private yieldUntil = 0;
  private goal = new THREE.Vector3();
  private delta = new THREE.Vector3();

  constructor(stage: Stage) {
    this.stage = stage;
    stage.controls.addEventListener('start', () => this.grabbed());
  }

  /**
   * Look at a moving point from `dist` away for `seconds` (Infinity holds until release()).
   * `byViewer` marks a look the viewer asked for, which ignores the wait after a drag.
   */
  look(aim: Aim, dist: number, seconds: number, byViewer = false): boolean {
    const now = performance.now();
    if (!this.enabled || (!byViewer && now < this.yieldUntil)) return false;
    // A look the viewer asked for is not replaced by a story beat.
    if (this.aim && this.byViewer && !byViewer) return false;
    if (!this.steering) this.homeDist = this.distance();
    this.aim = aim;
    this.dist = dist;
    this.until = now + seconds * 1000;
    this.byViewer = byViewer;
    this.steering = true;
    this.returnDist = null;
    return true;
  }

  /** Stop looking and ease back to the whole box. `byViewer` releases only a viewer's look. */
  release(byViewer?: boolean): void {
    if (!this.aim || (byViewer !== undefined && byViewer !== this.byViewer)) return;
    this.aim = null;
    this.returnDist = this.dist === null ? null : this.homeDist;
    this.dist = null;
  }

  /** True while the camera is on something the viewer picked. */
  get holding(): boolean {
    return !!this.aim && this.byViewer;
  }

  update(dt: number): void {
    if (!this.steering) return;
    if (!this.enabled) {
      this.aim = null;
      this.returnDist = null;
    }
    const { controls, camera } = this.stage;
    const now = performance.now();
    let p: THREE.Vector3 | null = null;
    if (this.aim) {
      p = now < this.until ? this.aim() : null;
      if (!p || !Number.isFinite(p.x + p.y + p.z)) {
        this.release();
        p = null;
      }
    }
    if (p) this.goal.copy(p).clampScalar(-REACH, REACH);
    else this.goal.set(0, 0, 0);
    const k = 1 - Math.exp(-dt * EASE);
    // Move the centre and the camera together, so the view slides instead of swinging.
    this.delta.copy(this.goal).sub(controls.target).multiplyScalar(k);
    controls.target.add(this.delta);
    camera.position.add(this.delta);
    const want = p ? this.dist : this.returnDist;
    let off = 0;
    if (want !== null) {
      const cur = this.distance();
      const next = cur + (want - cur) * k;
      camera.position.sub(controls.target).multiplyScalar(next / cur).add(controls.target);
      off = Math.abs(want - next);
    }
    if (!p && controls.target.length() < 0.003 && off < 0.01) {
      controls.target.set(0, 0, 0);
      this.steering = false;
      this.returnDist = null;
    }
  }

  private distance(): number {
    return this.stage.camera.position.distanceTo(this.stage.controls.target);
  }

  /** The viewer took the camera. Give the distance back, and drop a look they did not ask for. */
  private grabbed(): void {
    if (!this.steering) return;
    if (this.aim && !this.byViewer) {
      this.aim = null;
      this.yieldUntil = performance.now() + YIELD_MS;
    }
    this.dist = null;
    this.returnDist = null;
  }
}
