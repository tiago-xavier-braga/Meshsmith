// Renders the README showcase: built assets side by side, plus the modular kit assembled.
//   node tools/showcase.mjs [out.png]
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { ROOT } from '../lib/core/asset.js';
import { openStudio } from '../lib/core/render.js';

const out = process.argv[2] ?? join(ROOT, 'docs', 'media', 'showcase.png');
const ASSETS = ['extintor-agua', 'cadeira-estofada', 'cadeira-adirondack', 'tambor-metal', 'banco-madeira', 'banco-madeira-lp', 'cone-transito'];
const CELL = 420, COLS = 4;

// Inside the project: the studio only serves files under the project root (dist/ is ignored).
const tmp = join(ROOT, 'dist', '.showcase');
await mkdir(tmp, { recursive: true });
try {
  const kitGlb = join(tmp, 'kit.glb');
  const kit = spawnSync(process.execPath, [join(ROOT, 'tools', 'kit-scene.mjs'), kitGlb, join(ROOT, 'tools', 'kit-layout.example.json')], { encoding: 'utf8' });
  if (kit.status !== 0) throw new Error(kit.stderr);

  const studio = await openStudio();
  const tiles = [];
  for (const name of ASSETS) {
    const bp = JSON.parse(await readFile(join(ROOT, 'assets', name, 'asset.json'), 'utf8'));
    await studio.load(join(ROOT, 'assets', name, 'out', `${bp.meshName}.glb`));
    tiles.push(await studio.render({ view: 'iso', width: CELL, height: CELL, background: '#2b2d31' }));
  }
  await studio.load(kitGlb);
  tiles.push(await studio.render({ view: { position: [7.4, 4.6, 8.2], target: [1.7, 1.1, 1.7], fov: 40 }, width: CELL, height: CELL, background: '#2b2d31' }));
  await studio.close();

  const rows = Math.ceil(tiles.length / COLS);
  const png = await sharp({ create: { width: COLS * CELL, height: rows * CELL, channels: 3, background: '#2b2d31' } })
    .composite(tiles.map((input, i) => ({ input, left: (i % COLS) * CELL, top: Math.floor(i / COLS) * CELL })))
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(out, png);
  console.log(out);
} finally {
  await rm(tmp, { recursive: true, force: true });
}
