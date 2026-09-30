// Builds report.json: every check from the spec's "Validação e critérios de aceite" table.
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { inspect } from '@gltf-transform/functions';
import { islands, rasterize, overlap, gaps, islandStats, densitySpread, seamPlacement, layoutImage } from '../uv/metrics.js';
import { meshTopology } from './mesh.js';
import { paletteCells, cellBounds } from '../materials/palette.js';

const require = createRequire(import.meta.url);
const gltfValidator = require('gltf-validator');

const PASS = 'pass', FAIL = 'fail', WARN = 'warn', PENDING = 'pending', NA = 'n/a';
const MIN_ISLAND_WIDTH = 4; // px
export const CHECKLIST = ['silhueta', 'proporcoes', 'partes', 'materiais', 'detalhes'];
const pct = (x) => `${(x * 100).toFixed(1)}%`;

function check(id, label, criterion, tool, blocking, status, value, details) {
  return { id, label, criterion, tool, blocking, status, value, ...(details ? { details } : {}) };
}

async function validateGLB(path) {
  const r = await gltfValidator.validateBytes(new Uint8Array(await readFile(path)), { maxIssues: 50 });
  return {
    errors: r.issues.numErrors,
    warnings: r.issues.numWarnings,
    messages: r.issues.messages.filter((m) => m.severity <= 1).slice(0, 10).map((m) => `${m.code} ${m.pointer ?? ''}`),
  };
}

function uvLayer(geo, attr, resolution, triFilter, densityScale) {
  const { triIsland, count } = islands(geo, triFilter, attr);
  const raster = rasterize(geo, attr, resolution, triIsland);
  const stats = islandStats(geo, attr, resolution, triIsland, count, densityScale);
  // Islands outside 0–1.
  const uv = geo.attributes[attr], idx = geo.index.array;
  const outside = new Set();
  for (let t = 0; t < idx.length / 3; t++) {
    if (triIsland[t] < 0) continue;
    for (let k = 0; k < 3; k++) {
      const u = uv.getX(idx[t * 3 + k]), v = uv.getY(idx[t * 3 + k]);
      if (u < -1e-6 || u > 1 + 1e-6 || v < -1e-6 || v > 1 + 1e-6) outside.add(triIsland[t]);
    }
  }
  return { triIsland, count, raster, stats, outside: outside.size };
}

/**
 * @param {{ bp, rules, root: THREE.Object3D, glbPath: string, uvInfo: object[], dir: string }} ctx
 * @returns {Promise<{ report: object, images: { name: string, rgba: Uint8Array, size: number }[] }>}
 */
