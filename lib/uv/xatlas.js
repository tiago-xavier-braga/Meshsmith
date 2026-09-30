// Thin wrapper over the xatlas WASM build for Node.
import { createRequire } from 'node:module';
import { Api } from 'xatlasjs/dist/node/api.mjs';

const require = createRequire(import.meta.url);
const XAtlas = Api(require('xatlasjs/dist/node/xatlas.js'));
const WASM = require.resolve('xatlasjs/dist/node/xatlas.wasm');

let instance = null;
async function api() {
  instance ??= await new Promise((ok) => {
    const x = new XAtlas(() => ok(x), () => WASM);
  });
  return instance;
}

/**
 * Runs one xatlas pass at a fixed square resolution.
 * @param {{ index: Uint32Array|number[], positions: Float32Array, normals?: Float32Array }} mesh
 * @param {{ resolution: number, padding: number, texelsPerUnit: number }} opts
 * @returns {Promise<{ atlasCount: number, index: Uint32Array, oldIndexes: Uint32Array, uv: Float32Array, texelsPerUnit: number }>}
 */
// xatlas uses absolute epsilons; metre-scale chamfers (0.5 mm on hidden parts) fall under
// them, so geometry goes in as centimetres and texels-per-unit are converted back.
const INPUT_SCALE = 100;

// bruteForce packing stays off: in this build it produced overlaps and under-padded charts.
export async function runAtlas(mesh, { resolution, padding, texelsPerUnit, chartOptions = {} }) {
  if (mesh.positions.length / 3 > 65535) throw new Error('xatlas wrapper supports up to 65535 vertices per mesh');
  const xa = await api();
  xa.createAtlas();
  try {
    xa.addMesh(new Uint16Array(mesh.index), mesh.positions.map((v) => v * INPUT_SCALE), mesh.normals ?? null, null, 'mesh', !!mesh.normals, false, 1);
    const res = xa.generateAtlas(
      { maxIterations: 4, ...chartOptions },
      { resolution, padding, texelsPerUnit: texelsPerUnit / INPUT_SCALE, bilinear: true, blockAlign: false, bruteForce: false, rotateCharts: true, rotateChartsToAxis: true },
    );
    const m = res.meshes[0];
    // With a fixed resolution xatlas normalises UVs by that resolution.
    return {
      atlasCount: res.atlasCount,
      texelsPerUnit: res.texelsPerUnit * INPUT_SCALE,
      index: Uint32Array.from(m.index),
      oldIndexes: Uint32Array.from(m.oldIndexes),
      uv: Float32Array.from(m.vertex.coords1),
    };
  } finally {
    xa.destroyAtlas();
  }
}

/**
 * Finds the largest texels-per-unit that still packs into a single atlas of
 * `resolution`, i.e. the densest uniform layout (max utilisation).
 */
export async function packToFit(mesh, { resolution, padding, chartOptions, iterations = 7 }) {
  // Upper bound from total surface area: tpu such that the area alone fills the atlas.
  let area = 0;
  const p = mesh.positions, idx = mesh.index;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  let hi = resolution / Math.sqrt(area);
  let lo = hi * 0.2;
  let best = null;
  // Make sure lo fits.
  for (let k = 0; k < 6; k++) {
    const r = await runAtlas(mesh, { resolution, padding, texelsPerUnit: lo, chartOptions });
    if (r.atlasCount === 1) { best = r; break; }
    hi = lo;
    lo *= 0.5;
  }
  if (!best) throw new Error('xatlas could not pack the mesh into one atlas');
  for (let k = 0; k < iterations; k++) {
    const mid = (lo + hi) / 2;
    const r = await runAtlas(mesh, { resolution, padding, texelsPerUnit: mid, chartOptions });
    if (r.atlasCount === 1) { best = r; lo = mid; } else hi = mid;
    if (hi / lo < 1.02) break;
  }
  return best;
}
