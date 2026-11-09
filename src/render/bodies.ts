// Draws the Society: organisms as shaded ink spheres (fill = tribe), one line from every
// follower to its lord (stroke = the ruler's tribe), a ring around each ruler, and the food
// field as a faint green stipple. Bigger spheres command more followers.

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Society } from '../sim/society.ts';
import { INK, TRIBE_FILL, TRIBE_STROKE, hexToRgb } from './palette.ts';

const POINT_VERT = /* glsl */ `
  attribute vec3 color;
  attribute float size;
  attribute float ring;
  uniform float uScale;
  uniform float uMinPx;
  varying vec3 vColor;
  varying float vRing;
  varying float vRingAlpha;
  varying float vPx;
  varying float vDepth;
  void main() {
    vRingAlpha = ring;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float px = size > 0.0 ? max(uMinPx * min(1.0, size * 40.0), uScale * size / -mv.z) : 0.0;
    float pad = ring > 0.0 ? max(5.0, px * 0.45) : 0.0;
    gl_PointSize = px + pad * 2.0;
    vColor = color;
    vRing = ring > 0.0 ? (px / (px + pad * 2.0)) : 0.0;
    vPx = gl_PointSize;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const POINT_FRAG = /* glsl */ `
  uniform vec3 uOutline;
  uniform vec3 uGround;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uDpr;
  varying vec3 vColor;
  varying float vRing;
  varying float vRingAlpha;
  varying float vPx;
  varying float vDepth;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r = length(q);
    float radiusPx = vPx * 0.5;
    float aa = 1.0 / radiusPx;
    float line = min(1.5 * uDpr, radiusPx * 0.22) / radiusPx;
    float body = vRing > 0.0 ? vRing : 1.0;
    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    vec3 ink = mix(uOutline, uGround, fog);
    if (vRing > 0.0 && r > body + aa) {
      // The ruler's ring: a thin circle around the body.
      float d = abs(r - (1.0 - line));
      float a = (1.0 - smoothstep(line * 0.5, line * 0.5 + aa, d)) * vRingAlpha;
      if (a <= 0.01) discard;
      gl_FragColor = vec4(ink, a);
      return;
    }
    float alpha = 1.0 - smoothstep(body - aa, body, r);
    if (alpha <= 0.01) discard;
    float rn = r / body;
    vec3 n = vec3(q / body, sqrt(max(0.0, 1.0 - rn * rn)));
    float diff = max(dot(n, normalize(vec3(-0.4, 0.6, 0.7))), 0.0);
    vec3 col = vColor * (0.7 + 0.34 * diff);
    float edge = smoothstep(body - line - aa, body - line, r);
    col = mix(col, uOutline, edge);
    gl_FragColor = vec4(mix(col, uGround, fog), alpha);
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
  uniform float uFogNear;
  uniform float uFogFar;
  varying float vLevel;
  varying float vDepth;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    if (dot(q, q) > 1.0 || vLevel < 0.02) discard;
    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    gl_FragColor = vec4(uColor, vLevel * (1.0 - fog));
  }
