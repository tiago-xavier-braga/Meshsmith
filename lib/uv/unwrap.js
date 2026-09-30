// UV0 (textures) and UV1 (lightmap) generation for an assembled asset mesh.
// Rules from the spec:
//  - hard edges are already split vertices, so xatlas can never join charts across them;
//  - hidden parts (bottom on the floor) get 25% of the texel density;
//  - `stack` / `mirror` parts: only instance 0 is unwrapped, the other instances reuse its UVs;
//  - `tiling` parts get a world-space box projection (outside 0–1 on purpose), no atlas slot.
import * as THREE from 'three';
import { packToFit, runAtlas, chartSession } from './xatlas.js';
import { PADDING } from '../core/rules.js';
import { applyPalette, PALETTE } from '../materials/palette.js';

const HIDDEN_SCALE = 0.25; // linear texel density factor for never-seen faces
const CHART_SHRINK = 5e-4;  // relative pull towards the chart centroid (xatlas input only)
// UV0 charts come from segmentCharts(); xatlas' own growth costs are neutralised so it only
// splits a chart when its parameterisation would self-overlap.
const UV0_CHART_OPTIONS = { maxCost: 1000, normalDeviationWeight: 0, roundnessWeight: 0, straightnessWeight: 0, normalSeamWeight: 0, textureSeamWeight: 0 };

/**
 * Seam placement, decided here instead of by xatlas (spec: "seams definidos por peça no
 * gerador; xatlas só empacota"). Region-grows charts over the welded surface of one part:
 *  - smooth continuation (dihedral < smoothContinuation) always joins, so a cylinder stays one band
 *    (then cut once along its back meridian);
 *  - otherwise a face joins if the edge is below seamAngle and the face stays within
 *    seamAngle of the chart's seed normal (chamfers go with their face, not around corners).
 * Seeds are taken largest-face first so big faces own their chamfers.
 */
