#!/usr/bin/env node
// studio3d <command> <asset> [options]
//   build     asset.js -> out/SM_<Nome>.glb
//   render    4 views (+ reference camera) -> iterations/<n>/ ; --mode shaded|checker|uv1|wire|clay
//   validate  checks -> out/report.json            (F2 adds the UV checks)
//   export    copies out/ into the Unity project   (--dest <Assets folder>)
import { mkdir, readdir, cp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { assetDir, buildAsset } from '../lib/core/asset.js';
import { writeGLB } from '../lib/core/gltf.js';
import { openStudio } from '../lib/core/render.js';

const DEFAULT_DEST = 'dist';
const DEFAULT_VIEWS = ['front', 'right', 'top', 'iso'];

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    mode: { type: 'string', default: 'shaded' },
    views: { type: 'string' },
    size: { type: 'string', default: '768' },
    dest: { type: 'string', default: DEFAULT_DEST },
  },
});
const [cmd, name] = positionals;

async function build(dir) {
  const { bp, root } = await buildAsset(dir);
  await mkdir(join(dir, 'out'), { recursive: true });
  const glb = join(dir, 'out', `${bp.meshName}.glb`);
  await writeGLB(root, glb);
  console.log(`built ${glb}`);
  return { bp, root, glb };
}

async function nextIteration(dir) {
  const it = join(dir, 'iterations');
  await mkdir(it, { recursive: true });
  const n = (await readdir(it)).filter((d) => /^\d+$/.test(d)).length + 1;
  const out = join(it, String(n).padStart(2, '0'));
  await mkdir(out);
  return out;
}

async function render(dir) {
  const { bp, glb } = await build(dir);
  const out = await nextIteration(dir);
  const studio = await openStudio();
  try {
    const stats = await studio.load(glb);
    const size = Number(values.size);
    const views = values.views ? values.views.split(',') : DEFAULT_VIEWS;
    const modes = values.mode.split(',');
    const files = [];
    for (const mode of modes) {
      for (const view of views) {
        const f = join(out, `${view}_${mode}.png`);
        await studio.render({ view, mode, width: size, height: size }, f);
        files.push(f);
      }
      if (bp.reference?.camera) {
        const f = join(out, `reference_${mode}.png`);
        await studio.render({ view: bp.reference.camera, mode, width: size, height: size }, f);
        files.push(f);
      }
    }
    await writeFile(join(out, 'stats.json'), JSON.stringify(stats, null, 2));
    console.log(JSON.stringify({ iteration: out, stats, files }, null, 2));
  } finally {
    await studio.close();
  }
}

async function exportAsset(dir) {
  const { bp } = await build(dir);
  const dest = join(values.dest, bp.name);
  await mkdir(dest, { recursive: true });
  await cp(join(dir, 'out'), dest, { recursive: true });
  console.log(`exported ${bp.name} -> ${dest}`);
}

const COMMANDS = { build, render, export: exportAsset };

if (!COMMANDS[cmd] || !name) {
  console.log(`usage: studio3d <${Object.keys(COMMANDS).join('|')}> <asset> [--mode m1,m2] [--views v1,v2] [--size 768] [--dest path]`);
  process.exit(cmd ? 1 : 0);
}
if (!existsSync(join(assetDir(name), 'asset.js'))) throw new Error('asset.js missing');
await COMMANDS[cmd](assetDir(name));
