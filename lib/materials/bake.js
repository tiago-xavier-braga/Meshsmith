// PBR texture bake in UV0 space: BaseColor (sRGB), Normal (OpenGL, tangent space) and
// ORM (R = AO, G = roughness, B = metallic), one texture set shared by all materials.
//  1. MikkTSpace tangents (the same basis engines compute), exported as TANGENT;
//  2. G-buffer: triangle + barycentrics per texel;
//  3. presets evaluated at the 3D surface point (seamless across UV seams);
//  4. normal map from the 3D gradient of the preset height, encoded with glTF's TBN;
//  5. AO by BVH raycast, feature-edge distances for wear (chips, grime);
//  6. edge dilation so mips and bilinear filtering never see background.
import * as THREE from 'three';
import sharp from 'sharp';
import { generateTangents } from 'mikktspace';
import { computeMikkTSpaceTangents, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH, SAH } from 'three-mesh-bvh';
import { createPreset, presetName } from './presets.js';
import { featureEdges, SegmentGrid } from './edges.js';

const AO_RAYS = 24;

/** Adds glTF-convention MikkTSpace tangents and re-indexes (groups are kept). */
export async function addTangents(geo) {
  const groups = geo.groups.map((g) => ({ ...g }));
  const g = geo.clone();
  // The Node build of mikktspace is ready synchronously; three only checks isReady.
  computeMikkTSpaceTangents(g, { isReady: true, generateTangents });
  const out = mergeVertices(g, 1e-6);
  out.clearGroups();
  for (const grp of groups) out.addGroup(grp.start, grp.count, grp.materialIndex);
  return out;
}

function partFrames(geo, parts) {
  const pos = geo.attributes.position, pi = geo.attributes.partIndex;
  const boxes = parts.map(() => new THREE.Box3());
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) boxes[pi.getX(i)].expandByPoint(v.fromBufferAttribute(pos, i));
  const AX = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  return boxes.map((b, i) => {
    const size = b.getSize(new THREE.Vector3()).toArray();
    const u = parts[i].grain ? 'xyz'.indexOf(parts[i].grain) : size.indexOf(Math.max(...size));
    const [v1, w1] = [0, 1, 2].filter((k) => k !== u);
    // Deterministic, per-part log centre offset so each board shows its own ring pattern.
    const h = Math.sin((i + 1) * 12.9898) * 43758.5453;
    const f = h - Math.floor(h);
    return {
      center: b.getCenter(new THREE.Vector3()).toArray(),
      u: AX[u], v: AX[v1], w: AX[w1],
      half: [size[u] / 2, size[v1] / 2, size[w1] / 2],
      logOffset: [0.12 + 0.25 * f, 0.08 + 0.2 * (1 - f)],
    };
  });
}

/** Rasterises UV0 of the atlas-owning triangles into triangle id + barycentrics. */
function gbuffer(geo, N, triFilter) {
  const uv = geo.attributes.uv, idx = geo.index.array;
  const tri = new Int32Array(N * N).fill(-1);
  const b1 = new Float32Array(N * N), b2 = new Float32Array(N * N);
  for (let t = 0; t < idx.length / 3; t++) {
    if (!triFilter(t)) continue;
    const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2];
    const ax = uv.getX(i0) * N, ay = (1 - uv.getY(i0)) * N;
    const bx = uv.getX(i1) * N, by = (1 - uv.getY(i1)) * N;
    const cx = uv.getX(i2) * N, cy = (1 - uv.getY(i2)) * N;
    const det = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(det) < 1e-12) continue;
    // Conservative by half a texel so texels on island borders get real data.
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 1)), x1 = Math.min(N - 1, Math.ceil(Math.max(ax, bx, cx) + 1));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 1)), y1 = Math.min(N - 1, Math.ceil(Math.max(ay, by, cy) + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const l1 = ((px - ax) * (cy - ay) - (py - ay) * (cx - ax)) / det;
        const l2 = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / det;
        const l0 = 1 - l1 - l2;
        const inside = l0 >= 0 && l1 >= 0 && l2 >= 0;
        const p = y * N + x;
        if (!inside) {
          // Border texel: take the nearest triangle if none claimed it (clamped barycentrics).
          const m = Math.min(l0, l1, l2);
          if (tri[p] !== -1 || m < -0.5 / Math.max(1, Math.sqrt(Math.abs(det)))) continue;
          const c0 = Math.max(0, l0), c1 = Math.max(0, l1), c2 = Math.max(0, l2), s = c0 + c1 + c2;
          tri[p] = t; b1[p] = c1 / s; b2[p] = c2 / s;
          continue;
        }
        tri[p] = t; b1[p] = l1; b2[p] = l2;
      }
    }
  }
  return { tri, b1, b2 };
}