export async function validateAsset({ bp, rules, root, glbPath, uvInfo, dir, lodInfo }) {
  const checks = [];
  const images = [];
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && o.userData._parts) meshes.push(o); });
  const mesh = meshes[0];
  const geo = mesh.geometry;
  const parts = mesh.userData._parts;
  const pi = geo.attributes.partIndex.array, idx = geo.index.array;
  const partOfTri = (t) => parts[pi[idx[t * 3]]];
  const info = uvInfo[0] ?? {};
  const res = info.resolution ?? rules.texture;
  const padding = info.padding ?? rules.padding, margin = info.margin ?? rules.margin;

  // 1. glTF-Validator
  const gv = await validateGLB(glbPath);
  checks.push(check('gltf', 'GLB válido', '0 erros, 0 warnings', 'glTF-Validator', true,
    gv.errors === 0 && gv.warnings === 0 ? PASS : FAIL, `${gv.errors} erros, ${gv.warnings} warnings`, gv.messages.length ? gv.messages : undefined));

  // 2. UV0 present on every vertex
  const hasUV0 = !!geo.attributes.uv && geo.attributes.uv.count === geo.attributes.position.count;
  checks.push(check('uv0-present', 'UV0 presente', '100% dos vértices', 'meshsmith', true, hasUV0 ? PASS : FAIL, hasUV0 ? '100%' : '0%'));

  if (hasUV0 && info.palette) {
    // Low-poly: UV0 is a palette lookup, island rules do not apply; every face must sit in its cell.
    const cells = paletteCells(bp), matIds = Object.keys(bp.materials), uv = geo.attributes.uv;
    let wrong = 0, total = 0;
    for (const grp of geo.groups) {
      const b = cellBounds(cells[matIds[grp.materialIndex]]);
      for (let i = grp.start; i < grp.start + grp.count; i += 3) {
        total++;
        for (let k = 0; k < 3; k++) {
          const u = uv.getX(idx[i + k]), v = uv.getY(idx[i + k]);
          if (u <= b.u0 || u >= b.u1 || v <= b.v0 || v >= b.v1) { wrong++; break; }
        }
      }
    }
    checks.push(check('palette', 'Paleta (low-poly)', 'toda face dentro da célula do seu material', 'meshsmith', true,
      wrong === 0 ? PASS : FAIL, `${total - wrong}/${total} faces, ${Object.keys(cells).length} cores`));
    for (const [id, label] of [['uv0-overlap', 'UV0 overlap'], ['uv0-range', 'UV0 fora de 0–1'], ['uv0-padding', 'Padding']]) {
      checks.push(check(id, label, 'não se aplica à paleta', 'meshsmith', true, NA, 'paleta low-poly'));
    }
  } else if (hasUV0) {
    // UV0 islands: exclude stack/mirror copies (they overlap on purpose) and tiling parts.
    const inAtlas = (t) => { const p = partOfTri(t); return !p.tiling && !((p.stack || p.mirror) && p.instance > 0); };
    const L0 = uvLayer(geo, 'uv', res, inAtlas, (t) => (partOfTri(t).hidden ? 0.25 : 1));
    const ov = overlap(L0.raster);
    checks.push(check('uv0-overlap', 'UV0 overlap', '0% (exceto mirror e stack)', 'meshsmith (rasterização)', true,
      ov.overlapped === 0 ? PASS : FAIL, `${ov.percent.toFixed(3)}% (${ov.overlapped} px)`));
    checks.push(check('uv0-range', 'UV0 fora de 0–1', '0 ilhas (exceto tiling declarado)', 'meshsmith', true,
      L0.outside === 0 ? PASS : FAIL, `${L0.outside} ilhas`));
    const g0 = gaps(L0.raster, padding + 2);
    const padOk = (g0.minGap === null || g0.minGap >= padding) && (g0.minBorder === null || g0.minBorder >= margin);
    checks.push(check('uv0-padding', 'Padding', `≥ ${padding} px entre ilhas, ≥ ${margin} px da borda (${res}²)`, 'meshsmith', true,
      padOk ? PASS : FAIL, `gap mín ${g0.minGap === null ? `> ${padding + 2}` : g0.minGap.toFixed(1)} px, borda mín ${g0.minBorder} px`));

    // Sub-texel islands (thin hidden strips) only measure xatlas quantisation, not stretch.
    const visible = L0.stats.filter((st) => st.width >= MIN_ISLAND_WIDTH);
    const tinyIslands = L0.stats.length - visible.length;
    const spread = densitySpread(visible);
    checks.push(check('uv0-texel-density', 'Texel density', `±${rules.texelVariance * 100}% entre ilhas`, 'meshsmith', false,
      spread.maxDeviation <= rules.texelVariance ? PASS : WARN,
      `${spread.median.toFixed(0)} px/m (mediana), desvio máx ${pct(spread.maxDeviation)}`,
      rules.texelDensity ? { target: rules.texelDensity, meetsTarget: spread.median >= rules.texelDensity * (1 - rules.texelVariance), textureResolution: res } : { textureResolution: res }));
    const worst = visible.reduce((m, s) => Math.max(m, s.areaDistortion, s.angleDistortion), 0);
    checks.push(check('uv0-distortion', 'Distorção', `≤ ${rules.maxDistortion * 100}% por ilha`, 'meshsmith (Jacobiano da UV)', false,
      worst <= rules.maxDistortion ? PASS : WARN, `pior ilha ${pct(worst)}${tinyIslands ? ` (${tinyIslands} faixas < ${MIN_ISLAND_WIDTH} px de largura ignoradas)` : ''}`));
    const util = ov.covered / (res * res);
    checks.push(check('uv0-utilization', 'Aproveitamento', `≥ ${rules.minUtilization * 100}% do espaço UV`, 'meshsmith', false,
      util >= rules.minUtilization ? PASS : WARN, pct(util)));
    const seams = seamPlacement(geo, 'uv', rules.continuousAngle, (t) => partOfTri(t).hidden);
    checks.push(check('uv0-seams', 'Seams', 'em arestas vivas ou áreas ocultas', 'meshsmith', false,
      seams.smoothVisibleRatio <= 0.25 ? PASS : WARN,
      `${pct(seams.smoothVisibleRatio)} do comprimento de seam em superfície contínua visível`, { islands: L0.count }));
    images.push({ name: 'uv0', rgba: layoutImage(L0.raster), size: res });
  }

  // UV1 lightmap
  if (rules.isStatic) {
    const has = !!geo.attributes.uv1;
    let status = has ? PASS : FAIL, value = has ? '' : 'ausente';
    if (has) {
      const lr = rules.lightmapResolution;
      const L1 = uvLayer(geo, 'uv1', lr, () => true, () => 1);
      const ov = overlap(L1.raster);
      const g1 = gaps(L1.raster, rules.lightmapPadding + 2);
      const ok = ov.overlapped === 0 && L1.outside === 0 && (g1.minGap === null || g1.minGap >= rules.lightmapPadding);
      status = ok ? PASS : FAIL;
      value = `${L1.count} ilhas, overlap ${ov.overlapped} px, gap mín ${g1.minGap === null ? `> ${rules.lightmapPadding + 2}` : g1.minGap.toFixed(1)} texels @ ${lr}²`;
      images.push({ name: 'uv1', rgba: layoutImage(L1.raster), size: lr });
    }
    checks.push(check('uv1-lightmap', 'UV1 lightmap', 'presente, sem overlap, padding ≥ 2 texels', 'meshsmith', true, status, value));
  } else {
    checks.push(check('uv1-lightmap', 'UV1 lightmap', 'presente e sem overlap se static', 'meshsmith', true, NA, 'asset não é static'));
  }

  // Mesh topology
  const topo = meshTopology(mesh);
  const badParts = topo.parts.filter((p) => p.open || p.nonManifold || p.volume <= 0);
  const meshOk = !badParts.length && topo.zeroArea === 0 && topo.normalMismatch === 0;
  checks.push(check('mesh', 'Malha', 'manifold, sem faces de área zero, normais para fora', 'meshsmith', true,
    meshOk ? PASS : FAIL,
    `${topo.parts.length - badParts.length}/${topo.parts.length} peças watertight, ${topo.zeroArea} faces área zero, ${topo.normalMismatch} normais invertidas`,
    badParts.length ? badParts.slice(0, 10) : undefined));

  // Dimensions and pivot
  // Render mesh (LOD0) only; LODs and the collider sit inside it anyway.
  const box = new THREE.Box3();
  root.traverse((o) => { if (o.isMesh && o.userData._parts) box.expandByObject(o, true); });
  const size = box.getSize(new THREE.Vector3());
  const d = bp.dimensions;
  const devs = { x: size.x / d.x - 1, y: size.y / d.y - 1, z: size.z / d.z - 1 };
  const dimOk = Object.values(devs).every((v) => Math.abs(v) <= rules.dimensionTolerance);
  const pivot = bp.pivot ?? 'base-center';
  // "Centre of the base" = mean of the footprint's contact patches (vertices in the lowest 1 cm,
  // grouped on a 2 cm grid), each patch counting once: a hose sticking out, a tripod's three
  // feet or a turned leg with more vertices than a square one must not move the pivot.
  const foot = new THREE.Box3(), wp = new THREE.Vector3(), cells = new Map();
  const addFoot = (p) => {
    foot.expandByPoint(p);
    const k = `${Math.floor(p.x / 0.02)}_${Math.floor(p.z / 0.02)}`;
    if (!cells.has(k)) cells.set(k, new THREE.Box3());
    cells.get(k).expandByPoint(p);
  };
  root.traverse((o) => {
    if (!o.isMesh || !o.userData._parts) return; // render mesh only: LODs and the hull would bridge the feet
    const pa = o.geometry.attributes.position, ix = o.geometry.index.array;
    const low = (i) => wp.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld).y <= box.min.y + 0.01;
    // Sample floor-level edges every centimetre so long edges keep a contact patch connected.
    for (let t = 0; t < ix.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const i = ix[t + e], j = ix[t + ((e + 1) % 3)];
        if (!low(i) || !low(j)) continue;
        const A = new THREE.Vector3().fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld);
        const B = new THREE.Vector3().fromBufferAttribute(pa, j).applyMatrix4(o.matrixWorld);
        const n = Math.max(1, Math.ceil(A.distanceTo(B) / 0.01));
        for (let k = 0; k <= n; k++) addFoot(A.clone().lerp(B, k / n));
      }
    }
  });
  const seen = new Set(), patches = [];
  for (const k of cells.keys()) {
    if (seen.has(k)) continue;
    const patch = new THREE.Box3(), queue = [k];
    seen.add(k);
    while (queue.length) {
      const cur = queue.pop(), [cx, cz] = cur.split('_').map(Number);
      patch.union(cells.get(cur));
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const n = `${cx + dx}_${cz + dz}`;
        if (cells.has(n) && !seen.has(n)) { seen.add(n); queue.push(n); }
      }
    }
    patches.push(patch.getCenter(new THREE.Vector3()));
  }
  const c = patches.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(Math.max(1, patches.length));
  const footSize = foot.getSize(new THREE.Vector3());
  const pivotOk = pivot === 'base-center'
    ? Math.abs(box.min.y) < 0.001 && Math.abs(c.x) <= Math.max(0.002, footSize.x * 0.05) && Math.abs(c.z) <= Math.max(0.002, footSize.z * 0.05)
    : Math.abs(box.min.x) < 0.001 && Math.abs(box.min.y) < 0.001 && Math.abs(box.min.z) < 0.001;
  checks.push(check('dimensions', 'Dimensões', `±${rules.dimensionTolerance * 100}% do blueprint, pivot ${pivot}`, 'meshsmith (bounding box)', true,
    dimOk && pivotOk ? PASS : FAIL,
    `${size.toArray().map((v) => v.toFixed(3)).join(' × ')} m (desvio ${Object.entries(devs).map(([k, v]) => `${k} ${pct(v)}`).join(', ')}); pivot ${pivotOk ? "ok" : "fora"} (centro da base XZ ${c.x.toFixed(3)}, ${c.z.toFixed(3)}; base y ${box.min.y.toFixed(4)})`));

  // Modular kits: every dimension a multiple of the grid, sockets listed.
  if (bp.grid !== undefined) {
    const g = typeof bp.grid === 'number' ? [bp.grid, bp.grid, bp.grid] : bp.grid;
    const off = size.toArray().map((v, k) => Math.abs(v / g[k] - Math.round(v / g[k])) * g[k]);
    const sockets = [];
    root.traverse((o) => { if (o.userData?.socket) sockets.push(o.userData.socket); });
    checks.push(check('grid', 'Grid do kit', `dimensões múltiplas de ${g.join(' × ')} m (±1 mm)`, 'meshsmith', true,
      off.every((v) => v <= 0.001) ? PASS : FAIL, `${size.toArray().map((v, k) => `${(v / g[k]).toFixed(2)}×${g[k]}`).join(', ')}; sockets: ${sockets.join(', ') || 'nenhum'}`));
  }

  // Triangle budget (glTF-Transform inspect on the written GLB)
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(glbPath);
  // Budget applies to the render mesh (LOD0); LOD1+ and the collider are extra.
  const tris = inspect(doc).meshes.properties.filter((m) => !/_LOD[1-9]$|_col$/.test(m.name)).reduce((s, m) => s + m.glPrimitives, 0);
  const [tmin, tmax] = rules.triangles;
  checks.push(check('triangles', 'Triângulos', `${tmin}–${tmax} (${rules.category})`, 'glTF-Transform inspect', true,
    tris > tmax ? FAIL : tris < tmin ? WARN : PASS, `${tris}${tris < tmin ? ' (abaixo do mínimo, só alerta)' : ''}`));

  // Textures: power of two at the declared size (baked in F4).
  const texs = doc.getRoot().listTextures();
  if (!texs.length) {
    checks.push(check('textures', 'Texturas', 'potência de 2, no tamanho declarado', 'sharp', true, NA, 'sem texturas (materiais por fator)'));
  } else {
    const sharp = (await import('sharp')).default;
    const bad = [];
    for (const t of texs) {
      const m = await sharp(Buffer.from(t.getImage())).metadata();
      const pow2 = (n) => n > 0 && (n & (n - 1)) === 0;
      if (!pow2(m.width) || !pow2(m.height) || m.width > res) bad.push(`${t.getName()} ${m.width}×${m.height}`);
    }
    checks.push(check('textures', 'Texturas', 'potência de 2, no tamanho declarado', 'sharp', true, bad.length ? FAIL : PASS,
      bad.length ? bad.join(', ') : `${texs.length} texturas ok`));
  }

  // Visual fidelity, filled by the /modelar-3d review (review.json in the asset folder).
  // Each view is scored by a fixed checklist (5 criteria × 0–2) so the score stays stable.
  const reviewPath = join(dir, 'review.json');
  let review = null;
  if (existsSync(reviewPath)) {
    review = JSON.parse(await readFile(reviewPath, 'utf8'));
    const views = Object.entries(review.checklist ?? {});
    const scores = views.length
      ? views.map(([view, items]) => [view, CHECKLIST.reduce((sum, k) => sum + Math.max(0, Math.min(2, Number(items[k] ?? 0))), 0)])
      : Object.entries(review.scores ?? {});
    const missing = views.flatMap(([view, items]) => CHECKLIST.filter((k) => items[k] === undefined).map((k) => `${view}.${k}`));
    const min = scores.length ? Math.min(...scores.map(([, v]) => v)) : 0;
    checks.push(check('visual', 'Fidelidade visual', `nota ≥ ${rules.minVisualScore}/10 em cada vista (checklist: ${CHECKLIST.join(', ')})`, 'Claude (visão)', true,
      scores.length && !missing.length && min >= rules.minVisualScore ? PASS : FAIL,
      `${scores.map(([k, v]) => `${k} ${v}`).join(', ')}${review.iteration ? ` (iteração ${review.iteration})` : ''}`,
      { ...(missing.length ? { missing } : {}), ...(review.differences?.length ? { differences: review.differences } : {}) }));
  } else {
    checks.push(check('visual', 'Fidelidade visual', `nota ≥ ${rules.minVisualScore}/10 em cada vista`, 'Claude (visão)', true, PENDING, 'sem review.json'));
  }

  // LODs and collision (spec: meshoptimizer LODs, <malha>_col).
  if (lodInfo) {
    const t = lodInfo.lods.map((l) => l.triangles);
    const decreasing = t.every((v, i) => i === 0 || v < t[i - 1]);
    checks.push(check('lods', 'LODs', 'LOD1/LOD2 com menos triângulos que o anterior', 'meshoptimizer', false,
      t.length === 1 ? NA : decreasing ? PASS : WARN, t.length === 1 ? 'asset pequeno, sem LODs' : lodInfo.lods.map((l) => `${l.name.replace(bp.meshName + '_', '')} ${l.triangles}`).join(', ')));
    checks.push(check('collision', 'Colisão', '<malha>_col presente', 'meshsmith', false,
      lodInfo.collision ? PASS : NA, lodInfo.collision ? `${lodInfo.collision.kind}, ${lodInfo.collision.triangles} triângulos` : 'desligada no blueprint'));
  }

  const blockingFailed = checks.filter((k) => k.blocking && k.status === FAIL).map((k) => k.id);
  const pending = checks.filter((k) => k.blocking && k.status === PENDING).map((k) => k.id);
  const warnings = checks.filter((k) => k.status === WARN).map((k) => k.id);
  const report = {
    asset: bp.name,
    mesh: bp.meshName,
    generatedAt: new Date().toISOString(),
    passed: blockingFailed.length === 0,
    readyToExport: blockingFailed.length === 0 && pending.length === 0,
    blockingFailed,
    pending,
    warnings,
    uv: uvInfo,
    iterations: existsSync(join(dir, 'iterations')) ? (await readdir(join(dir, 'iterations'))).filter((d) => /^\d+$/.test(d)).length : 0,
    review: review ? { iteration: review.iteration ?? null, checklist: review.checklist ?? null, notes: review.notes ?? null } : null,
    checks,
  };
  return { report, images };
}
