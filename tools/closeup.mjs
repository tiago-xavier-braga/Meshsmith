// Close-up renders of an already built asset (no iteration folder):
//   tools/closeup.mjs <asset> <out.png> [x,y,z] [tx,ty,tz] [fov] [lod: 0 | 1 | 2 | col]
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { assetDir } from '../lib/core/asset.js';
import { openStudio } from '../lib/core/render.js';
const [name, out, pos = '0.3,0.25,0.35', target = '0,0.15,0.05', fov = '18', lod = '0'] = process.argv.slice(2);
const dir = assetDir(name);
const bp = JSON.parse(readFileSync(join(dir, 'asset.json'), 'utf8'));
const s = await openStudio();
await s.load(join(dir, 'out', `${bp.meshName}.glb`));
await s.render({ view: { position: pos.split(',').map(Number), target: target.split(',').map(Number), fov: Number(fov) }, width: 1024, height: 1024, lod: lod === 'col' ? 'col' : Number(lod) }, out);
await s.close();
console.log(out);
