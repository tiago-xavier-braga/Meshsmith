// asset.json schema check. Kept dependency-free: returns a list of error strings.
import { CATEGORIES } from './rules.js';

export const PRESETS = ['wood', 'painted-metal', 'bare-metal', 'plastic', 'rubber', 'concrete', 'fabric', 'label', 'solid'];

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MESH = /^SM_[A-Z][A-Za-z0-9]*$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

export const BLUEPRINT_SCHEMA_DOC = `
asset.json
  name            kebab-case folder name                      "wood-chair"
  meshName        SM_ + PascalCase                            "SM_WoodChair"
  category        ${Object.keys(CATEGORIES).join(' | ')}
  style?          "pbr" | "lowpoly"                           (default by category)
  static?         bool, generates UV1 lightmap                (default true)
  pivot?          "base-center" | "grid-corner"               (default base-center)
  dimensions      { x, y, z } bounding box in metres (Y up, front +Z)
  triangleBudget? [min, max]                                  (default by category)
  texture?        { resolution, texelDensity, padding, margin }
  lightmap?       { resolution }                              (default 128)
  materials       { <id>: { color "#rrggbb", roughness, metalness, name?,
                    preset?   PBR: ${PRESETS.join(' | ')} (default: guessed from id/name)
                    gradient? low-poly: "#rrggbb" top colour of a vertical gradient
                    rings?, threads?  wood rings / fabric threads per metre
                    wear?     painted-metal 0..1: edge chips, scratches, grime; under? exposed metal colour
                    emissive? "#rrggbb" glow (eyes, LEDs), kept through the bake
                    label: ink?, accent?, title? colours of the pseudo-printed decal } }
  bake?           false skips the PBR texture bake (factor-only materials)
  parts           [ { id, material, mirror?, stack?, tiling?, hidden?, decal?, smoothingAngle?, grain? "x"|"y"|"z" } ]
  lods?           [ratios] (default [0.5, 0.25] from 600 triangles) | false
  collision?      "hull" (default) | "box" | false
  reference?      { images: [paths in ref/], prompt?, camera?: { position, target, fov } }
  grid?           modular kits: number | [x, y, z] metres; dimensions must be multiples (use pivot grid-corner)
  rules?          overrides for lib/core/rules.js DEFAULTS
`;

export function validateBlueprint(bp) {
  const e = [];
  if (!bp || typeof bp !== 'object') return ['blueprint is not an object'];
  if (!KEBAB.test(bp.name ?? '')) e.push(`name must be kebab-case (got "${bp.name}")`);
  if (!MESH.test(bp.meshName ?? '')) e.push(`meshName must be SM_PascalCase (got "${bp.meshName}")`);
  if (!CATEGORIES[bp.category]) e.push(`category must be one of ${Object.keys(CATEGORIES).join(', ')}`);
  if (bp.style && !['pbr', 'lowpoly'].includes(bp.style)) e.push('style must be pbr or lowpoly');
  if (bp.pivot && !['base-center', 'grid-corner'].includes(bp.pivot)) e.push('pivot must be base-center or grid-corner');
  const d = bp.dimensions;
  if (!d || !['x', 'y', 'z'].every((k) => typeof d[k] === 'number' && d[k] > 0)) e.push('dimensions {x,y,z} must be positive numbers (metres)');
  if (bp.triangleBudget && !(Array.isArray(bp.triangleBudget) && bp.triangleBudget.length === 2)) e.push('triangleBudget must be [min, max]');
  if (bp.grid !== undefined && !(typeof bp.grid === 'number' ? bp.grid > 0 : Array.isArray(bp.grid) && bp.grid.length === 3 && bp.grid.every((g) => g > 0))) e.push('grid must be a positive number or [x, y, z]');
  const res = bp.texture?.resolution;
  if (res && (res & (res - 1)) !== 0) e.push('texture.resolution must be a power of two');
  const mats = bp.materials ?? {};
  if (!Object.keys(mats).length) e.push('materials must declare at least one material');
  for (const [id, m] of Object.entries(mats)) {
    if (m.color && !HEX.test(m.color)) e.push(`materials.${id}.color must be #rrggbb`);
    for (const k of ['gradient', 'emissive', 'under']) {
      if (m[k] && !HEX.test(m[k])) e.push(`materials.${id}.${k} must be #rrggbb`);
    }
    if (m.wear !== undefined && !(m.wear >= 0 && m.wear <= 1)) e.push(`materials.${id}.wear must be in 0..1`);
    if (m.preset && !PRESETS.includes(m.preset) && m.preset !== 'debug-dome') e.push(`materials.${id}.preset must be one of ${PRESETS.join(', ')}`);
    for (const k of ['roughness', 'metalness']) {
      if (m[k] !== undefined && !(m[k] >= 0 && m[k] <= 1)) e.push(`materials.${id}.${k} must be in 0..1`);
    }
  }
  if (!Array.isArray(bp.parts) || !bp.parts.length) e.push('parts must be a non-empty array');
  if ((bp.style === 'lowpoly' || bp.category === 'lowpoly') && Object.keys(mats).length > 64) e.push('low-poly palette holds at most 64 materials');
  // A material is either tiled (its own seamless tile) or in the atlas, never both.
  const tiledMats = new Set((bp.parts ?? []).filter((p) => p.tiling).map((p) => p.material));
  for (const p of bp.parts ?? []) if (!p.tiling && tiledMats.has(p.material)) e.push(`material "${p.material}" is used by tiling and non-tiling parts`);
  for (const p of bp.parts ?? []) if (p.tiling !== undefined && !(typeof p.tiling === 'number' && p.tiling > 0)) e.push(`part "${p.id}" tiling must be metres per repeat (> 0)`);
  const ids = new Set();
  for (const p of bp.parts ?? []) {
    if (!p.id) e.push('every part needs an id');
    if (ids.has(p.id)) e.push(`duplicate part id "${p.id}"`);
    ids.add(p.id);
    if (p.material && !mats[p.material]) e.push(`part "${p.id}" uses unknown material "${p.material}"`);
    if (p.grain && !['x', 'y', 'z'].includes(p.grain)) e.push(`part "${p.id}" grain must be x, y or z`);
  }
  return e;
}
