// Times the PBR bake stages for an asset (debug helper).
import { assetDir, buildAsset } from '../lib/core/asset.js';
import { resolveRules } from '../lib/core/rules.js';
import { unwrapAsset } from '../lib/uv/unwrap.js';
import { bakePBR } from '../lib/materials/bake.js';
const { bp, root } = await buildAsset(assetDir(process.argv[2]));
const rules = resolveRules(bp);
let t = performance.now();
const info = await unwrapAsset(root, rules, bp);
console.log('uv', Math.round(performance.now() - t), 'ms');
let mesh; root.traverse((o) => { if (o.isMesh) mesh = o; });
process.env.STUDIO3D_PROFILE = '1';
t = performance.now();
const r = await bakePBR(mesh, bp, rules, info[0].resolution);
console.log('bake', Math.round(performance.now() - t), 'ms', r.presets);