/** Cosine-weighted hemisphere directions (stratified), reused with a per-texel rotation. */
function hemisphere(n) {
  const dirs = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n), phi = i * golden;
    dirs.push([r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(Math.max(0, 1 - r * r))]);
  }
  return dirs;
}

/** Fills empty texels from covered neighbours, then the rest with the mean colour. */
function dilate(channels, covered, N, passes) {
  let mask = covered.slice();
  for (let pass = 0; pass < passes; pass++) {
    const next = mask.slice();
    let changed = 0;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const p = y * N + x;
        if (mask[p]) continue;
        let n = 0;
        const acc = channels.map(() => [0, 0, 0]);
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= N) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= N || !mask[yy * N + xx]) continue;
            const q = yy * N + xx;
            channels.forEach((c, ci) => { acc[ci][0] += c[q * 3]; acc[ci][1] += c[q * 3 + 1]; acc[ci][2] += c[q * 3 + 2]; });
            n++;
          }
        }
        if (!n) continue;
        channels.forEach((c, ci) => { c[p * 3] = acc[ci][0] / n; c[p * 3 + 1] = acc[ci][1] / n; c[p * 3 + 2] = acc[ci][2] / n; });
        next[p] = 1;
        changed++;
      }
    }
    mask = next;
    if (!changed) break;
  }
  channels.forEach((c) => {
    const mean = [0, 0, 0];
    let n = 0;
    for (let p = 0; p < N * N; p++) if (covered[p]) { mean[0] += c[p * 3]; mean[1] += c[p * 3 + 1]; mean[2] += c[p * 3 + 2]; n++; }
    for (let p = 0; p < N * N; p++) if (!mask[p]) { c[p * 3] = mean[0] / n; c[p * 3 + 1] = mean[1] / n; c[p * 3 + 2] = mean[2] / n; }
  });
}

