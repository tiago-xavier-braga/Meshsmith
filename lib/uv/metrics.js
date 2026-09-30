// UV measurements used by `studio3d validate` and `studio3d uv`.
// Geometry UVs use Three's convention (V up); image row = (1 - v) * resolution.
import * as THREE from 'three';

/**
 * Union-find over triangles sharing a vertex -> island id per triangle. Vertices split
 * only by normal (same position and same UV) are continuous in UV space, so they join.
 */
export function islands(geo, triFilter = () => true, attr = 'uv') {
  const idx = geo.index.array, triCount = idx.length / 3;
  const pos = geo.attributes.position, uv = geo.attributes[attr];
  const parent = new Int32Array(pos.count).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  if (uv) {
    const seen = new Map();
    const q = (v, s) => Math.round(v * s);
    for (let i = 0; i < pos.count; i++) {
      const k = `${q(pos.getX(i), 1e5)}_${q(pos.getY(i), 1e5)}_${q(pos.getZ(i), 1e5)}_${q(uv.getX(i), 1e6)}_${q(uv.getY(i), 1e6)}`;
      if (seen.has(k)) parent[find(i)] = find(seen.get(k));
      else seen.set(k, i);
    }
  }
  for (let t = 0; t < triCount; t++) {
    if (!triFilter(t)) continue;
    const a = find(idx[t * 3]), b = find(idx[t * 3 + 1]), c = find(idx[t * 3 + 2]);
    parent[b] = a; parent[find(c)] = a;
  }
  const ids = new Map();
  const triIsland = new Int32Array(triCount).fill(-1);
  for (let t = 0; t < triCount; t++) {
    if (!triFilter(t)) continue;
    const r = find(idx[t * 3]);
    if (!ids.has(r)) ids.set(r, ids.size);
    triIsland[t] = ids.get(r);
  }
  return { triIsland, count: ids.size };
}

/**
 * Rasterises triangles (pixel centres strictly inside) into a label map.
 * Returns labels (island id or -1), coverage count per pixel.
 */
export function rasterize(geo, attr, resolution, triIsland) {
  const uv = geo.attributes[attr], idx = geo.index.array;
  const N = resolution;
  const labels = new Int32Array(N * N).fill(-1);
  const cover = new Uint8Array(N * N);
  const px = (i) => [uv.getX(i) * N, (1 - uv.getY(i)) * N];
  for (let t = 0; t < idx.length / 3; t++) {
    const isl = triIsland[t];
    if (isl < 0) continue;
    let [a, b, c] = [px(idx[t * 3]), px(idx[t * 3 + 1]), px(idx[t * 3 + 2])];
    let area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-12) continue;
    if (area < 0) { [b, c] = [c, b]; area = -area; }
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(N - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(N - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const pxx = x + 0.5;
        const w0 = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (pxx - a[0]);
        const w1 = (c[0] - b[0]) * (py - b[1]) - (c[1] - b[1]) * (pxx - b[0]);
        const w2 = (a[0] - c[0]) * (py - c[1]) - (a[1] - c[1]) * (pxx - c[0]);
        if (w0 > 1e-9 && w1 > 1e-9 && w2 > 1e-9) {
          const p = y * N + x;
          if (cover[p] < 255) cover[p]++;
          labels[p] = isl;
        }
      }
    }
  }
  return { labels, cover, resolution: N };
}

/** Overlap %: pixels covered by 2+ triangles over covered pixels. */
export function overlap({ cover }) {
  let covered = 0, over = 0;
  for (const c of cover) { if (c) covered++; if (c > 1) over++; }
  return { covered, overlapped: over, percent: covered ? (over / covered) * 100 : 0 };
}

/**
 * Minimum gap in pixels between different islands and from islands to the border,
 * searched up to `maxRadius` (Chebyshev-ish, true Euclidean distance inside the window).
 */
export function gaps({ labels, resolution: N }, maxRadius) {
  let minGap = Infinity, minBorder = Infinity;
  const R = maxRadius;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const l = labels[y * N + x];
      if (l < 0) continue;
      // Only boundary pixels matter.
      const edge = x === 0 || y === 0 || x === N - 1 || y === N - 1
        || labels[y * N + x - 1] !== l || labels[y * N + x + 1] !== l || labels[(y - 1) * N + x] !== l || labels[(y + 1) * N + x] !== l;
      if (!edge) continue;
      minBorder = Math.min(minBorder, x, y, N - 1 - x, N - 1 - y);
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= N) continue;
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= N) continue;
          const o = labels[yy * N + xx];
          if (o >= 0 && o !== l) {
            const d = Math.hypot(dx, dy) - 1; // empty pixels in between
            if (d < minGap) minGap = d;
          }
        }
      }
    }
  }
  return { minGap: minGap === Infinity ? null : Math.max(0, minGap), minBorder: minBorder === Infinity ? null : minBorder };
}

