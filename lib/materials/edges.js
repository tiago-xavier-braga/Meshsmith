// Feature edges for wear masks: distance from a surface point to the nearest convex edge
// (plate borders, corners: where paint chips) and concave edge (seams, gaps: where grime sits).
import * as THREE from 'three';

const q = (v) => Math.round(v * 1e5);

/**
 * @param {THREE.BufferGeometry} geo indexed mesh
 * @param {number} minAngle degrees; flatter edges are ignored
 * @returns {{ convex: number[][], concave: number[][] }} segments [ax, ay, az, bx, by, bz]
 */
export function featureEdges(geo, minAngle = 25) {
  const pos = geo.attributes.position, idx = geo.index.array;
  const key = (i) => `${q(pos.getX(i))}_${q(pos.getY(i))}_${q(pos.getZ(i))}`;
  const P = (i) => new THREE.Vector3().fromBufferAttribute(pos, i);
  const faces = [];
  const edges = new Map();
  for (let t = 0; t < idx.length / 3; t++) {
    const a = P(idx[t * 3]), b = P(idx[t * 3 + 1]), c = P(idx[t * 3 + 2]);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    if (n.lengthSq() < 1e-16) continue;
    faces[t] = { n: n.normalize(), c: a.clone().add(b).add(c).divideScalar(3) };
    for (let e = 0; e < 3; e++) {
      const i = idx[t * 3 + e], j = idx[t * 3 + ((e + 1) % 3)];
      const ki = key(i), kj = key(j);
      const k = ki < kj ? `${ki}|${kj}` : `${kj}|${ki}`;
      if (!edges.has(k)) edges.set(k, { i, j, faces: [] });
      edges.get(k).faces.push(t);
    }
  }
  const cosMin = Math.cos(THREE.MathUtils.degToRad(minAngle));
  const convex = [], concave = [];
  for (const { i, j, faces: fs } of edges.values()) {
    if (fs.length !== 2 || !faces[fs[0]] || !faces[fs[1]]) continue;
    const [f1, f2] = [faces[fs[0]], faces[fs[1]]];
    if (f1.n.dot(f2.n) > cosMin) continue;
    const a = P(i), b = P(j);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    // Convex when the neighbour face lies behind the first face's plane.
    const seg = [a.x, a.y, a.z, b.x, b.y, b.z];
    (f2.c.clone().sub(mid).dot(f1.n) < 0 ? convex : concave).push(seg);
  }
  return { convex, concave };
}

/** Uniform grid over segments: distance queries up to `radius`. */
export class SegmentGrid {
  constructor(segments, radius) {
    this.r = radius;
    this.cells = new Map();
    this.segs = segments;
    const cell = (x) => Math.floor(x / radius);
    segments.forEach((s, si) => {
      const [x0, x1] = [Math.min(s[0], s[3]) - radius, Math.max(s[0], s[3]) + radius];
      const [y0, y1] = [Math.min(s[1], s[4]) - radius, Math.max(s[1], s[4]) + radius];
      const [z0, z1] = [Math.min(s[2], s[5]) - radius, Math.max(s[2], s[5]) + radius];
      for (let x = cell(x0); x <= cell(x1); x++) for (let y = cell(y0); y <= cell(y1); y++) for (let z = cell(z0); z <= cell(z1); z++) {
        const k = `${x}_${y}_${z}`;
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(si);
      }
    });
  }

  /** Distance from p to the nearest segment, or `radius` when none is closer. */
  distance(p) {
    const k = `${Math.floor(p[0] / this.r)}_${Math.floor(p[1] / this.r)}_${Math.floor(p[2] / this.r)}`;
    const list = this.cells.get(k);
    let best = this.r;
    if (!list) return best;
    for (const si of list) {
      const s = this.segs[si];
      const dx = s[3] - s[0], dy = s[4] - s[1], dz = s[5] - s[2];
      const px = p[0] - s[0], py = p[1] - s[1], pz = p[2] - s[2];
      const len2 = dx * dx + dy * dy + dz * dz || 1e-12;
      const t = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / len2));
      const d = Math.hypot(px - t * dx, py - t * dy, pz - t * dz);
      if (d < best) best = d;
    }
    return best;
  }
}
