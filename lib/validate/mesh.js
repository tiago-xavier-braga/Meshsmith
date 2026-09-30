// Mesh topology checks: per-part manifold/watertight, zero-area faces, outward normals.
import * as THREE from 'three';
import { weld, WELD_TOLERANCE } from '../parts/topology.js';

/** Extracts the triangles of one part as a position-only soup. */
export function partGeometry(geo, partIndex) {
  const part = geo.attributes.partIndex, pos = geo.attributes.position, idx = geo.index.array;
  const out = [];
  for (let i = 0; i < idx.length; i += 3) {
    if (part.getX(idx[i]) !== partIndex) continue;
    for (let k = 0; k < 3; k++) out.push(pos.getX(idx[i + k]), pos.getY(idx[i + k]), pos.getZ(idx[i + k]));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return g;
}

function edgeStats(g) {
  const idx = g.index.array, count = new Map();
  for (let i = 0; i < idx.length; i += 3) for (let e = 0; e < 3; e++) {
    const a = idx[i + e], b = idx[i + ((e + 1) % 3)], k = a < b ? `${a}_${b}` : `${b}_${a}`;
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  let open = 0, nonManifold = 0;
  for (const c of count.values()) { if (c === 1) open++; else if (c > 2) nonManifold++; }
  return { open, nonManifold };
}

function signedVolume(g) {
  const pos = g.attributes.position, idx = g.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let v = 0;
  for (let i = 0; i < idx.length; i += 3) {
    a.fromBufferAttribute(pos, idx[i]); b.fromBufferAttribute(pos, idx[i + 1]); c.fromBufferAttribute(pos, idx[i + 2]);
    v += a.dot(b.cross(c)) / 6;
  }
  return v;
}

/** @returns {{ parts: object[], zeroArea: number, normalMismatch: number, triangles: number }} */
export function meshTopology(mesh) {
  const geo = mesh.geometry;
  const parts = mesh.userData._parts.map((p) => {
    // weld() drops zero-area faces, so compare against the raw count below.
    const w = weld(partGeometry(geo, p.index), WELD_TOLERANCE);
    const e = edgeStats(w);
    return { id: p.id, instance: p.instance, ...e, volume: signedVolume(w) };
  });

  // Zero-area faces and vertex normals pointing against their face, on the final mesh.
  const pos = geo.attributes.position, nrm = geo.attributes.normal, idx = geo.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), vn = new THREE.Vector3();
  let zeroArea = 0, normalMismatch = 0;
  for (let i = 0; i < idx.length; i += 3) {
    a.fromBufferAttribute(pos, idx[i]); b.fromBufferAttribute(pos, idx[i + 1]); c.fromBufferAttribute(pos, idx[i + 2]);
    n.subVectors(b, a).cross(c.sub(a));
    if (n.length() / 2 < 1e-10) { zeroArea++; continue; }
    vn.set(0, 0, 0);
    for (let k = 0; k < 3; k++) vn.x += nrm.getX(idx[i + k]), vn.y += nrm.getY(idx[i + k]), vn.z += nrm.getZ(idx[i + k]);
    if (vn.dot(n) <= 0) normalMismatch++;
  }
  return { parts, zeroArea, normalMismatch, triangles: idx.length / 3 };
}