export function segmentCharts(geo, t0, t1, { seamAngle = 60, smoothContinuation = 35, strict = new Set() } = {}) {
  const idx = geo.index.array, pos = geo.attributes.position;
  const n = t1 - t0;
  const key = (i) => `${Math.round(pos.getX(i) * 1e5)}_${Math.round(pos.getY(i) * 1e5)}_${Math.round(pos.getZ(i) * 1e5)}`;
  const normals = new Float32Array(n * 3), areas = new Float32Array(n);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const edges = new Map();
  for (let f = 0; f < n; f++) {
    const t = t0 + f;
    a.fromBufferAttribute(pos, idx[t * 3]); b.fromBufferAttribute(pos, idx[t * 3 + 1]); c.fromBufferAttribute(pos, idx[t * 3 + 2]);
    const nn = b.sub(a).cross(c.sub(a));
    areas[f] = nn.length() / 2;
    nn.normalize();
    normals.set([nn.x, nn.y, nn.z], f * 3);
    for (let e = 0; e < 3; e++) {
      const ka = key(idx[t * 3 + e]), kb = key(idx[t * 3 + ((e + 1) % 3)]);
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (!edges.has(k)) edges.set(k, []);
      edges.get(k).push(f);
    }
  }
  const neighbours = Array.from({ length: n }, () => []);
  for (const list of edges.values()) if (list.length === 2) { neighbours[list[0]].push(list[1]); neighbours[list[1]].push(list[0]); }
  const dot = (f, g) => normals[f * 3] * normals[g * 3] + normals[f * 3 + 1] * normals[g * 3 + 1] + normals[f * 3 + 2] * normals[g * 3 + 2];
  const cosSeam = Math.cos(THREE.MathUtils.degToRad(seamAngle));
  const cosSmooth = Math.cos(THREE.MathUtils.degToRad(smoothContinuation));
  const order = [...Array(n).keys()].sort((x, y) => areas[y] - areas[x]);
  const centroidOf = (f) => {
    const t = t0 + f, out = [0, 0, 0];
    for (let k = 0; k < 3; k++) { const v = idx[t * 3 + k]; out[0] += pos.getX(v) / 3; out[1] += pos.getY(v) / 3; out[2] += pos.getZ(v) / 3; }
    return out;
  };

  // Region growing over `faces`; `blocked(f, g)` vetoes crossing an edge.
  let charts = 0;
  const chartOf = new Int32Array(n).fill(-1);
  const grow = (faces, blocked) => {
    const inSet = new Set(faces);
    for (const f of faces) chartOf[f] = -1;
    const created = [];
    for (const seed of order) {
      if (!inSet.has(seed) || chartOf[seed] !== -1) continue;
      const id = charts++;
      created.push(id);
      chartOf[seed] = id;
      const queue = [seed];
      for (let q = 0; q < queue.length; q++) {
        const f = queue[q];
        for (const g of neighbours[f]) {
          if (!inSet.has(g) || chartOf[g] !== -1 || blocked(f, g)) continue;
          const d = dot(f, g);
          const loose = !strict.has(t0 + f) && !strict.has(t0 + g);
          if (d >= cosSmooth || (loose && d >= cosSeam && dot(seed, g) >= cosSeam)) {
            chartOf[g] = id;
            queue.push(g);
          }
        }
      }
    }
    return created;
  };
  const initial = grow([...Array(n).keys()], () => false);

  // Closed bands (drum wall, hoops, hole walls) would be cut by xatlas wherever it likes.
  // Cut them ourselves along the back meridian (-Z; -Y for bands around Z), a low-visibility spot.
  const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (const id of initial) {
    const faces = [];
    for (let f = 0; f < n; f++) if (chartOf[f] === id) faces.push(f);
    if (faces.length < 6) continue;
    let total = 0;
    const along = [0, 0, 0], sum = [0, 0, 0], cen = [0, 0, 0];
    for (const f of faces) {
      const w = areas[f], cf = centroidOf(f);
      total += w;
      for (let k = 0; k < 3; k++) { along[k] += w * normals[f * 3 + k] ** 2; sum[k] += w * normals[f * 3 + k]; cen[k] += w * cf[k]; }
    }
    const axis = along.indexOf(Math.min(...along));
    const net = Math.hypot(...sum.map((v, k) => (k === axis ? 0 : v))) / total;
    if (along[axis] / total > 0.35 || net > 0.3) continue; // not a closed band around a principal axis
    const c = cen.map((v) => v / total);
    const hide = axis === 2 ? [0, -1, 0] : [0, 0, -1];
    const A = AXES[axis];
    const side = [A[1] * hide[2] - A[2] * hide[1], A[2] * hide[0] - A[0] * hide[2], A[0] * hide[1] - A[1] * hide[0]];
    const proj = (p, d) => (p[0] - c[0]) * d[0] + (p[1] - c[1]) * d[1] + (p[2] - c[2]) * d[2];
    grow(faces, (f, g) => {
      const cf = centroidOf(f), cg = centroidOf(g);
      return proj(cf, hide) > 0 && proj(cg, hide) > 0 && Math.sign(proj(cf, side)) !== Math.sign(proj(cg, side));
    });
  }
  const sums = Array.from({ length: charts }, () => [0, 0, 0, 0]);
  for (let f = 0; f < n; f++) {
    const t = t0 + f, s = sums[chartOf[f]];
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k];
      s[0] += pos.getX(v) * areas[f]; s[1] += pos.getY(v) * areas[f]; s[2] += pos.getZ(v) * areas[f]; s[3] += areas[f];
    }
  }
  const centroids = sums.map((s) => (s[3] > 0 ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : [0, 0, 0]));
  return { chartOf, centroids, count: charts };
}

function partRanges(geo, parts) {
  // mergeGeometries concatenates parts, so vertices and triangles of each part are contiguous.
  const pi = geo.attributes.partIndex.array, idx = geo.index.array;
  const ranges = parts.map(() => ({ v0: Infinity, v1: -1, t0: Infinity, t1: -1 }));
  for (let v = 0; v < pi.length; v++) {
    const r = ranges[pi[v]];
    r.v0 = Math.min(r.v0, v); r.v1 = Math.max(r.v1, v + 1);
  }
  for (let t = 0; t < idx.length / 3; t++) {
    const r = ranges[pi[idx[t * 3]]];
    r.t0 = Math.min(r.t0, t); r.t1 = Math.max(r.t1, t + 1);
  }
  return ranges;
}

/** Output buffer that accumulates vertices (copied from a source geometry) and triangles. */
class Builder {
  constructor(src) {
    this.src = src;
    this.names = Object.keys(src.attributes).filter((n) => n !== 'uv' && n !== 'uv1');
    this.data = Object.fromEntries(this.names.map((n) => [n, []]));
    this.uv = [];
    this.index = [];
    this.count = 0;
  }
  vertex(srcIndex, u, v) {
    for (const n of this.names) {
      const a = this.src.attributes[n];
      for (let k = 0; k < a.itemSize; k++) this.data[n].push(a.array[srcIndex * a.itemSize + k]);
    }
    this.uv.push(u, v);
    return this.count++;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    for (const n of this.names) g.setAttribute(n, new THREE.Float32BufferAttribute(this.data[n], this.src.attributes[n].itemSize));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.index);
    return g;
  }
}

