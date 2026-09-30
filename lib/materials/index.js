// Builds MeshStandardMaterial instances from blueprint.materials.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as THREE from 'three';
import { bakePBR, bakeTile, addTangents } from './bake.js';

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
      // Emissive (eyes, LEDs): glTF emissiveFactor; not baked, so it survives the PBR bake.
      emissive: new THREE.Color(def.emissive ?? '#000000'),
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
export async function applyTextures(root, bp, uvInfo, outDir, rules) {
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
      m.userData.textureFiles = { baseColor: `textures/${name}.png` };
    }
  } else if (rules?.style === 'pbr' && bp.bake !== false) {
    const meshes = [];
    root.traverse((o) => { if (o.isMesh && o.userData._parts) meshes.push(o); });
    // Materials of tiling parts get their own seamless tile; the rest share the atlas bake.
    const tiling = new Map();
    for (const p of bp.parts) if (p.tiling) tiling.set(p.material, p.tiling);
    const atlasMats = [...materials].filter((m) => !tiling.has(m.userData.id));
    // Maps carry the values, so factors go to 1 (glTF multiplies factor × texture).
    const useMaps = (m, maps, name) => {
      m.color.set(1, 1, 1);
      m.roughness = 1;
      m.metalness = 1;
      m.userData.textures = { baseColor: maps.baseColor, normal: maps.normal, orm: maps.orm };
      m.userData.textureNames = { baseColor: `${name}_BaseColor`, normal: `${name}_Normal`, orm: `${name}_ORM` };
      m.userData.textureFiles = { baseColor: `textures/${name}_BaseColor.png`, normal: `textures/${name}_Normal.png`, orm: `textures/${name}_ORM.png` };
    };
    if (atlasMats.length) {
      const r = await bakePBR(meshes[0], bp, rules, uvInfo[0].resolution);
      await save(`T_${base}_BaseColor`, r.baseColor);
      await save(`T_${base}_Normal`, r.normal);
      await save(`T_${base}_ORM`, r.orm);
      for (const m of atlasMats) useMaps(m, r, `T_${base}`);
      uvInfo.bake = { ms: r.ms, presets: r.presets, resolution: r.resolution };
    }
    for (const m of [...materials].filter((q) => tiling.has(q.userData.id))) {
      const size = tiling.get(m.userData.id);
      const res = 2 ** Math.round(Math.log2(Math.min(2048, Math.max(256, size * (rules.texelDensity ?? 512)))));
      const t = await bakeTile(m.userData.id, bp.materials[m.userData.id], size, res, 11 + Object.keys(bp.materials).indexOf(m.userData.id));
      const name = `T_${base}_${pascal(m.userData.id)}`;
      await save(`${name}_BaseColor`, t.baseColor);
      await save(`${name}_Normal`, t.normal);
      await save(`${name}_ORM`, t.orm);
      useMaps(m, t, name);
      (uvInfo.tiles ??= []).push({ material: m.userData.id, tileSize: size, resolution: res });
    }
    // Tangents for the tiling parts too (the atlas bake adds them for the whole mesh).
    if (!atlasMats.length) meshes[0].geometry = await addTangents(meshes[0].geometry);
  }
  return written;
}