`;

export class Bodies {
  readonly group = new THREE.Group();
  /** Packed draw index -> society slot, for picking. */
  readonly slotOf: Int32Array;
  drawn = 0;
  readonly screen: Float32Array;

  private points: THREE.Points;
  private pointGeo: THREE.BufferGeometry;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private ring: Float32Array;
  private pointMat: THREE.ShaderMaterial;

  private lines: LineSegments2;
  private lineGeo: LineSegmentsGeometry;
  private lineMat: LineMaterial;
  private linePos: Float32Array;
  private lineCol: Float32Array;
  /** The hovered organism's chain of command, drawn heavier and on top. */
  private chain: LineSegments2;
  private chainGeo: LineSegmentsGeometry;
  private chainMat: LineMaterial;
  private chainPos: Float32Array;
  private chainCol: Float32Array;
  private drawIndex: Int32Array;

  private food: THREE.Points;
  private foodGeo: THREE.BufferGeometry;
  private foodLevel: Float32Array;
  private foodMat: THREE.ShaderMaterial;
  private foodFrame = 0;

  private fills = TRIBE_FILL.map(hexToRgb);
  private strokes = TRIBE_STROKE.map(hexToRgb);
  private society: Society;
  private fog: THREE.Fog;
  private cssWidth = 1;
  private cssHeight = 1;

  constructor(society: Society, fog: THREE.Fog) {
    this.society = society;
    this.fog = fog;
    const M = society.M;
    this.slotOf = new Int32Array(M);
    this.screen = new Float32Array(M * 2);
    this.pos = new Float32Array(M * 3);
    this.col = new Float32Array(M * 3);
    this.size = new Float32Array(M);
    this.ring = new Float32Array(M);
    this.pointGeo = new THREE.BufferGeometry();
    this.pointGeo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.pointGeo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.pointGeo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.pointGeo.setAttribute('ring', new THREE.BufferAttribute(this.ring, 1).setUsage(THREE.DynamicDrawUsage));
    this.pointMat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: true,
      uniforms: {
        uScale: { value: 1000 },
        uMinPx: { value: 7 },
        uDpr: { value: 1 },
        uOutline: { value: new THREE.Color(INK.outline) },
        uGround: { value: new THREE.Color(INK.ground) },
        uFogNear: { value: 4 },
        uFogFar: { value: 9 },
      },
    });
    this.points = new THREE.Points(this.pointGeo, this.pointMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;

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
    this.chain.renderOrder = 3;
    this.drawIndex = new Int32Array(M).fill(-1);

    const F = society.F;
    const perCell = 1;
    const nFood = F * F * F * perCell;
    const foodPos = new Float32Array(nFood * 3);
    this.foodLevel = new Float32Array(nFood);
    let k = 0;
    // Static jitter so the stipple doesn't read as a grid.
    let h = 2166136261;
    const rand = () => {
      h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
      return ((h >>> 0) % 10000) / 10000;
    };
    for (let z = 0; z < F; z++) {
      for (let y = 0; y < F; y++) {
        for (let x = 0; x < F; x++) {
          for (let q = 0; q < perCell; q++) {
            foodPos[3 * k] = ((x + rand()) / F) * 2 - 1;
            foodPos[3 * k + 1] = ((y + rand()) / F) * 2 - 1;
            foodPos[3 * k + 2] = ((z + rand()) / F) * 2 - 1;
            k++;
          }
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
        uColor: { value: new THREE.Color(INK.food) },
        uFogNear: { value: 4 },
        uFogFar: { value: 9 },
      },
    });
    this.food = new THREE.Points(this.foodGeo, this.foodMat);
    this.food.frustumCulled = false;
    this.food.renderOrder = 0;

    this.group.add(this.food, this.lines, this.points, this.chain);
  }

  /**
   * Pack live organisms into the draw buffers. `alpha` interpolates between the last two ticks;
   * `appear` (0-1) scales everyone up during the lift from Cells.
   */
  update(alpha: number, appear: number, pixelScale: number, dpr: number): void {
    const s = this.society;
    const { M, alive, pos, prev, tribe, size, lord, root, subSize, p } = s;
    let n = 0;
    let nl = 0;
    for (let i = 0; i < M; i++) {
      if (!alive[i]) continue;
      const x = prev[3 * i] + (pos[3 * i] - prev[3 * i]) * alpha;
      const y = prev[3 * i + 1] + (pos[3 * i + 1] - prev[3 * i + 1]) * alpha;
      const z = prev[3 * i + 2] + (pos[3 * i + 2] - prev[3 * i + 2]) * alpha;
      this.pos[3 * n] = x;
      this.pos[3 * n + 1] = y;
      this.pos[3 * n + 2] = z;
      const c = this.fills[tribe[i]];
      this.col[3 * n] = c[0];
      this.col[3 * n + 1] = c[1];
      this.col[3 * n + 2] = c[2];
      const followers = Math.max(1, subSize[i]);
      this.size[n] = 0.036 * Math.sqrt(size[i]) * (1 + 0.3 * Math.log10(followers)) * appear;
      this.ring[n] = lord[i] < 0 && followers >= p.realmMin ? Math.min(1, 0.3 + (followers - p.realmMin) / 25) : 0;
      this.slotOf[n] = i;
      this.drawIndex[i] = n;
      n++;
      const L = lord[i];
      if (L >= 0 && alive[L]) {
        const lx = prev[3 * L] + (pos[3 * L] - prev[3 * L]) * alpha;
        const ly = prev[3 * L + 1] + (pos[3 * L + 1] - prev[3 * L + 1]) * alpha;
        const lz = prev[3 * L + 2] + (pos[3 * L + 2] - prev[3 * L + 2]) * alpha;
        const o = 6 * nl;
        this.linePos[o] = x;
        this.linePos[o + 1] = y;
        this.linePos[o + 2] = z;
        this.linePos[o + 3] = lx;
        this.linePos[o + 4] = ly;
        this.linePos[o + 5] = lz;
        const r = root[i] >= 0 && alive[root[i]] ? root[i] : L;
        const sc = this.strokes[tribe[r]];
        this.lineCol[o] = this.lineCol[o + 3] = sc[0];
        this.lineCol[o + 1] = this.lineCol[o + 4] = sc[1];
        this.lineCol[o + 2] = this.lineCol[o + 5] = sc[2];
        nl++;
      }
    }
    this.drawn = n;
    this.pointGeo.setDrawRange(0, n);
    for (const name of ['position', 'color', 'size', 'ring']) this.pointGeo.getAttribute(name).needsUpdate = true;
    this.lineGeo.instanceCount = nl;
    touch(this.lineGeo, 'instanceStart');
    touch(this.lineGeo, 'instanceColorStart');
    this.lineMat.opacity = 0.75 * appear;

    this.pointMat.uniforms.uScale.value = pixelScale;
    this.lineMat.resolution.set(this.cssWidth, this.cssHeight);
    this.chainMat.resolution.set(this.cssWidth, this.cssHeight);
    this.pointMat.uniforms.uDpr.value = dpr;
    this.pointMat.uniforms.uMinPx.value = 7 * dpr;
    this.foodMat.uniforms.uScale.value = pixelScale;
    for (const m of [this.pointMat, this.foodMat]) {
      m.uniforms.uFogNear.value = this.fog.near;
      m.uniforms.uFogFar.value = this.fog.far;
    }
    this.foodMat.uniforms.uSize.value = 2.6 * dpr;

    if (this.foodFrame++ % 6 === 0) {
      const { food, cap } = s;
      const per = this.foodLevel.length / food.length;
      for (let c = 0; c < food.length; c++) {
        // Only fertile ground shows: grazed patches thin out and regrow.
        const v = cap[c] > 0.3 ? Math.min(0.36, food[c] * 0.45) * appear : 0;
        for (let q = 0; q < per; q++) this.foodLevel[c * per + q] = v;
      }
      this.foodGeo.getAttribute('level').needsUpdate = true;
    }
  }

  /** Project drawn organisms to CSS pixels; used for hover picking and labels. */
  project(camera: THREE.Camera, width: number, height: number): void {
    const v = new THREE.Vector3();
    for (let k = 0; k < this.drawn; k++) {
      v.set(this.pos[3 * k], this.pos[3 * k + 1], this.pos[3 * k + 2]).project(camera);
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

  /** World position of a slot as drawn this frame. */
  positionOf(slot: number, out: THREE.Vector3): THREE.Vector3 {
    const k = slot >= 0 ? this.drawIndex[slot] : -1;
    if (k < 0 || k >= this.drawn || this.slotOf[k] !== slot) return out.set(NaN, NaN, NaN);
    return out.set(this.pos[3 * k], this.pos[3 * k + 1], this.pos[3 * k + 2]);
  }

  setViewport(width: number, height: number): void {
    this.cssWidth = width;
    this.cssHeight = height;
  }

  /** Trace a slot's chain of command up to its ruler (or clear with -1). */
  highlight(slot: number): void {
    const s = this.society;
    let n = 0;
    if (slot >= 0 && s.alive[slot]) {
      const root = s.rootOf(slot);
      const c = this.strokes[s.tribe[root]];
      let k = slot;
      for (let guard = 0; s.lord[k] >= 0 && n < 64 && guard < 64; guard++) {
        const a = this.drawIndex[k];
        const b = this.drawIndex[s.lord[k]];
        if (a < 0 || b < 0) break;
        for (let q = 0; q < 3; q++) {
          this.chainPos[6 * n + q] = this.pos[3 * a + q];
          this.chainPos[6 * n + 3 + q] = this.pos[3 * b + q];
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
    this.pointGeo.dispose();
    this.pointMat.dispose();
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
