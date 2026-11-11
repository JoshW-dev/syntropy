// Draws the organisms: each body is its own cells, drawn with the same cube as the lattice. A body
// that just came loose starts at lattice scale exactly where its form was and condenses over about
// two thirds of a second. One line runs from every follower to its lord in the ruler's tribe colour,
// a ring marks each ruler, and the food field shows as a faint stipple. Followers are drawn lowered by
// HANG per rank so a realm reads as a tree hanging from its ruler; the offset is only a drawing
// convention, and the simulation never sees it.

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { MAXB, type Society } from '../sim/society.ts';
import { CubeLayer } from './cubes.ts';
import { hexToRgb } from './palette.ts';
import type { Theme } from './theme.ts';

/** Drawn drop per rank below the ruler, in world units, and the deepest rank that drops further. */
const HANG = 0.05;
const HANG_RANKS = 8;
/** Share of the gap to the target drop closed each frame, so a change of lord glides. */
const HANG_EASE = 0.08;
const FLOOR = -0.97;
/** Bodies are drawn a little smaller than their physical size, which leaves air between neighbours. */
const DRAW_SCALE = 0.8;

const RING_VERT = /* glsl */ `
  attribute float size;
  attribute float strength;
  uniform float uScale;
  varying float vStrength;
  varying float vPx;
  varying float vDepth;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(12.0, uScale * size / -mv.z);
    vPx = gl_PointSize;
    vStrength = strength;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const RING_FRAG = /* glsl */ `
  uniform vec3 uInk;
  uniform vec3 uGround;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uDpr;
  varying float vStrength;
  varying float vPx;
  varying float vDepth;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r = length(q);
    float radiusPx = vPx * 0.5;
    float line = 1.5 * uDpr / radiusPx;
    float aa = 1.0 / radiusPx;
    float d = abs(r - (1.0 - line));
    float a = (1.0 - smoothstep(line * 0.5, line * 0.5 + aa, d)) * vStrength;
    if (a < 0.01) discard;
    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    gl_FragColor = vec4(mix(uInk, uGround, fog), a * (1.0 - 0.7 * fog));
  }
`;

const FOOD_VERT = /* glsl */ `
  attribute float level;
  uniform float uSize;
  uniform float uScale;
  varying float vLevel;
  varying float vDepth;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(uScale * 0.0095 / -mv.z, uSize * 0.55, uSize);
    vLevel = level;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FOOD_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uFogNear;
  uniform float uFogFar;
  varying float vLevel;
  varying float vDepth;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    if (dot(q, q) > 1.0 || vLevel < 0.02) discard;
    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    gl_FragColor = vec4(uColor, vLevel * uAlpha * (1.0 - fog));
  }
