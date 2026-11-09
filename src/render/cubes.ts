// Shared drawing for every cube in the world: lattice cells and the cells of organisms' bodies use
// the same shaded, ink-edged cube, so an organism is visibly made of the cells it came from.
// Theme hooks: uOutline/uGround set the ink and paper, uEdge the ink width (0 = none), uGlow (0-1)
// turns the shading into a self-lit look for dark themes, and uAlpha below 1 draws the cubes as
// additive light instead of opaque solids.

import * as THREE from 'three';

const VERT = /* glsl */ `
  attribute vec3 iOffset;
  attribute vec3 iColor;
  attribute float iScale;
  uniform float uCell;
  varying vec3 vColor;
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vDepth;
  varying float vScale;
  void main() {
    vLocal = position;
    vScale = iScale;
    vColor = iColor;
    vec3 p = position * (uCell * iScale) + iOffset;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
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
  uniform float uGlow;
  uniform float uAlpha;
  varying vec3 vColor;
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vDepth;
  varying float vScale;
  void main() {
    vec3 n = normalize(vNormal);
    float diff = max(dot(n, normalize(vec3(-0.35, 0.75, 0.55))), 0.0);
    vec3 lit = vColor * (0.66 + 0.38 * diff);
    // Glow: brighter toward the silhouette, as if lit from inside.
    float rim = 1.0 - max(dot(n, normalize(vView)), 0.0);
    vec3 glow = vColor * (0.55 + 0.9 * rim) + vColor * vColor * 0.35;
    vec3 col = mix(lit, glow, uGlow);
    // Ink along cube edges: where the second-largest local coordinate reaches the face.
    vec3 a = abs(vLocal);
    float hi = max(a.x, max(a.y, a.z));
    float lo = min(a.x, min(a.y, a.z));
    float mid = a.x + a.y + a.z - hi - lo;
    float w = fwidth(mid);
    // Small or shrinking cubes drop their ink so they read as colour, not dark specks.
    float edge = smoothstep(0.5 - uEdge - w, 0.5 - uEdge, mid) * smoothstep(0.15, 0.5, vScale) * step(0.0001, uEdge);
    col = mix(col, uOutline, edge);
    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    gl_FragColor = vec4(mix(col, uGround, fog), uAlpha);
  }
`;

export interface CubeTheme {
  outline: string;
  ground: string;
  edge: number;
  glow: number;
  /** Below 1: additive, translucent cubes. Omitted or 1: opaque. */
  cubeAlpha?: number;
}

export class CubeLayer {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  readonly offsets: Float32Array;
  readonly colors: Float32Array;
  readonly scales: Float32Array;
  count = 0;
  private geometry: THREE.InstancedBufferGeometry;
  private material: THREE.ShaderMaterial;

  constructor(capacity: number, cell: number) {
    this.capacity = capacity;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = box.index;
    g.setAttribute('position', box.getAttribute('position'));
    g.setAttribute('normal', box.getAttribute('normal'));
    this.offsets = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.scales = new Float32Array(capacity);
    g.setAttribute('iOffset', new THREE.InstancedBufferAttribute(this.offsets, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iColor', new THREE.InstancedBufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iScale', new THREE.InstancedBufferAttribute(this.scales, 1).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uCell: { value: cell },
        uOutline: { value: new THREE.Color('#555555') },
        uGround: { value: new THREE.Color('#F8F8F8') },
        uFogNear: { value: 4 },
        uFogFar: { value: 9 },
        uEdge: { value: 0.07 },
        uGlow: { value: 0 },
        uAlpha: { value: 1 },
      },
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
  }

  setTheme(t: CubeTheme): void {
    const u = this.material.uniforms;
    u.uOutline.value.set(t.outline);
    u.uGround.value.set(t.ground);
    u.uEdge.value = t.edge;
    u.uGlow.value = t.glow;
    const alpha = t.cubeAlpha ?? 1;
    const light = alpha < 1;
    u.uAlpha.value = alpha;
    const m = this.material;
    if (m.transparent !== light) {
      // Opaque cubes write depth and skip blending; light cubes add up and hide nothing.
      m.transparent = light;
      m.depthWrite = !light;
      m.blending = light ? THREE.AdditiveBlending : THREE.NormalBlending;
      m.needsUpdate = true;
    }
  }

  /** Publish the first `n` instances and flag the given attributes for upload. */
  commit(n: number, what: { offsets?: boolean; colors?: boolean; scales?: boolean } = { offsets: true, colors: true, scales: true }): void {
    this.count = n;
    this.geometry.instanceCount = n;
    if (what.offsets) this.geometry.getAttribute('iOffset').needsUpdate = true;
    if (what.colors) this.geometry.getAttribute('iColor').needsUpdate = true;
    if (what.scales) this.geometry.getAttribute('iScale').needsUpdate = true;
  }

  setFog(near: number, far: number): void {
    this.material.uniforms.uFogNear.value = near;
    this.material.uniforms.uFogFar.value = far;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