function boxProject(geo, triStart, triEnd, tile, out, triOut) {
  const idx = geo.index.array, pos = geo.attributes.position;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const cache = new Map();
  for (let t = triStart; t < triEnd; t++) {
    const tri = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
    a.fromBufferAttribute(pos, tri[0]); b.fromBufferAttribute(pos, tri[1]); c.fromBufferAttribute(pos, tri[2]);
    n.subVectors(b, a).cross(c.clone().sub(a));
    const ax = Math.abs(n.x) >= Math.abs(n.y) && Math.abs(n.x) >= Math.abs(n.z) ? 0 : Math.abs(n.y) >= Math.abs(n.z) ? 1 : 2;
    triOut[t] = tri.map((vi) => {
      const key = `${vi}_${ax}`;
      if (!cache.has(key)) {
        const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi);
        const [u, v] = ax === 0 ? [z, y] : ax === 1 ? [x, z] : [x, y];
        cache.set(key, out.vertex(vi, u / tile, v / tile));
      }
      return cache.get(key);
    });
  }
}

/**
 * xatlas (LSCM) may emit mirrored charts. Mirrored islands are flipped in U inside their
 * own bounding box when no other island is nested there (footprint preserved). The rest stay
 * mirrored, which engines handle through the tangent sign (MikkTSpace).
 */
function orientIslands(out, tris) {
  const P = out.data.position, uv = out.uv;
  const parent = new Int32Array(out.count).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  const seen = new Map();
  for (const tri of tris) for (const v of tri) {
    const k = `${Math.round(P[v * 3] * 1e5)}_${Math.round(P[v * 3 + 1] * 1e5)}_${Math.round(P[v * 3 + 2] * 1e5)}_${Math.round(uv[v * 2] * 1e6)}_${Math.round(uv[v * 2 + 1] * 1e6)}`;
    if (seen.has(k)) parent[find(v)] = find(seen.get(k)); else seen.set(k, v);
  }
  for (const [a, b, c] of tris) { parent[find(b)] = find(a); parent[find(c)] = find(a); }
  const isl = new Map();
  for (const [a, b, c] of tris) {
    const r = find(a);
    if (!isl.has(r)) isl.set(r, { signed: 0, verts: new Set(), umin: Infinity, umax: -Infinity, vmin: Infinity, vmax: -Infinity });
    const e = isl.get(r);
    e.signed += (uv[b * 2] - uv[a * 2]) * (uv[c * 2 + 1] - uv[a * 2 + 1]) - (uv[b * 2 + 1] - uv[a * 2 + 1]) * (uv[c * 2] - uv[a * 2]);
    for (const v of [a, b, c]) {
      e.verts.add(v);
      e.umin = Math.min(e.umin, uv[v * 2]); e.umax = Math.max(e.umax, uv[v * 2]);
      e.vmin = Math.min(e.vmin, uv[v * 2 + 1]); e.vmax = Math.max(e.vmax, uv[v * 2 + 1]);
    }
  }
  const all = [...isl.values()];
  const touches = (e, o) => o !== e && o.umin < e.umax && o.umax > e.umin && o.vmin < e.vmax && o.vmax > e.vmin;
  let flipped = 0;
  for (const e of all) {
    if (e.signed >= 0) continue;
    // Mirroring inside the bbox keeps the footprint only if nothing is nested in that bbox.
    if (all.some((o) => touches(e, o))) continue;
    for (const v of e.verts) uv[v * 2] = e.umin + e.umax - uv[v * 2];
    flipped++;
  }
  return flipped;
}

