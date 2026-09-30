// Parametric part generators. All sizes in metres, Y up, front towards +Z.
// Every generator returns a closed BufferGeometry with only a position attribute
// meaningful; normals and UVs are rebuilt later by finalize() and lib/uv.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { LoftGeometry } from 'three/addons/geometries/LoftGeometry.js';

// LoftGeometry.clone() re-runs its constructor without args; hand out plain geometry.
const plain = (g) => new THREE.BufferGeometry().copy(g);
const v3 = (a) => (a?.isVector3 ? a : new THREE.Vector3(...a));
const v2 = (a) => (a?.isVector2 ? a : new THREE.Vector2(...a));

/**
 * Box with chamfered (segments = 1) or rounded (segments > 1) edges.
 * @param {{ size: [number,number,number], bevel?: number, segments?: number, origin?: 'center'|'base' }} o
 */
export function bevelBox({ size, bevel = 0.003, segments = 1, origin = 'base' }) {
  const [x, y, z] = size;
  const b = Math.min(bevel, x / 2 - 1e-5, y / 2 - 1e-5, z / 2 - 1e-5);
  let geo;
  if (b <= 0) {
    geo = new THREE.BoxGeometry(x, y, z);
  } else if (segments <= 1) {
    // Convex hull of the 3 inset points per corner = an exact 45° chamfer.
    const pts = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const hx = x / 2, hy = y / 2, hz = z / 2;
      pts.push(
        new THREE.Vector3(sx * hx, sy * (hy - b), sz * (hz - b)),
        new THREE.Vector3(sx * (hx - b), sy * hy, sz * (hz - b)),
        new THREE.Vector3(sx * (hx - b), sy * (hy - b), sz * hz),
      );
    }
    geo = new ConvexGeometry(pts);
  } else {
    geo = new RoundedBoxGeometry(x, y, z, segments, b);
  }
  if (origin === 'base') geo.translate(0, y / 2, 0);
  return geo;
}

/**
 * Surface of revolution around Y. profile = [[radius, y], ...] bottom to top.
 * Points with radius 0 at the ends become flat caps instead of degenerate fans.
 */
export function lathe({ profile, segments = 24, phiStart = 0, phiLength = Math.PI * 2 }) {
  let pts = profile.map(v2);
  const capStart = pts[0].x <= 1e-6;
  const capEnd = pts[pts.length - 1].x <= 1e-6;
  if (capStart) pts = pts.slice(1);
  if (capEnd) pts = pts.slice(0, -1);
  const full = Math.abs(phiLength - Math.PI * 2) < 1e-6;
  const n = full ? segments : segments + 1;
  const sections = pts.map((p) => {
    const ring = [];
    for (let i = 0; i < n; i++) {
      const a = phiStart + (i / segments) * phiLength;
      ring.push(new THREE.Vector3(Math.sin(a) * p.x, p.y, Math.cos(a) * p.x));
    }
    return ring;
  });
  return plain(new LoftGeometry(sections, { closed: full, capStart, capEnd }));
}

/** Cylinder along Y, base at y = 0, with optional chamfer on both rims. */
export function cylinder({ radius, height, segments = 24, bevel = 0.003, radiusTop }) {
  const rt = radiusTop ?? radius;
  const b = Math.min(bevel, radius / 2, rt / 2, height / 4);
  const profile = b > 0
    ? [[0, 0], [radius - b, 0], [radius, b], [rt, height - b], [rt - b, height], [0, height]]
    : [[0, 0], [radius, 0], [rt, height], [0, height]];
  return lathe({ profile, segments });
}

/**
 * Extruded 2D outline along +Z (depth), centred on Z. Holes are inner outlines.
 * @param {{ shape: [number,number][], holes?: [number,number][][], depth: number, bevel?: number, bevelSegments?: number, curveSegments?: number }} o
 */
export function extrude({ shape, holes = [], depth, bevel = 0.002, bevelSegments = 1, curveSegments = 12 }) {
  const s = new THREE.Shape(shape.map(v2));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(v2)));
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(depth - 2 * bevel, 1e-4),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments,
    curveSegments,
  });
  geo.translate(0, 0, -(depth - 2 * bevel) / 2);
  return geo;
}

/** Helper: rounded-rectangle outline for extrude(). */
export function roundedRect(w, h, r, steps = 4) {
  r = Math.min(r, w / 2, h / 2);
  const pts = [];
  const corners = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180], [w / 2 - r, -h / 2 + r, 270]];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= steps; i++) {
      const a = THREE.MathUtils.degToRad(a0 + (i / steps) * 90);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return pts;
}

/** Helper: circle outline for extrude() holes. */
export function circle(r, steps = 24, cx = 0, cy = 0) {
  return Array.from({ length: steps }, (_, i) => {
    const a = (i / steps) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
}

/**
 * Sweeps a closed 2D profile along a 3D path (handles, pipes, frames, rims).
 * profile defaults to a circle of `radius`. Ends are capped unless the path is closed.
 */
export function sweep({ path, profile, radius = 0.01, radialSegments = 12, segments = 32, closed = false, tension = 0.5, curve = 'catmullrom' }) {
  const pts = path.map(v3);
  const c = curve === 'polyline'
    ? polyline(pts, closed)
    : new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', tension);
  const prof = (profile ?? circle(radius, radialSegments)).map(v2);
  const frames = c.computeFrenetFrames(segments, closed);
  const sections = [];
  const count = closed ? segments : segments + 1;
  for (let i = 0; i < count; i++) {
    const p = c.getPointAt(i / segments);
    const N = frames.normals[i], B = frames.binormals[i];
    // Reverse order so the loft faces point outwards (see LoftGeometry docs).
    sections.push(prof.slice().reverse().map((q) => p.clone().addScaledVector(N, q.x).addScaledVector(B, q.y)));
  }
  if (closed) sections.push(sections[0].map((q) => q.clone()));
  return plain(new LoftGeometry(sections, { closed: true, capStart: !closed, capEnd: !closed }));
}

function polyline(pts, closed) {
  const path = new THREE.CurvePath();
  const all = closed ? [...pts, pts[0]] : pts;
  for (let i = 1; i < all.length; i++) path.add(new THREE.LineCurve3(all[i - 1], all[i]));
  return path;
}