/**
 * Per-island texel density (px/m) and distortion from the UV Jacobian of each triangle.
 * densityScale lets hidden parts be compared at their intended 25%.
 */
export function islandStats(geo, attr, resolution, triIsland, count, densityScale = () => 1) {
  const pos = geo.attributes.position, uv = geo.attributes[attr], idx = geo.index.array;
  const stats = Array.from({ length: count }, () => ({ uvArea: 0, worldArea: 0, angle: 0, tris: [], scale: 1, box: [Infinity, Infinity, -Infinity, -Infinity] }));
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3(), bx = new THREE.Vector3(), by = new THREE.Vector3();
  for (let t = 0; t < idx.length / 3; t++) {
    const isl = triIsland[t];
    if (isl < 0) continue;
    const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2];
    p0.fromBufferAttribute(pos, i0); p1.fromBufferAttribute(pos, i1); p2.fromBufferAttribute(pos, i2);
    e1.subVectors(p1, p0); e2.subVectors(p2, p0);
    n.crossVectors(e1, e2);
    const wa = n.length() / 2;
    if (wa < 1e-12) continue;
    bx.copy(e1).normalize(); by.crossVectors(n, e1).normalize();
    // Local 2D coordinates of the triangle.
    const q1 = [e1.dot(bx), 0], q2 = [e2.dot(bx), e2.dot(by)];
    const u0 = [uv.getX(i0) * resolution, uv.getY(i0) * resolution];
    const d1 = [uv.getX(i1) * resolution - u0[0], uv.getY(i1) * resolution - u0[1]];
    const d2 = [uv.getX(i2) * resolution - u0[0], uv.getY(i2) * resolution - u0[1]];
    // J maps local -> uv:  J * q1 = d1, J * q2 = d2.
    const det = q1[0] * q2[1] - q2[0] * q1[1];
    const J = [
      (d1[0] * q2[1] - d2[0] * q1[1]) / det, (d2[0] * q1[0] - d1[0] * q2[0]) / det,
      (d1[1] * q2[1] - d2[1] * q1[1]) / det, (d2[1] * q1[0] - d1[1] * q2[0]) / det,
    ];
    const [a, b, c, d] = J;
    const s1 = a * a + b * b + c * c + d * d, s2 = Math.sqrt(Math.max(0, (a * a + b * b - c * c - d * d) ** 2 + 4 * (a * c + b * d) ** 2));
    const smax = Math.sqrt((s1 + s2) / 2), smin = Math.sqrt(Math.max(0, (s1 - s2) / 2));
    const ua = Math.abs(a * d - b * c) * wa;
    const st = stats[isl];
    st.uvArea += ua;
    st.worldArea += wa;
    st.angle += (smin > 0 ? smax / smin : 10) * wa;
    st.tris.push([ua / wa, wa]);
    st.scale = densityScale(t);
    for (const i of [i0, i1, i2]) {
      const x = uv.getX(i) * resolution, y = uv.getY(i) * resolution;
      st.box = [Math.min(st.box[0], x), Math.min(st.box[1], y), Math.max(st.box[2], x), Math.max(st.box[3], y)];
    }
    st.n = (st.n ?? 0) + 1;
  }
  return stats.filter((s) => s.worldArea > 0).map((s) => {
    const mean = s.uvArea / s.worldArea;
    let areaDev = 0;
    for (const [r, wa] of s.tris) areaDev += Math.abs(r / mean - 1) * wa;
    return {
      density: Math.sqrt(mean) / s.scale, // px per metre, normalised for hidden parts
      rawDensity: Math.sqrt(mean),
      uvArea: s.uvArea,
      // Narrow side in px (area / long side): strips under a few texels only show quantisation.
      width: s.uvArea / Math.max(1e-9, s.box[2] - s.box[0], s.box[3] - s.box[1]),
      n: s.n,
      worldArea: s.worldArea,
      areaDistortion: areaDev / s.worldArea,
      angleDistortion: s.angle / s.worldArea - 1,
    };
  });
}

