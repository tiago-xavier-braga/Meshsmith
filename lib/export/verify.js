// Re-reads exported FBX/OBJ with assimp (assimpjs) and compares them with the source scene:
// same triangle count per mesh and the same bounding box (catches axis, unit and winding slips).
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
let ajsPromise = null;
const assimp = () => (ajsPromise ??= require('assimpjs')());

function walk(node, fn, parent = null) {
  fn(node, parent);
  for (const c of node.children ?? []) walk(c, fn, node);
}

/**
 * @param {string} file main file (.fbx or .obj); sidecar files (mtl) are read from the same folder
 * @param {string[]} extra sidecar file names
 */
export async function readBack(file, extra = []) {
  const ajs = await assimp();
  const list = new ajs.FileList();
  for (const f of [file, ...extra.map((e) => join(dirname(file), e))]) list.AddFile(basename(f), new Uint8Array(await readFile(f)));
  const result = ajs.ConvertFileList(list, 'assjson');
  if (!result.IsSuccess() || result.FileCount() === 0) throw new Error(`assimp could not read ${basename(file)}: ${result.GetErrorCode()}`);
  const json = JSON.parse(new TextDecoder().decode(result.GetFile(0).GetContent()));
  const meshes = json.meshes.map((m) => {
    const v = m.vertices, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[i + k]); max[k] = Math.max(max[k], v[i + k]); }
    return { name: m.name, triangles: m.faces.length, hasUV1: (m.texturecoords?.length ?? 0) > 1, min, max, material: json.materials?.[m.materialindex] };
  });
  // Owning node of each mesh (OBJ splits an object per material and names pieces after it).
  const names = [];
  walk(json.rootnode, (n) => {
    names.push(n.name);
    for (const mi of n.meshes ?? []) meshes[mi].node = n.name;
  });
  return { meshes, nodes: names, materials: json.materials?.length ?? 0 };
}

/**
 * @param {{ triangles: number, size: number[] }} expected render mesh (LOD0) triangles and bbox size
 * @param {Awaited<ReturnType<typeof readBack>>} back
 * @param {RegExp} include node (or mesh) names that belong to the render mesh
 */
export function compareBack(expected, back, include) {
  const mine = back.meshes.filter((m) => include.test(m.node ?? m.name) || include.test(m.name));
  const triangles = mine.reduce((s, m) => s + m.triangles, 0);
  const min = [0, 1, 2].map((k) => Math.min(...mine.map((m) => m.min[k])));
  const max = [0, 1, 2].map((k) => Math.max(...mine.map((m) => m.max[k])));
  const size = max.map((v, k) => v - min[k]);
  const sizeDev = size.map((v, k) => Math.abs(v / expected.size[k] - 1));
  return {
    ok: triangles === expected.triangles && sizeDev.every((d) => d <= 0.01),
    triangles, expectedTriangles: expected.triangles,
    size: size.map((v) => +v.toFixed(4)), expectedSize: expected.size.map((v) => +v.toFixed(4)),
    meshes: back.meshes.length, materials: back.materials,
  };
}