`;

export class Bodies {
  readonly group = new THREE.Group();
  readonly cubes: CubeLayer;
  /** Packed draw index -> society slot, for picking. */
  readonly slotOf: Int32Array;
  drawn = 0;
  readonly screen: Float32Array;
  show = { lines: true, rings: true, food: true };
  /**
   * Spotlight: when set, every organism outside it is drawn paler, so one realm (or one set of
   * organisms) can be followed. `spotMask` marks the lit slots with 1 and wins over `spotRoot`,
   * which lights one ruler's whole polity. `spotDim` is how far the rest fades toward the ground.
   */
  spotRoot = -1;
  spotMask: Uint8Array | null = null;
  spotDim = 0.7;
  private ground: [number, number, number] = [1, 1, 1];
  /** Eased 0 to 1, so the spotlight fades in and out instead of snapping. */
  private spotLevel = 0;

  private centers: Float32Array;
  /** Current drawn drop of each society slot, eased toward HANG * rank. */
  private hang: Float32Array;
  /** Birth tick seen for each slot, so a reused slot starts at its own drop. */
  private bornSeen: Float64Array;
  private drawIndex: Int32Array;
  private society: Society;
  private fog: THREE.Fog;
  private cssWidth = 1;
  private cssHeight = 1;
  private fills: [number, number, number][];
  private strokes: [number, number, number][];

  private rings: THREE.Points;
  private ringGeo: THREE.BufferGeometry;
  private ringPos: Float32Array;
  private ringSize: Float32Array;
  private ringStrength: Float32Array;
  private ringMat: THREE.ShaderMaterial;

  private lines: LineSegments2;
  private lineGeo: LineSegmentsGeometry;
  private lineMat: LineMaterial;
  private linePos: Float32Array;
  private lineCol: Float32Array;
  private lineOpacity = 0.75;

  private chain: LineSegments2;
  private chainGeo: LineSegmentsGeometry;
  private chainMat: LineMaterial;
  private chainPos: Float32Array;
  private chainCol: Float32Array;

  private food: THREE.Points;
  private foodGeo: THREE.BufferGeometry;
  private foodLevel: Float32Array;
  private foodMat: THREE.ShaderMaterial;
  private foodFrame = 0;

  constructor(society: Society, fog: THREE.Fog, theme: Theme) {
    this.society = society;
    this.fog = fog;
    const M = society.M;
    this.fills = theme.fills.map(hexToRgb);
    this.strokes = theme.strokes.map(hexToRgb);
    this.slotOf = new Int32Array(M);
    this.drawIndex = new Int32Array(M).fill(-1);
    this.screen = new Float32Array(M * 2);
    this.centers = new Float32Array(M * 3);
    this.hang = new Float32Array(M);
    this.bornSeen = new Float64Array(M).fill(-1);
    this.cubes = new CubeLayer(Math.min(M * MAXB, 48000), society.cell);

    this.ringPos = new Float32Array(M * 3);
    this.ringSize = new Float32Array(M);
    this.ringStrength = new Float32Array(M);
    this.ringGeo = new THREE.BufferGeometry();
    this.ringGeo.setAttribute('position', new THREE.BufferAttribute(this.ringPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.ringGeo.setAttribute('size', new THREE.BufferAttribute(this.ringSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.ringGeo.setAttribute('strength', new THREE.BufferAttribute(this.ringStrength, 1).setUsage(THREE.DynamicDrawUsage));
    this.ringMat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uScale: { value: 1000 },
        uDpr: { value: 1 },
        uInk: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
        uFogNear: { value: 4 },
        uFogFar: { value: 9 },
      },
    });
    this.rings = new THREE.Points(this.ringGeo, this.ringMat);
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 3;

    this.lineGeo = new LineSegmentsGeometry();
    this.lineGeo.setPositions(new Float32Array(M * 6));
    this.lineGeo.setColors(new Float32Array(M * 6));
    this.linePos = interleaved(this.lineGeo, 'instanceStart');
    this.lineCol = interleaved(this.lineGeo, 'instanceColorStart');
    this.lineMat = new LineMaterial({ vertexColors: true, linewidth: 1.4, transparent: true, opacity: 0.75, worldUnits: false });
    this.lineMat.fog = true;
    this.lineMat.depthWrite = false;
    this.lines = new LineSegments2(this.lineGeo, this.lineMat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 1;

    const chainMax = 64;
    this.chainGeo = new LineSegmentsGeometry();
    this.chainGeo.setPositions(new Float32Array(chainMax * 6));
    this.chainGeo.setColors(new Float32Array(chainMax * 6));
    this.chainPos = interleaved(this.chainGeo, 'instanceStart');
    this.chainCol = interleaved(this.chainGeo, 'instanceColorStart');
    this.chainGeo.instanceCount = 0;
    this.chainMat = new LineMaterial({ vertexColors: true, linewidth: 3, worldUnits: false });
    this.chainMat.depthTest = false;
    this.chain = new LineSegments2(this.chainGeo, this.chainMat);
    this.chain.frustumCulled = false;
    this.chain.renderOrder = 4;

    const F = society.F;
    const nFood = F * F * F;
    const foodPos = new Float32Array(nFood * 3);
    this.foodLevel = new Float32Array(nFood);
    let h = 2166136261;
    const rand = () => {
      h ^= h << 13;
      h ^= h >>> 17;
      h ^= h << 5;
      return ((h >>> 0) % 10000) / 10000;
    };
    let k = 0;
    for (let z = 0; z < F; z++) {
      for (let y = 0; y < F; y++) {
        for (let x = 0; x < F; x++) {
          foodPos[3 * k] = ((x + rand()) / F) * 2 - 1;
          foodPos[3 * k + 1] = ((y + rand()) / F) * 2 - 1;
          foodPos[3 * k + 2] = ((z + rand()) / F) * 2 - 1;
          k++;
        }
      }
    }
    this.foodGeo = new THREE.BufferGeometry();
    this.foodGeo.setAttribute('position', new THREE.BufferAttribute(foodPos, 3));
    this.foodGeo.setAttribute('level', new THREE.BufferAttribute(this.foodLevel, 1).setUsage(THREE.DynamicDrawUsage));
    this.foodMat = new THREE.ShaderMaterial({
      vertexShader: FOOD_VERT,
      fragmentShader: FOOD_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uSize: { value: 3 },
        uScale: { value: 1000 },
        uColor: { value: new THREE.Color() },
        uAlpha: { value: 1 },
        uFogNear: { value: 4 },
        uFogFar: { value: 9 },
      },
    });
    this.food = new THREE.Points(this.foodGeo, this.foodMat);
    this.food.frustumCulled = false;
    this.food.renderOrder = 0;

    this.group.add(this.food, this.lines, this.cubes.mesh, this.rings, this.chain);
    this.setTheme(theme);
  }

  setTheme(t: Theme): void {
    this.fills = t.fills.map(hexToRgb);
    this.strokes = t.strokes.map(hexToRgb);
    this.ground = hexToRgb(t.ground);
    this.cubes.setTheme(t);
    this.ringMat.uniforms.uInk.value.set(t.ring ?? t.outline);
    this.ringMat.uniforms.uGround.value.set(t.ground);
    this.foodMat.uniforms.uColor.value.set(t.food);
    this.foodMat.uniforms.uAlpha.value = t.foodAlpha;
    this.lineOpacity = t.lineOpacity;
    this.lineMat.linewidth = t.lineWidth;
    const blending = t.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    for (const m of [this.lineMat, this.ringMat, this.foodMat]) {
      m.blending = blending;
      m.needsUpdate = true;
    }
  }

  setViewport(width: number, height: number): void {
    this.cssWidth = width;
    this.cssHeight = height;
  }

  /** Rebuild every body, ring and line for this frame. `alpha` interpolates between ticks. */
  update(alpha: number, pixelScale: number, dpr: number): void {
    const s = this.society;
    const { M, alive, pos, prev, tribe, lord, root, subSize, mass, body, born, origin, depth, p } = s;
    const { offsets, colors, scales, capacity } = this.cubes;
    const { hang, bornSeen } = this;
    const cell = s.cell;
    let n = 0;
    let nl = 0;
    let nr = 0;
    let k = 0;
    const lerp = (i: number, a: number) => prev[3 * i + a] + (pos[3 * i + a] - prev[3 * i + a]) * alpha;
    for (let i = 0; i < M; i++) {
      if (!alive[i]) continue;
      const target = HANG * Math.min(Math.max(depth[i], 0), HANG_RANKS);
      if (bornSeen[i] !== born[i]) {
        bornSeen[i] = born[i];
        hang[i] = target;
      } else {
        hang[i] += (target - hang[i]) * HANG_EASE;
      }
    }
    const drawnY = (i: number) => Math.max(FLOOR, lerp(i, 1) - hang[i]);
    const mask = this.spotMask;
    const spot = this.spotRoot;
    const spotOn = !!mask || spot >= 0;
    this.spotLevel += ((spotOn ? 1 : 0) - this.spotLevel) * 0.14;
    const fade = this.spotLevel < 0.01 ? 0 : this.spotDim * this.spotLevel;
    const g = this.ground;
    for (let i = 0; i < M; i++) {
      if (!alive[i]) continue;
      // While the spotlight fades out nothing is marked any more, so every body brightens together.
      const dim = !spotOn ? fade : mask ? (mask[i] === 1 ? 0 : fade) : root[i] === spot || i === spot ? 0 : fade;
      const cx = lerp(i, 0);
      const cy = drawnY(i);
      const cz = lerp(i, 2);
      this.centers[3 * k] = cx;
      this.centers[3 * k + 1] = cy;
      this.centers[3 * k + 2] = cz;
      this.slotOf[k] = i;
      this.drawIndex[i] = k;
      k++;
      const age = s.tick - born[i] + alpha;
      let sc: number;
      if (origin[i] === 1) {
        // Came off the lattice: start at lattice scale in place, then condense.
        const t = Math.min(1, age / 40);
        const e = t * t * (3 - 2 * t);
        sc = 1 + (p.bodyScale * DRAW_SCALE - 1) * e;
      } else {
        sc = p.bodyScale * DRAW_SCALE * (0.55 + 0.45 * Math.min(1, age / 16));
      }
      const fill = this.fills[tribe[i]];
      const base = i * MAXB * 3;
      const unit = cell * sc;
      const m = mass[i];
      for (let q = 0; q < m && n < capacity; q++) {
        offsets[3 * n] = cx + body[base + 3 * q] * unit;
        offsets[3 * n + 1] = cy + body[base + 3 * q + 1] * unit;
        offsets[3 * n + 2] = cz + body[base + 3 * q + 2] * unit;
        colors[3 * n] = fill[0] + (g[0] - fill[0]) * dim;
        colors[3 * n + 1] = fill[1] + (g[1] - fill[1]) * dim;
        colors[3 * n + 2] = fill[2] + (g[2] - fill[2]) * dim;
        scales[n] = sc * 0.84;
        n++;
      }
      const L = lord[i];
      if (L < 0) {
        const followers = subSize[i];
        if (followers >= p.realmMin) {
          this.ringPos[3 * nr] = cx;
          this.ringPos[3 * nr + 1] = cy;
          this.ringPos[3 * nr + 2] = cz;
          this.ringSize[nr] = s.radius[i] * 3.2 * DRAW_SCALE + 0.03;
          this.ringStrength[nr] = Math.min(1, 0.3 + (followers - p.realmMin) / 25) * (1 - 0.8 * dim);
          nr++;
        }
      } else if (alive[L]) {
        const o = 6 * nl;
        this.linePos[o] = cx;
        this.linePos[o + 1] = cy;
        this.linePos[o + 2] = cz;
        this.linePos[o + 3] = lerp(L, 0);
        this.linePos[o + 4] = drawnY(L);
        this.linePos[o + 5] = lerp(L, 2);
        const r = root[i] >= 0 && alive[root[i]] ? root[i] : L;
        const st = this.strokes[tribe[r]];
        this.lineCol[o] = this.lineCol[o + 3] = st[0] + (g[0] - st[0]) * dim;
        this.lineCol[o + 1] = this.lineCol[o + 4] = st[1] + (g[1] - st[1]) * dim;
        this.lineCol[o + 2] = this.lineCol[o + 5] = st[2] + (g[2] - st[2]) * dim;
        nl++;
      }
    }
    this.drawn = k;
    this.cubes.commit(n);

    this.lines.visible = this.show.lines;
    this.lineGeo.instanceCount = nl;
    touch(this.lineGeo, 'instanceStart');
    touch(this.lineGeo, 'instanceColorStart');
    this.lineMat.opacity = this.lineOpacity;

    this.rings.visible = this.show.rings;
    this.ringGeo.setDrawRange(0, nr);
    for (const name of ['position', 'size', 'strength']) this.ringGeo.getAttribute(name).needsUpdate = true;

    this.ringMat.uniforms.uScale.value = pixelScale;
    this.ringMat.uniforms.uDpr.value = dpr;
    this.foodMat.uniforms.uScale.value = pixelScale;
    this.foodMat.uniforms.uSize.value = 2.6 * dpr;
    this.lineMat.resolution.set(this.cssWidth, this.cssHeight);
    this.chainMat.resolution.set(this.cssWidth, this.cssHeight);
    this.cubes.setFog(this.fog.near, this.fog.far);
    for (const mat of [this.ringMat, this.foodMat]) {
      mat.uniforms.uFogNear.value = this.fog.near;
      mat.uniforms.uFogFar.value = this.fog.far;
    }

    this.food.visible = this.show.food;
    if (this.show.food && this.foodFrame++ % 6 === 0) {
      const { food, cap } = s;
      for (let c = 0; c < food.length; c++) this.foodLevel[c] = cap[c] > 0.3 ? Math.min(0.36, food[c] * 0.45) : 0;
      this.foodGeo.getAttribute('level').needsUpdate = true;
    }
  }

  /** Project drawn organisms to CSS pixels; used for hover picking. */
  project(camera: THREE.Camera, width: number, height: number): void {
    const v = new THREE.Vector3();
    for (let k = 0; k < this.drawn; k++) {
      v.set(this.centers[3 * k], this.centers[3 * k + 1], this.centers[3 * k + 2]).project(camera);
      this.screen[2 * k] = (v.x * 0.5 + 0.5) * width;
      this.screen[2 * k + 1] = (-v.y * 0.5 + 0.5) * height;
    }
  }

  /** Nearest drawn organism to a CSS pixel point, within `radius` px. Returns a slot or -1. */
  pick(x: number, y: number, radius: number): number {
    let best = -1;
    let bestD = radius * radius;
    for (let k = 0; k < this.drawn; k++) {
      const dx = this.screen[2 * k] - x;
      const dy = this.screen[2 * k + 1] - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = this.slotOf[k];
      }
    }
    return best;
  }

  positionOf(slot: number, out: THREE.Vector3): THREE.Vector3 {
    const k = slot >= 0 ? this.drawIndex[slot] : -1;
    if (k < 0 || k >= this.drawn || this.slotOf[k] !== slot) return out.set(NaN, NaN, NaN);
    return out.set(this.centers[3 * k], this.centers[3 * k + 1], this.centers[3 * k + 2]);
  }

  /** Trace a slot's chain of command up to its ruler (or clear with -1). */
  highlight(slot: number): void {
    const s = this.society;
    let n = 0;
    if (slot >= 0 && s.alive[slot]) {
      const c = this.strokes[s.tribe[s.rootOf(slot)]];
      let k = slot;
      for (let guard = 0; s.lord[k] >= 0 && n < 64 && guard < 64; guard++) {
        const a = this.drawIndex[k];
        const b = this.drawIndex[s.lord[k]];
        if (a < 0 || b < 0) break;
        for (let q = 0; q < 3; q++) {
          this.chainPos[6 * n + q] = this.centers[3 * a + q];
          this.chainPos[6 * n + 3 + q] = this.centers[3 * b + q];
          this.chainCol[6 * n + q] = c[q];
          this.chainCol[6 * n + 3 + q] = c[q];
        }
        n++;
        k = s.lord[k];
      }
    }
    this.chainGeo.instanceCount = n;
    touch(this.chainGeo, 'instanceStart');
    touch(this.chainGeo, 'instanceColorStart');
  }

  dispose(): void {
    this.cubes.dispose();
    this.ringGeo.dispose();
    this.ringMat.dispose();
    this.lineGeo.dispose();
    this.lineMat.dispose();
    this.chainGeo.dispose();
    this.chainMat.dispose();
    this.foodGeo.dispose();
    this.foodMat.dispose();
    this.group.removeFromParent();
  }
}

function interleaved(g: LineSegmentsGeometry, name: string): Float32Array {
  return (g.getAttribute(name) as THREE.InterleavedBufferAttribute).data.array as Float32Array;
}

function touch(g: LineSegmentsGeometry, name: string): void {
  (g.getAttribute(name) as THREE.InterleavedBufferAttribute).data.needsUpdate = true;
}
