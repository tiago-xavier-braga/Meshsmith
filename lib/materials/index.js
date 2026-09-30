// Builds MeshStandardMaterial instances from blueprint.materials.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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

/**
 * Attaches the style's textures to the materials and writes the loose PNGs to out/textures/.
 * Low-poly: every material samples the shared palette (color comes from the texture, the
 * material keeps its own roughness/metalness). PBR: baked maps (lib/materials/bake.js).
 */
export async function applyTextures(root, bp, uvInfo, outDir) {
  const base = assetBaseName(bp);
  const written = [];
  await mkdir(join(outDir, 'textures'), { recursive: true });
  const save = async (name, png) => { await writeFile(join(outDir, 'textures', `${name}.png`), png); written.push(`${name}.png`); };
  const materials = new Set();
  root.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) materials.add(m); });
  if (uvInfo.palettePng) {
    const name = `T_${base}_Palette`;
    await save(name, uvInfo.palettePng);
    for (const m of materials) {
      m.color.set(1, 1, 1);
      m.userData.textures = { baseColor: uvInfo.palettePng };
      m.userData.textureNames = { baseColor: name };
    }
  }
  return written;
}
