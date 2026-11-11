// Renderer, camera, orbit controls and the hairline box everything lives in.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { INK } from './palette.ts';
import type { Theme } from './theme.ts';

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly fog: THREE.Fog;
  /** Pixels per world unit at distance 1, for sizing point sprites. */
  pixelScale = 1;
  /** Camera distance the field of view is fitted for. */
  private fitDistance = 1;
  private frame: THREE.LineSegments;
  /** Floor grid for themes that ask for one; built on first use. */
  private grid: THREE.LineSegments | null = null;

  constructor(canvas: HTMLCanvasElement, reducedMotion: boolean) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(INK.ground, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 40);
    this.camera.position.set(3.3, 2.1, 3.7);
    this.fitDistance = this.camera.position.length();
    this.fog = new THREE.Fog(INK.ground, 4.6, 9.2);
    this.scene.fog = this.fog;

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 9;
    this.controls.autoRotate = !reducedMotion;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.target.set(0, 0, 0);

    const box = new THREE.EdgesGeometry(new THREE.BoxGeometry(2.02, 2.02, 2.02));
    this.frame = new THREE.LineSegments(
      box,
      new THREE.LineBasicMaterial({ color: INK.outline, transparent: true, opacity: 0.22, fog: true }),
    );
    this.scene.add(this.frame);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    // The canvas also changes size without the window, when the paper pane opens or closes beside it.
    new ResizeObserver(() => this.resize()).observe(this.renderer.domElement);
  }

  setTheme(t: Theme): void {
    this.renderer.setClearColor(t.ground, 1);
    this.fog.color.set(t.ground);
    const m = this.frame.material as THREE.LineBasicMaterial;
    m.color.set(t.frame);
    m.opacity = t.frameOpacity;
    if (t.grid) {
      this.grid ??= this.makeGrid();
      const g = this.grid.material as THREE.LineBasicMaterial;
      g.color.set(t.grid.color);
      g.opacity = t.grid.opacity;
      this.grid.visible = true;
    } else if (this.grid) {
      this.grid.visible = false;
    }
    document.body.style.background = t.ground;
  }

  /** A 16 by 16 grid on the floor of the box, like the squares on drafting paper. */
  private makeGrid(): THREE.LineSegments {
    const n = 16;
    const h = 1.01;
    const pts: number[] = [];
    for (let i = 0; i <= n; i++) {
      const v = -h + (2 * h * i) / n;
      pts.push(v, -h, -h, v, -h, h, -h, -h, v, h, -h, v);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const grid = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, fog: true }));
    grid.renderOrder = -1;
    this.scene.add(grid);
    return grid;
  }

  resize(): void {
    const w = this.renderer.domElement.clientWidth || window.innerWidth;
    const h = this.renderer.domElement.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Widen the vertical field of view on tall screens so the box always fits across. The fit uses
    // the starting distance, so a resize while the camera is zoomed in on something keeps the lens.
    const dist = this.fitDistance;
    const halfWidth = Math.atan(1.5 / dist);
    const fit = (2 * Math.atan(Math.tan(halfWidth) / aspect) * 180) / Math.PI;
    this.camera.fov = Math.min(68, Math.max(30, fit));
    this.camera.updateProjectionMatrix();
    const dpr = this.renderer.getPixelRatio();
    this.pixelScale = (h * dpr) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  /** Distance-based fog bounds that follow the camera, so the far side of the box pales. */
  updateFog(): void {
    const d = this.camera.position.length();
    this.fog.near = d - 0.6;
    this.fog.far = d + 3.4;
  }

  render(): void {
    this.controls.update();
    this.updateFog();
    this.renderer.render(this.scene, this.camera);
  }
}
