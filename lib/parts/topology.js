// Mesh clean-up shared by every part: weld, orient, split normals by angle, CSG, transforms.
import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import Module from 'manifold-3d';

export const WELD_TOLERANCE = 1e-5; // 0.01 mm

/** Keeps only positions, welds coincident vertices and drops zero-area triangles. */
export function weld(geo, tolerance = WELD_TOLERANCE) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
  g.clearGroups();
  g = mergeVertices(g, tolerance);
  const pos = g.attributes.position, idx = g.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const keep = [];
  for (let i = 0; i < idx.length; i += 3) {
    const [i0, i1, i2] = [idx[i], idx[i + 1], idx[i + 2]];
    if (i0 === i1 || i1 === i2 || i0 === i2) continue;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    if (b.sub(a).cross(c.sub(a)).length() / 2 < 1e-10) continue;
    keep.push(i0, i1, i2);
  }
  g.setIndex(keep);
  return fixTJunctions(g);
}

/**
 * Splits triangles whose boundary edge has another boundary vertex lying on it
 * (T-junctions, typical of CSG output) so the mesh becomes watertight again.
 */
export function fixTJunctions(geo, { tolerance = 1e-5, maxPasses = 8 } = {}) {
  const pos = geo.attributes.position;
  const P = (i) => new THREE.Vector3().fromBufferAttribute(pos, i);
  for (let pass = 0; pass < maxPasses; pass++) {
    const idx = Array.from(geo.index.array);
    const count = new Map();
    const key = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
    for (let i = 0; i < idx.length; i += 3) {
      for (let e = 0; e < 3; e++) {
        const k = key(idx[i + e], idx[i + ((e + 1) % 3)]);
        count.set(k, (count.get(k) ?? 0) + 1);
      }
    }
    const boundaryVerts = new Set();
    for (const [k, c] of count) if (c === 1) for (const v of k.split('_')) boundaryVerts.add(+v);
    if (!boundaryVerts.size) return geo;
    const bv = [...boundaryVerts].map((i) => [i, P(i)]);
    const out = [];
    let splits = 0;
    const seg = new THREE.Vector3(), rel = new THREE.Vector3();
    for (let i = 0; i < idx.length; i += 3) {
      let done = false;
      for (let e = 0; e < 3 && !done; e++) {
        const a = idx[i + e], b = idx[i + ((e + 1) % 3)], c = idx[i + ((e + 2) % 3)];
        if (count.get(key(a, b)) !== 1) continue;
        const pa = P(a), pb = P(b);
        seg.subVectors(pb, pa);
        const len2 = seg.lengthSq();
        if (len2 < 1e-14) continue;
        const onEdge = [];
        for (const [v, pv] of bv) {
          if (v === a || v === b || v === c) continue;
          rel.subVectors(pv, pa);
          const t = rel.dot(seg) / len2;
          if (t <= 1e-6 || t >= 1 - 1e-6) continue;
          if (rel.addScaledVector(seg, -t).lengthSq() > tolerance * tolerance) continue;
          onEdge.push([t, v]);
        }
        if (!onEdge.length) continue;
        onEdge.sort((x, y) => x[0] - y[0]);
        const chain = [a, ...onEdge.map((x) => x[1]), b];
        for (let k = 0; k < chain.length - 1; k++) out.push(chain[k], chain[k + 1], c);
        splits++;
        done = true;
      }
      if (!done) out.push(idx[i], idx[i + 1], idx[i + 2]);
    }
    geo.setIndex(out);
    if (!splits) return geo;
  }
  return geo;
}

/** Signed volume of an indexed mesh (positive = normals outward). */
export function signedVolume(geo) {
  const pos = geo.attributes.position, idx = geo.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let v = 0;
  for (let i = 0; i < idx.length; i += 3) {
    a.fromBufferAttribute(pos, idx[i]); b.fromBufferAttribute(pos, idx[i + 1]); c.fromBufferAttribute(pos, idx[i + 2]);
    v += a.dot(b.cross(c)) / 6;
  }
  return v;
}

/**
 * Makes triangle winding consistent inside each connected component (BFS over shared
 * edges), then flips any component whose signed volume is negative. Generators such
 * as LoftGeometry caps can disagree with their walls; this fixes them all at once.
 */
