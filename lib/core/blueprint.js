// asset.json schema check. Kept dependency-free: returns a list of error strings.
import { CATEGORIES } from './rules.js';

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MESH = /^SM_[A-Z][A-Za-z0-9]*$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

export const BLUEPRINT_SCHEMA_DOC = `
asset.json
  name            kebab-case folder name                      "cadeira-madeira"
  meshName        SM_ + PascalCase                            "SM_CadeiraMadeira"
  category        ${Object.keys(CATEGORIES).join(' | ')}
  style?          "pbr" | "lowpoly"                           (default by category)
  static?         bool, generates UV1 lightmap                (default true)
  pivot?          "base-center" | "grid-corner"               (default base-center)
  dimensions      { x, y, z } bounding box in metres (Y up, front +Z)
  triangleBudget? [min, max]                                  (default by category)
  texture?        { resolution, texelDensity, padding, margin }
  lightmap?       { resolution }                              (default 128)
  materials       { <id>: { color "#rrggbb", roughness, metalness, preset?, name? } }
  parts           [ { id, material, mirror?, stack?, tiling?, hidden? , ...params } ]
  reference?      { images: [paths in ref/], prompt?, camera?: { position, target, fov } }
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
  const res = bp.texture?.resolution;
  if (res && (res & (res - 1)) !== 0) e.push('texture.resolution must be a power of two');
  const mats = bp.materials ?? {};
  if (!Object.keys(mats).length) e.push('materials must declare at least one material');
  for (const [id, m] of Object.entries(mats)) {
    if (m.color && !HEX.test(m.color)) e.push(`materials.${id}.color must be #rrggbb`);
    for (const k of ['roughness', 'metalness']) {
      if (m[k] !== undefined && !(m[k] >= 0 && m[k] <= 1)) e.push(`materials.${id}.${k} must be in 0..1`);
    }
  }
  if (!Array.isArray(bp.parts) || !bp.parts.length) e.push('parts must be a non-empty array');
  const ids = new Set();
  for (const p of bp.parts ?? []) {
    if (!p.id) e.push('every part needs an id');
    if (ids.has(p.id)) e.push(`duplicate part id "${p.id}"`);
    ids.add(p.id);
    if (p.material && !mats[p.material]) e.push(`part "${p.id}" uses unknown material "${p.material}"`);
  }
  return e;
}
