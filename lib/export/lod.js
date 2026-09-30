// LODs (meshoptimizer) and collision meshes, added as sibling nodes of the render mesh:
//   SM_<Nome>_LOD0 (render mesh), SM_<Nome>_LOD1, SM_<Nome>_LOD2, SM_<Nome>_col
// LODs reuse the LOD0 vertices (same UVs, same baked textures); UV seams and material
// borders are locked so the simplified mesh never tears or smears a texture.
import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const DEFAULT_LODS = [0.5, 0.25];
const MIN_TRIANGLES_FOR_LODS = 600;
const COLLISION_MAX_TRIANGLES = 256;

/**
 * Index buffer of one group simplified to `ratio`, within a relative error of 2%.
 * Normals weigh in (attributes) so shading survives; borders (UV seams) stay locked.
 */
function simplifyGroup(pos, indices, ratio, normals = null) {
  const target = Math.max(3, Math.floor((indices.length * ratio) / 3) * 3);
  const [out] = normals
    ? MeshoptSimplifier.simplifyWithAttributes(new Uint32Array(indices), pos, 3, normals, 3, [0.3, 0.3, 0.3], null, target, 0.02, ['LockBorder'])
    : MeshoptSimplifier.simplify(new Uint32Array(indices), pos, 3, target, 0.02, ['LockBorder']);
  return out;
}

/** Copy of `geo` keeping only the vertices referenced by `groups` (compact). */
function compact(geo, groups) {
  const remap = new Map();
  const index = [];
  const outGroups = [];
  for (const { indices, materialIndex } of groups) {
    const start = index.length;
    for (const i of indices) {
      if (!remap.has(i)) remap.set(i, remap.size);
      index.push(remap.get(i));
    }
    outGroups.push({ start, count: index.length - start, materialIndex });
  }
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const n = attr.itemSize, arr = new Float32Array(remap.size * n);
    for (const [src, dst] of remap) for (let k = 0; k < n; k++) arr[dst * n + k] = attr.array[src * n + k];
    g.setAttribute(name, new THREE.BufferAttribute(arr, n));
  }
  g.setIndex(index);
  for (const grp of outGroups) g.addGroup(grp.start, grp.count, grp.materialIndex);
  return g;
}

/**
 * @param {THREE.Group} root asset root (contains the assembled render mesh)
 * @param {object} bp blueprint; `lods: [ratios] | false`, `collision: "hull" | "box" | false`
 * @returns {Promise<{ lods: { name: string, triangles: number }[], collision: object|null }>}
 */
export async function addLodsAndCollision(root, bp) {
  await MeshoptSimplifier.ready;
  let mesh = null;
  root.traverse((o) => { if (o.isMesh && o.userData._parts) mesh = o; });
  const geo = mesh.geometry;
  const tris = geo.index.count / 3;
  const info = { lods: [{ name: `${bp.meshName}_LOD0`, triangles: tris }], collision: null };
  const ratios = bp.lods === false ? [] : (bp.lods ?? (tris >= MIN_TRIANGLES_FOR_LODS ? DEFAULT_LODS : []));
  if (ratios.length) mesh.name = `${bp.meshName}_LOD0`;
  const pos = geo.attributes.position.array;
  const idx = geo.index.array;
  // Groups follow the assembly's part order; decals (thin labels, stickers) keep full detail,
  // otherwise the surface below pokes through them once simplified.
  const parts = mesh.userData._parts;
  const decal = new Set(bp.parts.filter((p) => p.decal).map((p) => p.id));
  const nrm = geo.attributes.normal.array;
  ratios.forEach((ratio, i) => {
    const groups = geo.groups.map((g, gi) => {
      const indices = idx.slice(g.start, g.start + g.count);
      return { materialIndex: g.materialIndex, indices: decal.has(parts[gi]?.id) ? indices : simplifyGroup(pos, indices, ratio, nrm) };
    });
    const lod = new THREE.Mesh(compact(geo, groups), mesh.material);
    lod.name = `${bp.meshName}_LOD${i + 1}`;
    lod.userData.lod = i + 1;
    root.add(lod);
    info.lods.push({ name: lod.name, triangles: lod.geometry.index.count / 3 });
  });

  const kind = bp.collision === undefined ? 'hull' : bp.collision;
  if (kind) {
    let cg;
    if (kind === 'box') {
      const b = new THREE.Box3().setFromBufferAttribute(geo.attributes.position);
      const s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      cg = new THREE.BoxGeometry(s.x, s.y, s.z).translate(c.x, c.y, c.z);
    } else {
      const pts = [];
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(p, i));
      cg = new ConvexGeometry(pts);
    }
    for (const n of Object.keys(cg.attributes)) if (n !== 'position') cg.deleteAttribute(n);
    cg = mergeVertices(cg, 1e-5);
    if (cg.index.count / 3 > COLLISION_MAX_TRIANGLES) {
      const out = simplifyGroup(cg.attributes.position.array, cg.index.array, (COLLISION_MAX_TRIANGLES * 3) / cg.index.count);
      cg = compact(cg, [{ indices: Array.from(out), materialIndex: 0 }]); // drop vertices the simplifier left unused
    }
    cg.computeVertexNormals();
    const col = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ name: 'M_Collision' }));
    col.name = `${bp.meshName}_col`;
    col.userData.collision = kind;
    root.add(col);
    info.collision = { name: col.name, kind, triangles: cg.index.count / 3 };
  }
  return info;
}
