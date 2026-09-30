// Quick topology report: open / non-manifold edges per part (welded).
import * as THREE from 'three';
import { buildAsset, assetDir } from '../lib/core/asset.js';
import { weld } from '../lib/parts/topology.js';

function partGeometry(geo, pi) {
  const part = geo.attributes.partIndex, pos = geo.attributes.position, idx = geo.index.array;
  const out = [];
  for (let i = 0; i < idx.length; i += 3) {
    if (part.getX(idx[i]) !== pi) continue;
    for (let k = 0; k < 3; k++) out.push(pos.getX(idx[i + k]), pos.getY(idx[i + k]), pos.getZ(idx[i + k]));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return g;
}

for (const name of process.argv.slice(2)) {
  const { root } = await buildAsset(assetDir(name));
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const p of o.userData._parts) {
      const g = weld(partGeometry(o.geometry, p.index));
      const idx = g.index.array, count = new Map();
      for (let i = 0; i < idx.length; i += 3) for (let e = 0; e < 3; e++) {
        const a = idx[i + e], b = idx[i + (e + 1) % 3], k = a < b ? `${a}_${b}` : `${b}_${a}`;
        count.set(k, (count.get(k) ?? 0) + 1);
      }
      let open = 0, nonManifold = 0;
      for (const c of count.values()) { if (c === 1) open++; else if (c > 2) nonManifold++; }
      if (open || nonManifold) console.log(name, `${p.id}#${p.instance}`, { tris: idx.length / 3, open, nonManifold });
    }
    console.log(name, 'checked', o.userData._parts.length, 'parts');
  });
}