/** Charts (by segmentation id) whose area or angle distortion exceeds `limit`. */
function distortedCharts(input, result, pos, limit, minWidth) {
  const acc = new Map();
  const { aSrc, chartOfAtlas } = input;
  for (let at = 0; at < chartOfAtlas.length; at++) {
    const v = [0, 1, 2].map((k) => result.index[at * 3 + k]);
    const p = v.map((ov) => { const s = aSrc[result.oldIndexes[ov]]; return new THREE.Vector3(pos[s * 3], pos[s * 3 + 1], pos[s * 3 + 2]); });
    const e1 = p[1].clone().sub(p[0]), e2 = p[2].clone().sub(p[0]);
    const n = e1.clone().cross(e2), wa = n.length() / 2;
    if (wa < 1e-12) continue;
    const bx = e1.clone().normalize(), by = n.clone().cross(e1).normalize();
    const q1 = [e1.dot(bx), 0], q2 = [e2.dot(bx), e2.dot(by)];
    const uv = v.map((ov) => [result.uv[ov * 2], result.uv[ov * 2 + 1]]);
    const d1 = [uv[1][0] - uv[0][0], uv[1][1] - uv[0][1]], d2 = [uv[2][0] - uv[0][0], uv[2][1] - uv[0][1]];
    const det = q1[0] * q2[1] - q2[0] * q1[1];
    const a = (d1[0] * q2[1] - d2[0] * q1[1]) / det, b = (d2[0] * q1[0] - d1[0] * q2[0]) / det;
    const c = (d1[1] * q2[1] - d2[1] * q1[1]) / det, d = (d2[1] * q1[0] - d1[1] * q2[0]) / det;
    const s1 = a * a + b * b + c * c + d * d, s2 = Math.sqrt(Math.max(0, (a * a + b * b - c * c - d * d) ** 2 + 4 * (a * c + b * d) ** 2));
    const smax = Math.sqrt((s1 + s2) / 2), smin = Math.sqrt(Math.max(0, (s1 - s2) / 2));
    const ch = chartOfAtlas[at];
    if (!acc.has(ch)) acc.set(ch, { wa: 0, ua: 0, angle: 0, tris: [], box: [Infinity, Infinity, -Infinity, -Infinity] });
    const e = acc.get(ch), ua = Math.abs(a * d - b * c) * wa;
    for (const [x, y] of uv) e.box = [Math.min(e.box[0], x), Math.min(e.box[1], y), Math.max(e.box[2], x), Math.max(e.box[3], y)];
    e.wa += wa; e.ua += ua; e.angle += (smin > 0 ? smax / smin : 10) * wa; e.tris.push([ua / wa, wa]);
  }
  const bad = new Set();
  for (const [ch, e] of acc) {
    const mean = e.ua / e.wa;
    let areaDev = 0;
    for (const [r, wa] of e.tris) areaDev += Math.abs(r / mean - 1) * wa;
    if (e.ua / Math.max(1e-12, e.box[2] - e.box[0], e.box[3] - e.box[1]) < minWidth) continue; // thin strips: quantisation, not stretch
    if (areaDev / e.wa > limit || e.angle / e.wa - 1 > limit) bad.add(ch);
  }
  return bad;
}

/**
 * @param {THREE.Mesh} mesh assembled mesh (position, normal, partIndex; groups per part)
 * @param {object} rules resolved rules (lib/core/rules.js)
 * @returns {Promise<{ texelsPerUnit: number, resolution: number, lightmapTexelsPerUnit?: number }>}
 */
