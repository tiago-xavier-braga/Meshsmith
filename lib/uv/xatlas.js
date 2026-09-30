// Thin wrapper over the xatlas WASM build for Node.
// Charts are computed once per mesh (the expensive part) and then packed as many times as the
// density search needs: xatlas allows PackCharts to run repeatedly on the same charts.
import { createRequire } from 'node:module';
import { Api } from 'xatlasjs/dist/node/api.mjs';

const require = createRequire(import.meta.url);
const XAtlas = Api(require('xatlasjs/dist/node/xatlas.js'));
const WASM = require.resolve('xatlasjs/dist/node/xatlas.wasm');

// xatlas uses absolute epsilons; metre-scale chamfers (0.5 mm on hidden parts) fall under
// them, so geometry goes in as centimetres and texels-per-unit are converted back.
const INPUT_SCALE = 100;
const profile = (msg) => { if (process.env.MESHSMITH_PROFILE) console.log(`  xatlas ${msg}`); };

let instance = null;
async function api() {
  instance ??= await new Promise((ok) => {
    const x = new XAtlas(() => ok(x), () => WASM);
  });
  return instance;
}

/**
 * Opens an atlas for one mesh and computes its charts.
 * @param {{ index: Uint32Array|number[], positions: Float32Array, normals?: Float32Array }} mesh
 */
async function openSession(mesh, chartOptions = {}) {
  if (mesh.positions.length / 3 > 65535) throw new Error('xatlas wrapper supports up to 65535 vertices per mesh');
  const xa = await api();
  const t0 = performance.now();
  xa.createAtlas();
  xa.addMesh(new Uint16Array(mesh.index), mesh.positions.map((v) => v * INPUT_SCALE), mesh.normals ?? null, null, 'mesh', !!mesh.normals, false, 1);
  xa.xatlas.computeCharts({ ...xa.defaultChartOptions(), maxIterations: 4, ...chartOptions });
  profile(`charts ${mesh.index.length / 3} tris (${Math.round(performance.now() - t0)} ms)`);
  return {
    /** Packs at a fixed square resolution; UVs come back normalised by that resolution. */
    // bruteForce packing stays off: in this build it produced overlaps and under-padded charts.
    pack({ resolution, padding, texelsPerUnit }) {
      const t1 = performance.now();
      xa.xatlas.packCharts({
        ...xa.defaultPackOptions(),
        resolution, padding, texelsPerUnit: texelsPerUnit / INPUT_SCALE,
        bilinear: true, blockAlign: false, bruteForce: false, rotateCharts: true, rotateChartsToAxis: true,
      });
      const res = xa.getAtlas();
      const m = res.meshes[0];
      profile(`pack @${resolution} tpu ${Math.round(texelsPerUnit)} -> atlases ${res.atlasCount} (${Math.round(performance.now() - t1)} ms)`);
      return {
        atlasCount: res.atlasCount,
        texelsPerUnit: res.texelsPerUnit * INPUT_SCALE,
        index: Uint32Array.from(m.index),
        oldIndexes: Uint32Array.from(m.oldIndexes),
        uv: Float32Array.from(m.vertex.coords1),
      };
    },
    close() { xa.destroyAtlas(); },
  };
}

/** One-off chart + pack run. */
export async function runAtlas(mesh, { resolution, padding, texelsPerUnit, chartOptions = {} }) {
  const s = await openSession(mesh, chartOptions);
  try { return s.pack({ resolution, padding, texelsPerUnit }); } finally { s.close(); }
}

/**
 * Finds the largest texels-per-unit that still packs into a single atlas of
 * `resolution`, i.e. the densest uniform layout (max utilisation).
 * @param {{ resolution: number, padding: number, chartOptions?: object, iterations?: number, guess?: number }} opts
 */
export async function packToFit(mesh, opts) {
  const s = await openSession(mesh, opts.chartOptions);
  try { return fitSession(s, mesh, opts); } finally { s.close(); }
}

function surfaceArea(mesh) {
  let area = 0;
  const p = mesh.positions, idx = mesh.index;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return area;
}

function fitSession(s, mesh, { resolution, padding, iterations = 7, guess }) {
  // A guess (texels per unit from a previous pack of similar charts) narrows the bracket;
  // otherwise the upper bound is the density at which the bare surface fills the atlas.
  let hi = guess ? guess * 1.15 : resolution / Math.sqrt(surfaceArea(mesh));
  let lo = guess ? guess * 0.85 : hi * 0.2;
  let best = null;
  for (let k = 0; k < 8; k++) {
    const r = s.pack({ resolution, padding, texelsPerUnit: lo });
    if (r.atlasCount === 1) { best = r; break; }
    hi = lo;
    lo *= 0.6;
  }
  if (!best) throw new Error('xatlas could not pack the mesh into one atlas');
  for (let k = 0; k < iterations; k++) {
    const mid = (lo + hi) / 2;
    const r = s.pack({ resolution, padding, texelsPerUnit: mid });
    if (r.atlasCount === 1) { best = r; lo = mid; } else hi = mid;
    if (hi / lo < 1.02) break;
  }
  return best;
}

/**
 * Same as packToFit but keeps the charts open, so several resolutions can be tried
 * (auto texture size) without recomputing them. Call close() when done.
 */
export async function chartSession(mesh, chartOptions) {
  const s = await openSession(mesh, chartOptions);
  return { fit: (opts) => fitSession(s, mesh, opts), close: () => s.close() };
}