/** Area-weighted median of island densities and the worst relative deviation from it. */
export function densitySpread(stats) {
  if (!stats.length) return { median: 0, maxDeviation: 0 };
  const sorted = stats.slice().sort((a, b) => a.density - b.density);
  const total = sorted.reduce((s, x) => s + x.worldArea, 0);
  let acc = 0, median = sorted[0].density;
  for (const s of sorted) { acc += s.worldArea; if (acc >= total / 2) { median = s.density; break; } }
  const maxDeviation = Math.max(...stats.map((s) => Math.abs(s.density / median - 1)));
  return { median, maxDeviation };
}

/**
 * UV seams lying on smooth, visible surfaces (dihedral < seamAngle and shared normals):
 * the spec wants seams on sharp edges or low-visibility areas (hidden parts, back, underside).
 * Returns lengths in metres.
 */
export function seamPlacement(geo, attr, seamAngleDeg, isHiddenTri) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes[attr], idx = geo.index.array;
  const q = (i) => `${Math.round(pos.getX(i) * 1e5)}_${Math.round(pos.getY(i) * 1e5)}_${Math.round(pos.getZ(i) * 1e5)}`;
  const edges = new Map();
  for (let t = 0; t < idx.length / 3; t++) {
    for (let e = 0; e < 3; e++) {
      const a = idx[t * 3 + e], b = idx[t * 3 + ((e + 1) % 3)];
      const ka = q(a), kb = q(b);
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push({ t, a, b, ka });
    }
  }
  const fn = (t) => {
    const a = new THREE.Vector3().fromBufferAttribute(pos, idx[t * 3]);
    const b = new THREE.Vector3().fromBufferAttribute(pos, idx[t * 3 + 1]);
    const c = new THREE.Vector3().fromBufferAttribute(pos, idx[t * 3 + 2]);
    return b.sub(a).cross(c.sub(a)).normalize();
  };
  const cosSeam = Math.cos(THREE.MathUtils.degToRad(seamAngleDeg));
  let total = 0, smoothVisible = 0;
  const same = (i, j, attrib) => Math.abs(attrib.getX(i) - attrib.getX(j)) < 1e-5 && Math.abs(attrib.getY(i) - attrib.getY(j)) < 1e-5
    && (attrib.itemSize < 3 || Math.abs(attrib.getZ(i) - attrib.getZ(j)) < 1e-5);
  for (const list of edges.values()) {
    if (list.length !== 2) continue;
    const [e1, e2] = list;
    // Match endpoints by position key.
    const [x1, y1] = e1.ka === e2.ka ? [e2.a, e2.b] : [e2.b, e2.a];
    const uvSeam = !(same(e1.a, x1, uv) && same(e1.b, y1, uv));
    if (!uvSeam) continue;
    const len = new THREE.Vector3().fromBufferAttribute(pos, e1.a).distanceTo(new THREE.Vector3().fromBufferAttribute(pos, e1.b));
    total += len;
    const hardNormal = !(same(e1.a, x1, nrm) && same(e1.b, y1, nrm));
    const sharp = fn(e1.t).dot(fn(e2.t)) < cosSeam;
    // Back (-Z) and underside (-Y) count as low-visibility areas, like hidden parts.
    const nb = fn(e1.t).add(fn(e2.t)).normalize();
    const tucked = -nb.z > 0.7 || -nb.y > 0.7;
    if (!hardNormal && !sharp && !tucked && !isHiddenTri(e1.t) && !isHiddenTri(e2.t)) smoothVisible += len;
  }
  return { totalLength: total, smoothVisibleLength: smoothVisible, smoothVisibleRatio: total ? smoothVisible / total : 0 };
}

/** Coloured UV layout PNG (raw RGBA) from a label map, for the report/preview. */
export function layoutImage({ labels, cover, resolution: N }) {
  const rgba = new Uint8Array(N * N * 4);
  const color = new THREE.Color();
  for (let p = 0; p < N * N; p++) {
    const l = labels[p];
    if (l < 0) { rgba.set([24, 26, 30, 255], p * 4); continue; }
    color.setHSL(((l * 0.61803) % 1), 0.55, cover[p] > 1 ? 0.2 : 0.6);
    if (cover[p] > 1) color.setRGB(1, 0, 0);
    rgba.set([color.r * 255, color.g * 255, color.b * 255, 255], p * 4);
  }
  return rgba;
}
