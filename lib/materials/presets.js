// Procedural PBR presets. Each preset gets the blueprint material definition and returns
//   shade(p, n, part) -> { albedo: [r,g,b] linear, rough, metal }
//   height(p, part)   -> metres (bump for the normal map)
// `part` carries the part frame: centre, grain/brush axis (u) and two perpendicular axes (v, w).
// Presets: wood, painted-metal, bare-metal, plastic, rubber, concrete, fabric, solid.
import { simplex3, fbm } from './noise.js';

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const hexToLinear = (hex) => [1, 3, 5].map((k) => srgbToLinear(parseInt(hex.slice(k, k + 2), 16) / 255));

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const scale = (c, s) => c.map((v) => clamp01(v * s));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Local coordinates in the part frame: along the axis (u) and across it (v, w). */
const local = (p, part) => { const d = sub(p, part.center); return [dot(d, part.u), dot(d, part.v), dot(d, part.w)]; };

const KEYWORDS = [
  ['wood', /wood|madeira|plank|tabua|tábua|oak|pine|pinus|faia|beech/i],
  ['painted-metal', /paint|pintad|coated/i],
  ['bare-metal', /metal|steel|aço|aco|iron|ferro|chrome|alum|galv/i],
  ['rubber', /rubber|borracha|tire|pneu/i],
  ['plastic', /plastic|plástico|plastico|abs|pvc/i],
  ['concrete', /concrete|concreto|cement|cimento|stone|pedra/i],
  ['fabric', /fabric|tecido|cloth|lona|canvas|estofado/i],
];

/** Preset for a material: explicit `preset`, else guessed from its id/name, else metalness. */
export function presetName(id, def) {
  if (def.preset) return def.preset;
  for (const [name, re] of KEYWORDS) if (re.test(id) || re.test(def.name ?? '')) return name;
  return (def.metalness ?? 0) >= 0.9 ? 'bare-metal' : 'solid';
}

export function createPreset(name, def, seed = 7) {
  const n1 = simplex3(seed), n2 = simplex3(seed + 101);
  const base = hexToLinear(def.color ?? '#cccccc');
  const r0 = def.roughness ?? 0.6, m0 = def.metalness ?? 0;
  const presets = {
    wood() {
      // Rings of a log whose axis runs along the part, off-centre so faces show arcs.
      const rings = def.rings ?? 90; // per metre
      const ring = (p, part) => {
        const [a, b, c] = local(p, part);
        const warp = 0.006 * fbm(n1, a * 3, b * 40, c * 40, 3);
        const r = Math.hypot(b + part.logOffset[0], c + part.logOffset[1]) + warp;
        const f = (r * rings) % 1;
        return smooth(0.72, 0.95, f) * (1 - smooth(0.95, 1, f));
      };
      const streak = (p, part) => { const [a, b, c] = local(p, part); return fbm(n2, a * 2.5, b * 160, c * 160, 3); };
      return {
        shade(p, _n, part) {
          const line = ring(p, part), s = streak(p, part);
          const albedo = scale(mix(scale(base, 1.08), scale(base, 0.6), line * 0.75), 1 + 0.14 * s);
          return { albedo, rough: clamp01(r0 + 0.12 * line - 0.04 * s), metal: 0 };
        },
        height: (p, part) => -0.00018 * ring(p, part) - 0.00006 * streak(p, part),
      };
    },
    'painted-metal'() {
      return {
        shade(p) {
          const v = fbm(n1, p[0] * 40, p[1] * 40, p[2] * 40, 3);
          return { albedo: scale(base, 1 + 0.05 * v), rough: clamp01(r0 + 0.07 * fbm(n2, p[0] * 25, p[1] * 25, p[2] * 25, 3)), metal: m0 };
        },
        height: (p) => 0.00003 * fbm(n2, p[0] * 350, p[1] * 350, p[2] * 350, 2), // orange peel
      };
    },
    'bare-metal'() {
      const brushed = (p, part) => { const [a, b, c] = local(p, part); return fbm(n1, a * 5, b * 900, c * 900, 3); };
      return {
        shade(p, _n, part) {
          const s = brushed(p, part);
          return { albedo: scale(base, 1 + 0.06 * s), rough: clamp01(r0 + 0.1 * s), metal: def.metalness ?? 1 };
        },
        height: (p, part) => 0.000008 * brushed(p, part),
      };
    },
    plastic() {
      return {
        shade(p) {
          const v = fbm(n1, p[0] * 30, p[1] * 30, p[2] * 30, 2);
          return { albedo: scale(base, 1 + 0.025 * v), rough: clamp01(r0 + 0.04 * v), metal: 0 };
        },
        height: (p) => 0.00002 * fbm(n2, p[0] * 600, p[1] * 600, p[2] * 600, 2),
      };
    },
    rubber() {
      return {
        shade(p) {
          const v = fbm(n1, p[0] * 60, p[1] * 60, p[2] * 60, 3);
          return { albedo: scale(base, 1 + 0.06 * v), rough: clamp01(Math.max(r0, 0.8) + 0.05 * v), metal: 0 };
        },
        height: (p) => 0.00005 * fbm(n2, p[0] * 450, p[1] * 450, p[2] * 450, 2),
      };
    },
    concrete() {
      const pits = (p) => Math.max(0, fbm(n2, p[0] * 70, p[1] * 70, p[2] * 70, 3) - 0.35);
      return {
        shade(p) {
          const v = fbm(n1, p[0] * 12, p[1] * 12, p[2] * 12, 5);
          const speck = fbm(n2, p[0] * 300, p[1] * 300, p[2] * 300, 1) > 0.55 ? 0.8 : 1;
          return { albedo: scale(base, (0.86 + 0.28 * v) * speck), rough: clamp01(Math.max(r0, 0.8) + 0.08 * v), metal: 0 };
        },
        height: (p) => -0.0005 * pits(p),
      };
    },
    fabric() {
      const threads = def.threads ?? 350; // per metre
      const weave = (p, n) => {
        // Triplanar: weave on the plane most facing the normal.
        const ax = Math.abs(n[0]) > Math.abs(n[1]) && Math.abs(n[0]) > Math.abs(n[2]) ? 0 : Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2;
        const [u, v] = ax === 0 ? [p[1], p[2]] : ax === 1 ? [p[0], p[2]] : [p[0], p[1]];
        return (Math.abs(Math.sin(u * Math.PI * threads)) + Math.abs(Math.sin(v * Math.PI * threads))) / 2;
      };
      return {
        shade(p, n) {
          const w = weave(p, n), v = fbm(n1, p[0] * 20, p[1] * 20, p[2] * 20, 3);
          return { albedo: scale(base, 0.88 + 0.16 * w + 0.05 * v), rough: clamp01(Math.max(r0, 0.75)), metal: 0 };
        },
        height: (p, part, n) => 0.00025 * weave(p, n ?? [0, 1, 0]),
      };
    },
    solid() {
      return { shade: () => ({ albedo: base, rough: r0, metal: m0 }), height: () => 0 };
    },
    // Normal-map orientation check: one raised dome (2 cm) at the part centre.
    'debug-dome'() {
      return {
        shade: () => ({ albedo: base, rough: r0, metal: m0 }),
        height: (p, part) => { const [, b, c] = local(p, part); return 0.02 * Math.exp(-(b * b + c * c) / 0.004); },
      };
    },
  };
  if (!presets[name]) throw new Error(`unknown material preset "${name}" (use ${Object.keys(presets).join(', ')})`);
  return presets[name]();
}