export async function unwrapUV0(mesh, rules) {
  const geo = mesh.geometry;
  const parts = mesh.userData._parts;
  const ranges = partRanges(geo, parts);
  const idx = geo.index.array, pos = geo.attributes.position.array, nrm = geo.attributes.normal.array;

  // 1. Atlas input: every part that owns its UVs (not a stack/mirror copy, not tiling).
  const primaryOf = (p) => ((p.stack || p.mirror) && p.instance > 0 ? parts.find((q) => q.id === p.id && q.instance === 0) : null);
  const atlasParts = parts.filter((p) => !p.tiling && !primaryOf(p));
  const strict = new Set(); // triangles whose charts only grow across smooth edges

  function atlasInput() {
    const local = new Map(); // `${source vertex}_${part}_${chart}` -> atlas vertex
    const aPos = [], aNrm = [], aIdx = [], aSrc = [], triOfAtlas = [], chartOfAtlas = [];
    for (const p of atlasParts) {
      const r = ranges[p.index];
      const s = p.hidden ? HIDDEN_SCALE : 1;
      const { chartOf, centroids } = segmentCharts(geo, r.t0, r.t1, { ...rules, strict });
      for (let t = r.t0; t < r.t1; t++) {
        const ch = chartOf[t - r.t0], c = centroids[ch];
        for (let k = 0; k < 3; k++) {
          const vi = idx[t * 3 + k];
          const key = `${vi}_${p.index}_${ch}`;
          if (!local.has(key)) {
            local.set(key, aSrc.length);
            aSrc.push(vi);
            // Nudge towards the chart centroid so xatlas sees no colocal vertices across charts.
            for (let d = 0; d < 3; d++) aPos.push((pos[vi * 3 + d] + (c[d] - pos[vi * 3 + d]) * CHART_SHRINK) * s);
            aNrm.push(nrm[vi * 3], nrm[vi * 3 + 1], nrm[vi * 3 + 2]);
          }
          aIdx.push(local.get(key));
        }
        triOfAtlas.push(t);
        chartOfAtlas.push(`${p.index}_${ch}`);
      }
    }
    return { mesh: { index: aIdx, positions: new Float32Array(aPos), normals: new Float32Array(aNrm) }, aSrc, triOfAtlas, chartOfAtlas };
  }

  // 2. Resolution: halve the texture while the fitted density still meets the target.
  // Charts are packed in (res - 2·margin) and shifted, since xatlas keeps no border margin.
  const spacing = (res) => (res === rules.texture ? { padding: rules.padding, margin: rules.margin } : PADDING[res] ?? PADDING[1024]);
  // Charts are computed once per atlas input (they only change when refinement re-segments);
  // every density/resolution trial just re-packs them.
  // The WASM wrapper holds a single atlas, so only one session may be open at a time.
  let session = null, sessionInput = null;
  const pack = async (input, res, { iterations = 4, guess } = {}) => {
    if (sessionInput !== input) {
      session?.close();
      session = await chartSession(input.mesh, UV0_CHART_OPTIONS);
      sessionInput = input;
    }
    const { padding, margin } = spacing(res);
    const inner = res - 2 * margin;
    // +2 px: xatlas pads on its raster grid; diagonal gaps between curved charts come out shorter.
    const r = session.fit({ resolution: inner, padding: Math.ceil(padding / 2) + 2, iterations, guess });
    for (let i = 0; i < r.uv.length; i++) r.uv[i] = (margin + r.uv[i] * inner) / res;
    return r;
  };

  // Charts that flatten badly (closed folded rings: hole chamfers, tube facets) are
  // re-segmented in strict mode and the atlas is rebuilt.
  let input = atlasInput();
  let result = await pack(input, rules.texture);
  for (let pass = 0; pass < 2; pass++) {
    const bad = distortedCharts(input, result, pos, rules.maxDistortion, 4 / rules.texture);
    if (!bad.size) break;
    input.chartOfAtlas.forEach((ch, at) => { if (bad.has(ch)) strict.add(input.triOfAtlas[at]); });
    input = atlasInput();
    result = await pack(input, rules.texture, { guess: result.texelsPerUnit });
  }
  let resolution = rules.texture;
  if (rules.autoResolution && rules.texelDensity) {
    while (resolution > 256) {
      const smaller = await pack(input, resolution / 2, { guess: result.texelsPerUnit / 2 });
      if (smaller.texelsPerUnit < rules.texelDensity) break;
      resolution /= 2;
      result = smaller;
    }
  }
  result = await pack(input, resolution, { iterations: 6, guess: result.texelsPerUnit });
  session.close();
  const { aSrc, triOfAtlas } = input;

  // 3. Rebuild the mesh with split vertices and UVs, keeping triangle order.
  const out = new Builder(geo);
  const triOut = new Array(idx.length / 3);
  const atlasVert = new Map(); // xatlas output vertex -> builder vertex
  const primaryTris = new Map(); // source triangle -> xatlas output vertex triple
  for (let at = 0; at < triOfAtlas.length; at++) {
    const t = triOfAtlas[at];
    const tri = [];
    for (let k = 0; k < 3; k++) {
      const ov = result.index[at * 3 + k];
      tri.push(ov);
      if (!atlasVert.has(ov)) {
        const src = aSrc[result.oldIndexes[ov]];
        atlasVert.set(ov, out.vertex(src, result.uv[ov * 2], 1 - result.uv[ov * 2 + 1]));
      }
    }
    primaryTris.set(t, tri);
    triOut[t] = tri.map((ov) => atlasVert.get(ov));
  }

  orientIslands(out, triOfAtlas.map((t) => triOut[t]));

  // 4. Stack / mirror copies reuse the UVs of instance 0 (same topology, same order).
  for (const p of parts) {
    const primary = primaryOf(p);
    if (!primary) continue;
    const rp = ranges[primary.index], rc = ranges[p.index];
    if (rp.t1 - rp.t0 !== rc.t1 - rc.t0) throw new Error(`stack part "${p.id}" instances differ in topology`);
    const copyVert = new Map();
    for (let t = rc.t0; t < rc.t1; t++) {
      const pt = rp.t0 + (t - rc.t0);
      triOut[t] = primaryTris.get(pt).map((ov) => {
        if (!copyVert.has(ov)) {
          const srcPrimary = aSrc[result.oldIndexes[ov]];
          const src = srcPrimary - rp.v0 + rc.v0;
          const uvIndex = atlasVert.get(ov);
          copyVert.set(ov, out.vertex(src, out.uv[uvIndex * 2], out.uv[uvIndex * 2 + 1]));
        }
        return copyVert.get(ov);
      });
    }
  }

  // 5. Tiling parts: world-space box projection.
  for (const p of parts.filter((q) => q.tiling)) {
    const r = ranges[p.index];
    boxProject(geo, r.t0, r.t1, typeof p.tiling === 'number' ? p.tiling : 1, out, triOut);
  }

  for (const tri of triOut) out.index.push(...tri);
  const g = out.geometry();
  for (const grp of geo.groups) g.addGroup(grp.start, grp.count, grp.materialIndex);
  mesh.geometry = g;
  // Three authors UVs V-up; xatlas V is top-down, flipped above so the GLB writer's flip restores it.
  return { texelsPerUnit: result.texelsPerUnit, resolution, ...spacing(resolution) };
}