const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function png(channel, N, encode = (v) => v) {
  const rgb = new Uint8Array(N * N * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = Math.round(Math.min(1, Math.max(0, encode(channel[i]))) * 255);
  return sharp(Buffer.from(rgb), { raw: { width: N, height: N, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * @param {THREE.Mesh} mesh assembled mesh with UV0 (and UV1)
 * @returns {Promise<{ baseColor: Buffer, normal: Buffer, orm: Buffer, resolution: number, ms: number, presets: object }>}
 */
export async function bakePBR(mesh, bp, rules, resolution) {
  const t0 = performance.now();
  mesh.geometry = await addTangents(mesh.geometry);
  const geo = mesh.geometry;
  const parts = mesh.userData._parts.map((p) => ({ ...p, grain: bp.parts.find((q) => q.id === p.id)?.grain }));
  const frames = partFrames(geo, parts);
  const matIds = Object.keys(bp.materials);
  const presets = {}, samplers = matIds.map((id) => {
    presets[id] = presetName(id, bp.materials[id]);
    return createPreset(presets[id], bp.materials[id], 7 + matIds.indexOf(id));
  });
  const idx = geo.index.array, pos = geo.attributes.position.array, nrm = geo.attributes.normal.array, tan = geo.attributes.tangent.array;
  const pi = geo.attributes.partIndex.array;
  const triMat = new Int32Array(idx.length / 3);
  for (const g of geo.groups) for (let i = g.start; i < g.start + g.count; i += 3) triMat[i / 3] = g.materialIndex;
  const owns = (t) => { const p = parts[pi[idx[t * 3]]]; return !p.tiling && !((p.stack || p.mirror) && p.instance > 0); };

  const N = resolution;
  const lap = (label) => { if (process.env.STUDIO3D_PROFILE) console.log(`  ${label} ${Math.round(performance.now() - t0)} ms`); };
  lap('tangents');
  const { tri, b1, b2 } = gbuffer(geo, N, owns);
  lap('gbuffer');
  const albedo = new Float32Array(N * N * 3), normal = new Float32Array(N * N * 3), orm = new Float32Array(N * N * 3);
  const covered = new Uint8Array(N * N);

  const box = new THREE.Box3().setFromBufferAttribute(geo.attributes.position);
  const maxDim = Math.max(...box.getSize(new THREE.Vector3()).toArray());
  const aoDist = Math.min(0.5, 0.35 * maxDim);
  const bvh = new MeshBVH(geo.clone(), { strategy: SAH }); // MeshBVH reorders the index of what it gets
  const aoBlocks = new Map();
  // Wear masks: distance to convex (chips) and concave (grime) feature edges.
  const edges = featureEdges(geo);
  const convexGrid = new SegmentGrid(edges.convex, 0.012), concaveGrid = new SegmentGrid(edges.concave, 0.008);
  const ctx = { edge: 1, cavity: 1, ao: 1, edgeAt: (q) => convexGrid.distance(q) };
  const ray = new THREE.Ray();
  const dirs = hemisphere(AO_RAYS);
  const density = Math.max(1, (rules.texelDensity ?? 512));
  const eps = 0.5 / density; // half a texel in metres for the height gradient

  const P = [0, 0, 0], Nn = [0, 0, 0], T = [0, 0, 0], B = [0, 0, 0];
  const q1 = [0, 0, 0], q2 = [0, 0, 0];
  for (let p = 0; p < N * N; p++) {
    const t = tri[p];
    if (t < 0) continue;
    covered[p] = 1;
    const l1 = b1[p], l2 = b2[p], l0 = 1 - l1 - l2;
    const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2];
    for (let k = 0; k < 3; k++) {
      P[k] = pos[i0 * 3 + k] * l0 + pos[i1 * 3 + k] * l1 + pos[i2 * 3 + k] * l2;
      Nn[k] = nrm[i0 * 3 + k] * l0 + nrm[i1 * 3 + k] * l1 + nrm[i2 * 3 + k] * l2;
      T[k] = tan[i0 * 4 + k] * l0 + tan[i1 * 4 + k] * l1 + tan[i2 * 4 + k] * l2;
    }
    let len = Math.hypot(Nn[0], Nn[1], Nn[2]);
    Nn[0] /= len; Nn[1] /= len; Nn[2] /= len;
    // Gram-Schmidt T against N, B = cross(N, T) * w (glTF convention).
    const d = T[0] * Nn[0] + T[1] * Nn[1] + T[2] * Nn[2];
    T[0] -= Nn[0] * d; T[1] -= Nn[1] * d; T[2] -= Nn[2] * d;
    len = Math.hypot(T[0], T[1], T[2]) || 1;
    T[0] /= len; T[1] /= len; T[2] /= len;
    const w = tan[i0 * 4 + 3] < 0 ? -1 : 1;
    B[0] = (Nn[1] * T[2] - Nn[2] * T[1]) * w; B[1] = (Nn[2] * T[0] - Nn[0] * T[2]) * w; B[2] = (Nn[0] * T[1] - Nn[1] * T[0]) * w;

    // Ambient occlusion: cosine-weighted rays with a per-texel rotation around N, traced
    // once per 2×2 texel block and part (AO is low frequency; the blur below smooths it).
    const blockKey = (((p / N) | 0) >> 1) * (N >> 1) * 65536 + ((p % N) >> 1) * 65536 + pi[i0];
    let aoValue = aoBlocks.get(blockKey);
    if (aoValue === undefined) {
      let occ = 0;
      const rot = ((p * 2654435761) >>> 0) / 4294967296 * Math.PI * 2, cr = Math.cos(rot), sr = Math.sin(rot);
      ray.origin.set(P[0] + Nn[0] * 1e-4, P[1] + Nn[1] * 1e-4, P[2] + Nn[2] * 1e-4);
      for (const [dx0, dy0, dz] of dirs) {
        const dx = dx0 * cr - dy0 * sr, dy = dx0 * sr + dy0 * cr;
        ray.direction.set(T[0] * dx + B[0] * dy + Nn[0] * dz, T[1] * dx + B[1] * dy + Nn[1] * dz, T[2] * dx + B[2] * dy + Nn[2] * dz);
        const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, aoDist);
        if (hit) occ += 1 - hit.distance / aoDist;
      }
      aoValue = 1 - occ / AO_RAYS;
      aoBlocks.set(blockKey, aoValue);
    }
    orm[p * 3] = aoValue;

    const part = frames[pi[i0]];
    const s = samplers[triMat[t]];
    ctx.ao = aoValue;
    ctx.edge = convexGrid.distance(P);
    ctx.cavity = concaveGrid.distance(P);
    const sh = s.shade(P, Nn, part, ctx);
    albedo[p * 3] = sh.albedo[0]; albedo[p * 3 + 1] = sh.albedo[1]; albedo[p * 3 + 2] = sh.albedo[2];

    // Height gradient along T and B -> perturbed normal -> tangent-space encode.
    for (let k = 0; k < 3; k++) { q1[k] = P[k] + T[k] * eps; q2[k] = P[k] - T[k] * eps; }
    const hT = (s.height(q1, part, Nn, ctx) - s.height(q2, part, Nn, ctx)) / (2 * eps);
    for (let k = 0; k < 3; k++) { q1[k] = P[k] + B[k] * eps; q2[k] = P[k] - B[k] * eps; }
    const hB = (s.height(q1, part, Nn, ctx) - s.height(q2, part, Nn, ctx)) / (2 * eps);
    // In tangent space the bumped normal is (-hT, -hB, 1).
    const nl = Math.hypot(hT, hB, 1);
    normal[p * 3] = (-hT / nl) * 0.5 + 0.5;
    normal[p * 3 + 1] = (-hB / nl) * 0.5 + 0.5;
    normal[p * 3 + 2] = (1 / nl) * 0.5 + 0.5;


    orm[p * 3 + 1] = sh.rough;
    orm[p * 3 + 2] = sh.metal;
  }

  lap('shade + ao');
  // Light 3×3 blur of AO inside covered texels to hide ray noise.
  const ao = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const p = y * N + x;
    if (!covered[p]) continue;
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
      const q = yy * N + xx;
      if (covered[q] && tri[q] >= 0 && pi[idx[tri[q] * 3]] === pi[idx[tri[p] * 3]]) { s += orm[q * 3]; n++; }
    }
    ao[p] = s / n;
  }
  for (let p = 0; p < N * N; p++) if (covered[p]) orm[p * 3] = ao[p];

  dilate([albedo, normal, orm], covered, N, Math.max(4, rules.padding * 2));
  lap('dilate');
  const [baseColor, normalPng, ormPng] = await Promise.all([
    png(albedo, N, linearToSrgb), png(normal, N), png(orm, N),
  ]);
  return { baseColor, normal: normalPng, orm: ormPng, resolution: N, ms: Math.round(performance.now() - t0), presets };
}
