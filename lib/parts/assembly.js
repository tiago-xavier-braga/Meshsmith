// Assembly: the bridge between asset.json parts and the generated mesh.
//   const a = assembly(bp, materials);
//   a.add('seat', bevelBox({ size: [0.45, 0.04, 0.45] }), { position: [0, 0.45, 0] });
//   return a.build();
// Each part takes its material, flags (hidden, mirror, stack, tiling) and smoothing
// from the blueprint entry with the same id. Parts are merged into one mesh
// (SM_<Nome>) with one submesh per material.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { finalize, transform } from './topology.js';

export function assembly(bp, materials) {
  const defs = new Map((bp.parts ?? []).map((p) => [p.id, p]));
  const items = [];

  const api = {
    /**
     * @param {string} id  part id from asset.json (repeat the id for instances, e.g. 4 legs)
     * @param {THREE.BufferGeometry} geo
     * @param {{ position?, rotation?, scale? }} [xf]
     */
    add(id, geo, xf) {
      const def = defs.get(id);
      if (!def) throw new Error(`part "${id}" is not declared in asset.json parts`);
      const smoothingAngle = def.smoothingAngle ?? bp.rules?.smoothingAngle ?? (bp.style === 'lowpoly' ? 0 : 40);
      const g = finalize(xf ? transform(geo, xf) : geo, { smoothingAngle, flat: smoothingAngle === 0 });
      items.push({ id, def, geo: g, instance: items.filter((i) => i.id === id).length });
      return api;
    },

    build() {
      const declared = [...defs.keys()].filter((id) => !items.some((i) => i.id === id));
      if (declared.length) throw new Error(`parts declared but never added: ${declared.join(', ')}`);
      const matIds = Object.keys(materials);
      const sorted = items.slice().sort((a, b) => matIds.indexOf(a.def.material) - matIds.indexOf(b.def.material));
      // Per-vertex part index lets the UV stage apply per-part rules (hidden, tiling, ...).
      sorted.forEach((it, pi) => {
        it.geo.setAttribute('partIndex', new THREE.Float32BufferAttribute(new Float32Array(it.geo.attributes.position.count).fill(pi), 1));
      });
      const merged = mergeGeometries(sorted.map((i) => i.geo), true);
      merged.groups.forEach((grp, gi) => { grp.materialIndex = matIds.indexOf(sorted[gi].def.material ?? matIds[0]); });
      const mesh = new THREE.Mesh(merged, matIds.map((id) => materials[id]));
      mesh.name = bp.meshName;
      mesh.userData._parts = sorted.map((it, pi) => ({
        index: pi, id: it.id, instance: it.instance, material: it.def.material,
        hidden: !!it.def.hidden, mirror: !!it.def.mirror, stack: !!it.def.stack, tiling: it.def.tiling ?? null,
        triangles: it.geo.index.count / 3,
      }));
      const root = new THREE.Group();
      root.name = bp.meshName;
      // The mesh sits under an empty root so engines keep the pivot at the root.
      mesh.name = `${bp.meshName}_Mesh`;
      root.add(mesh);
      return root;
    },
  };
  return api;
}