export function orientOutward(geo) {
  const idx = geo.index.array;
  const triCount = idx.length / 3;
  const edgeFaces = new Map();
  const key = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (let f = 0; f < triCount; f++) {
    for (let e = 0; e < 3; e++) {
      const k = key(idx[f * 3 + e], idx[f * 3 + ((e + 1) % 3)]);
      if (!edgeFaces.has(k)) edgeFaces.set(k, []);
      edgeFaces.get(k).push(f);
    }
  }
  const hasDirected = (f, a, b) => {
    for (let e = 0; e < 3; e++) if (idx[f * 3 + e] === a && idx[f * 3 + ((e + 1) % 3)] === b) return true;
    return false;
  };
  const flip = (f) => { [idx[f * 3 + 1], idx[f * 3 + 2]] = [idx[f * 3 + 2], idx[f * 3 + 1]]; };
  const component = new Int32Array(triCount).fill(-1);
  const components = [];
  for (let seed = 0; seed < triCount; seed++) {
    if (component[seed] !== -1) continue;
    const cid = components.length, faces = [seed];
    faces.closed = true;
    component[seed] = cid;
    for (let q = 0; q < faces.length; q++) {
      const f = faces[q];
      for (let e = 0; e < 3; e++) {
        const a = idx[f * 3 + e], b = idx[f * 3 + ((e + 1) % 3)];
        const adj = edgeFaces.get(key(a, b));
        if (adj.length !== 2) { faces.closed = false; continue; } // only walk across manifold edges
        const n = adj[0] === f ? adj[1] : adj[0];
        if (component[n] !== -1) continue;
        if (hasDirected(n, a, b)) flip(n); // neighbour must traverse the edge as b->a
        component[n] = cid;
        faces.push(n);
      }
    }
    components.push(faces);
  }
  const pos = geo.attributes.position;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (const faces of components) {
    // An open component has no meaningful volume sign; keep the generator's winding.
    if (!faces.closed) continue;
    let vol = 0;
    for (const f of faces) {
      A.fromBufferAttribute(pos, idx[f * 3]); B.fromBufferAttribute(pos, idx[f * 3 + 1]); C.fromBufferAttribute(pos, idx[f * 3 + 2]);
      vol += A.dot(B.cross(C));
    }
    if (vol < 0) for (const f of faces) flip(f);
  }
  geo.index.needsUpdate = true;
  return geo;
}

export function flipWinding(geo) {
  const idx = geo.index.array;
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  geo.index.needsUpdate = true;
  return geo;
}

/**
 * Final clean-up for a part: weld, orient outward, split normals above `smoothingAngle`.
 * Returns an indexed geometry with position + normal; hard edges have split vertices,
 * which later forces a UV seam there (spec: "hard edge = seam").
 */
export function finalize(geo, { smoothingAngle = 40, flat = false } = {}) {
  const g = orientOutward(weld(geo));
  const creased = toCreasedNormals(g, THREE.MathUtils.degToRad(flat ? 0.01 : smoothingAngle));
  return mergeVertices(creased, WELD_TOLERANCE);
}

/**
 * Applies { position, rotation (degrees XYZ), scale } to a geometry copy.
 * Negative scale (mirroring) flips the winding back so normals stay outward.
 */
export function transform(geo, { position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  const s = typeof scale === 'number' ? [scale, scale, scale] : scale;
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation.map(THREE.MathUtils.degToRad))),
    new THREE.Vector3(...s),
  );
  const g = geo.clone().applyMatrix4(m);
  if (m.determinant() < 0) {
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    flipWinding(g);
  }
  return g;
}

/** Mirror across a plane through the origin: axis 'x' | 'y' | 'z'. */
export function mirror(geo, axis = 'x') {
  return transform(geo, { scale: { x: [-1, 1, 1], y: [1, -1, 1], z: [1, 1, -1] }[axis] });
}

// Booleans run on manifold-3d (WASM): inputs and outputs are guaranteed watertight,
// unlike BSP/BVH CSG which leaves slivers and T-junctions on the cut rims.
const wasm = await Module();
wasm.setup();

function toManifold(geo) {
  const g = orientOutward(weld(geo));
  const mesh = new wasm.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(g.attributes.position.array),
    triVerts: new Uint32Array(g.index.array),
  });
  mesh.merge();
  const m = new wasm.Manifold(mesh);
  if (m.status() !== 'NoError') throw new Error(`csg input is not manifold (${m.status()})`);
  return m;
}

/** Boolean ops: csg(a, 'subtract', b, c, ...) applied left to right. */
export function csg(base, op, ...others) {
  const OPS = { add: 'add', union: 'add', subtract: 'subtract', intersect: 'intersect' };
  if (!(op in OPS)) throw new Error(`csg op must be one of ${Object.keys(OPS)}`);
  let result = toManifold(base);
  for (const o of others) {
    const next = result[OPS[op]](toManifold(o));
    result.delete();
    result = next;
  }
  const mesh = result.getMesh();
  result.delete();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(mesh.vertProperties, 3));
  g.setIndex(Array.from(mesh.triVerts));
  return g;
}