/** UV1 lightmap for static assets: a second, independent xatlas layout. */
export async function unwrapUV1(mesh, rules) {
  const geo = mesh.geometry;
  const parts = mesh.userData._parts;
  const idx = geo.index.array, pos = geo.attributes.position.array, pi = geo.attributes.partIndex.array;
  const scaled = new Float32Array(pos.length);
  for (let v = 0; v < pos.length / 3; v++) {
    const s = parts[pi[v]].hidden ? HIDDEN_SCALE : 1;
    scaled[v * 3] = pos[v * 3] * s; scaled[v * 3 + 1] = pos[v * 3 + 1] * s; scaled[v * 3 + 2] = pos[v * 3 + 2] * s;
  }
  const lr = rules.lightmapResolution, margin = 1, inner = lr - 2 * margin;
  const result = await packToFit(
    { index: idx, positions: scaled, normals: new Float32Array(geo.attributes.normal.array) },
    { resolution: inner, padding: Math.ceil(rules.lightmapPadding / 2) + 1 },
  );
  for (let i = 0; i < result.uv.length; i++) result.uv[i] = (margin + result.uv[i] * inner) / lr;
  // Copy every attribute (incl. UV0) through oldIndexes, add uv1.
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const n = attr.itemSize, arr = new Float32Array(result.oldIndexes.length * n);
    result.oldIndexes.forEach((o, i) => { for (let k = 0; k < n; k++) arr[i * n + k] = attr.array[o * n + k]; });
    g.setAttribute(name, new THREE.Float32BufferAttribute(arr, n));
  }
  const uv1 = new Float32Array(result.uv.length);
  for (let i = 0; i < uv1.length; i += 2) { uv1[i] = result.uv[i]; uv1[i + 1] = 1 - result.uv[i + 1]; }
  g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
  g.setIndex(Array.from(result.index));
  for (const grp of geo.groups) g.addGroup(grp.start, grp.count, grp.materialIndex);
  mesh.geometry = g;
  return { lightmapTexelsPerUnit: result.texelsPerUnit };
}

/** Runs UV0 and (for static assets) UV1 on every mesh under root. */
export async function unwrapAsset(root, rules, bp) {
  const info = [];
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && o.userData._parts) meshes.push(o); });
  // Low-poly: UV0 points into the palette (set before UV1 so it is carried through).
  const palette = rules.style === 'lowpoly' ? await applyPalette(root, bp) : null;
  for (const m of meshes) {
    const r = palette ? { resolution: PALETTE.size, palette: true } : await unwrapUV0(m, rules);
    if (rules.isStatic) Object.assign(r, await unwrapUV1(m, rules));
    info.push({ mesh: m.name, ...r });
  }
  if (palette) info.palettePng = palette;
  return info;
}

export { runAtlas };
