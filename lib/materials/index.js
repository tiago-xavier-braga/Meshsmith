// Builds MeshStandardMaterial instances from blueprint.materials.
import * as THREE from 'three';

const pascal = (s) => s.replace(/(^|[-_ ])(\w)/g, (_, __, c) => c.toUpperCase());

export function assetBaseName(bp) {
  return bp.meshName.replace(/^SM_/, '');
}

export function createMaterials(bp) {
  const base = assetBaseName(bp);
  const out = {};
  for (const [id, def] of Object.entries(bp.materials ?? {})) {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(def.color ?? '#cccccc'),
      roughness: def.roughness ?? 0.7,
      metalness: def.metalness ?? 0,
    });
    m.name = def.name ?? `M_${base}_${pascal(id)}`;
    m.userData.id = id;
    m.userData.def = def;
    m.userData.textureBaseName = `T_${base}`;
    out[id] = m;
  }
  return out;
}
