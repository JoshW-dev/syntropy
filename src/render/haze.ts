// Murky water, drawn as a faint haze. Each murky volume (the whole box, half of it, or a ball) is a
// mesh whose shader measures how much murk the eye looks through at each pixel, so the haze is
// thicker through the middle of a ball and fades to nothing at its edge. Bodies in front of the far
// side of a volume cover it, so organisms inside the murk keep their lineage colours. The haze only
// shows where sight is short; the simulation never reads it.

import * as THREE from 'three';
import type { Society } from '../sim/society.ts';
import type { Theme } from './theme.ts';

/** How much ink one world unit of murk lays down along the line of sight. */
const DENSITY = 0.1;

const VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uMin;
  uniform vec3 uMax;
  uniform vec3 uCentre;
  uniform float uRadius;
  uniform vec3 uColor;
  uniform float uDensity;
  varying vec3 vWorld;
  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorld - ro);
    // The stretch of this line of sight that lies inside the box, and inside the ball if there is one.
    vec3 inv = 1.0 / rd;
    vec3 a = (uMin - ro) * inv;
    vec3 b = (uMax - ro) * inv;
    vec3 lo = min(a, b);
    vec3 hi = max(a, b);
    float t0 = max(max(lo.x, lo.y), max(lo.z, 0.0));
    float t1 = min(min(hi.x, hi.y), hi.z);
    if (uRadius > 0.0) {
      vec3 oc = ro - uCentre;
      float bq = dot(oc, rd);
      float h = bq * bq - dot(oc, oc) + uRadius * uRadius;
      if (h <= 0.0) discard;
      h = sqrt(h);
      t0 = max(t0, -bq - h);
      t1 = min(t1, -bq + h);
    }
    float len = t1 - t0;
    if (len <= 0.0) discard;
    gl_FragColor = vec4(uColor, 1.0 - exp(-uDensity * len));
  }
`;

export class Haze {
  readonly group = new THREE.Group();
  private mats: THREE.ShaderMaterial[] = [];
  private geos: THREE.BufferGeometry[] = [];

  constructor(society: Society, theme: Theme) {
    const s = society;
    if (s.murkAll) this.add(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    if (s.murkHalf) this.add(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(0, 1, 1));
    for (const m of s.murk) {
      // A ball of murk, cut off where it would leave the world.
      const c = new THREE.Vector3(m.x, m.y, m.z);
      const lo = c.clone().subScalar(m.r).clampScalar(-1, 1);
      const hi = c.clone().addScalar(m.r).clampScalar(-1, 1);
      this.add(lo, hi, c, m.r);
    }
    this.setTheme(theme);
  }

  private add(lo: THREE.Vector3, hi: THREE.Vector3, centre = new THREE.Vector3(), radius = -1): void {
    const size = hi.clone().sub(lo);
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      // The far faces are drawn, so the haze still shows when the camera moves inside the murk.
      side: THREE.BackSide,
      uniforms: {
        uMin: { value: lo },
        uMax: { value: hi },
        uCentre: { value: centre },
        uRadius: { value: radius },
        uColor: { value: new THREE.Color() },
        uDensity: { value: DENSITY },
      },
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(lo).add(hi).multiplyScalar(0.5);
    mesh.frustumCulled = false;
    // Before the food stipple, the lines and the rings, which then draw over it.
    mesh.renderOrder = -1;
    this.group.add(mesh);
    this.mats.push(mat);
    this.geos.push(geo);
  }

  /** The haze takes the theme's ink: dark on paper, pale on a dark ground. */
  setTheme(t: Theme): void {
    for (const m of this.mats) {
      m.uniforms.uColor.value.set(t.css['--ink']);
      m.uniforms.uDensity.value = DENSITY * (t.dark ? 0.8 : 1);
    }
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
