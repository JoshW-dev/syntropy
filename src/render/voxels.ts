// Draws the Cells lattice: one shaded, ink-edged cube per live cell. Newborn cells grow in and
// dying cells shrink away between generations, so the rule reads as motion, not flicker.

import * as THREE from 'three';
import type { CellsWorld } from '../sim/cells.ts';
import { INK, TRIBE_FILL, hexToRgb } from './palette.ts';

const VERT = /* glsl */ `
  attribute vec3 iOffset;
  attribute vec3 iColor;
  attribute float iScale;
  uniform float uCell;
  varying vec3 vColor;
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying float vDepth;
  varying float vScale;
  void main() {
    vLocal = position;
    vScale = iScale;
    vColor = iColor;
    vec3 p = position * (uCell * iScale) + iOffset;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uOutline;
  uniform vec3 uGround;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uEdge;
  varying vec3 vColor;
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying float vDepth;
  varying float vScale;
  void main() {
    vec3 n = normalize(vNormal);
    float diff = max(dot(n, normalize(vec3(-0.35, 0.75, 0.55))), 0.0);
    vec3 col = vColor * (0.66 + 0.38 * diff);
    // Ink along cube edges: where the second-largest local coordinate reaches the face.
    vec3 a = abs(vLocal);
    float hi = max(a.x, max(a.y, a.z));
    float lo = min(a.x, min(a.y, a.z));
    float mid = a.x + a.y + a.z - hi - lo;
    float w = fwidth(mid);
    // Shrinking cubes drop their ink so they fade into colour instead of dark specks.
    float edge = smoothstep(0.5 - uEdge - w, 0.5 - uEdge, mid) * smoothstep(0.2, 0.6, vScale);
    col = mix(col, uOutline, edge);
    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    gl_FragColor = vec4(mix(col, uGround, fog), 1.0);
  }
`;

const STEADY = 0;
const BORN = 1;
const DIED = 2;
const BASE = 0.84;

export class Voxels {
  readonly mesh: THREE.Mesh;
  private geometry: THREE.InstancedBufferGeometry;
  private offsets: Float32Array;
  private colors: Float32Array;
  private scales: Float32Array;
  private kinds: Uint8Array;
  private cellOfInstance: Int32Array;
  private homes: Float32Array;
  private count = 0;
  private readonly capacity: number;
  private readonly G: number;
  private material: THREE.ShaderMaterial;
  private fills = TRIBE_FILL.map(hexToRgb);
  private fog: THREE.Fog;

  constructor(world: CellsWorld, fog: THREE.Fog) {
    this.fog = fog;
    this.G = world.G;
    this.capacity = 24000;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = box.index;
    g.setAttribute('position', box.getAttribute('position'));
    g.setAttribute('normal', box.getAttribute('normal'));
    this.offsets = new Float32Array(this.capacity * 3);
    this.homes = new Float32Array(this.capacity * 3);
    this.colors = new Float32Array(this.capacity * 3);
    this.scales = new Float32Array(this.capacity);
    this.kinds = new Uint8Array(this.capacity);
    this.cellOfInstance = new Int32Array(this.capacity);
    g.setAttribute('iOffset', new THREE.InstancedBufferAttribute(this.offsets, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iColor', new THREE.InstancedBufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iScale', new THREE.InstancedBufferAttribute(this.scales, 1).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uCell: { value: 2 / this.G },
        uOutline: { value: new THREE.Color(INK.outline) },
        uGround: { value: new THREE.Color(INK.ground) },
        uFogNear: { value: 4 },
        uFogFar: { value: 9 },
        uEdge: { value: 0.07 },
      },
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.sync(world);
  }

  /** Rebuild the instance list after a generation: steady, newborn and dying cells. */
  sync(world: CellsWorld): void {
    const { G } = this;
    const { alive, prevAlive, lineage, prevLineage, N } = world;
    const G2 = G * G;
    const scale = 2 / G;
    let n = 0;
    for (let i = 0; i < N && n < this.capacity; i++) {
      const a = alive[i];
      const b = prevAlive[i];
      if (!a && !b) continue;
      const x = i % G;
      const y = Math.floor(i / G) % G;
      const z = Math.floor(i / G2);
      const wx = (x + 0.5) * scale - 1;
      const wy = (y + 0.5) * scale - 1;
      const wz = (z + 0.5) * scale - 1;
      this.offsets[3 * n] = this.homes[3 * n] = wx;
      this.offsets[3 * n + 1] = this.homes[3 * n + 1] = wy;
      this.offsets[3 * n + 2] = this.homes[3 * n + 2] = wz;
      const c = this.fills[a ? lineage[i] : prevLineage[i]];
      this.colors[3 * n] = c[0];
      this.colors[3 * n + 1] = c[1];
      this.colors[3 * n + 2] = c[2];
      this.kinds[n] = a && b ? STEADY : a ? BORN : DIED;
      this.cellOfInstance[n] = i;
      n++;
    }
    this.count = n;
    this.geometry.instanceCount = n;
    this.geometry.getAttribute('iOffset').needsUpdate = true;
    this.geometry.getAttribute('iColor').needsUpdate = true;
    this.animate(0);
  }

  /** t in [0, 1]: progress from the previous generation to the current one. */
  animate(t: number): void {
    const grow = 1 - (1 - t) * (1 - t);
    const fade = 1 - t * t;
    for (let k = 0; k < this.count; k++) {
      const kind = this.kinds[k];
      this.scales[k] = BASE * (kind === STEADY ? 1 : kind === BORN ? grow : fade);
    }
    this.geometry.getAttribute('iScale').needsUpdate = true;
  }

  /**
   * Draw each form's cells flowing into its centroid (where its organism appears).
   * `targets` maps a cell's form label to a world position; unlabeled cells shrink in place.
   */
  lift(world: CellsWorld, targets: Float32Array, t: number): void {
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    for (let k = 0; k < this.count; k++) {
      if (this.kinds[k] === DIED) {
        this.scales[k] = 0;
        continue;
      }
      const form = world.formOf[this.cellOfInstance[k]];
      const label = form >= 0 && !Number.isNaN(targets[3 * form]) ? form : -1;
      const hx = this.homes[3 * k];
      const hy = this.homes[3 * k + 1];
      const hz = this.homes[3 * k + 2];
      if (label >= 0) {
        this.offsets[3 * k] = hx + (targets[3 * label] - hx) * e;
        this.offsets[3 * k + 1] = hy + (targets[3 * label + 1] - hy) * e;
        this.offsets[3 * k + 2] = hz + (targets[3 * label + 2] - hz) * e;
      }
      this.scales[k] = BASE * (1 - e) * (label >= 0 ? 1 : 1 - e);
    }
    this.geometry.getAttribute('iOffset').needsUpdate = true;
    this.geometry.getAttribute('iScale').needsUpdate = true;
  }

  updateFog(): void {
    this.material.uniforms.uFogNear.value = this.fog.near;
    this.material.uniforms.uFogFar.value = this.fog.far;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
