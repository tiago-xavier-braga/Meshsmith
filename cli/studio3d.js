#!/usr/bin/env node
// studio3d <command> <asset> [options]
//   build     asset.js -> UV0/UV1 -> out/SM_<Nome>.glb
//   uv        build + UV layout images (debug/uv0.png, uv1.png) + UV metrics
//   render    build + views -> iterations/<n>/   --mode shaded,checker,uv1,wire,clay,normals  --views front,right,top,iso
//   validate  build + all checks -> out/report.json (exit 1 on blocking failures)
//   export    validate, then copy out/ into the Unity project (--dest, --force to skip the gate)
import { mkdir, readdir, cp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { assetDir, buildAsset } from '../lib/core/asset.js';
import { resolveRules } from '../lib/core/rules.js';
import { writeGLB } from '../lib/core/gltf.js';
import { openStudio } from '../lib/core/render.js';
import { unwrapAsset } from '../lib/uv/unwrap.js';
import { validateAsset } from '../lib/validate/index.js';

const DEFAULT_DEST = 'dist';
const DEFAULT_VIEWS = ['front', 'right', 'top', 'iso'];

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    mode: { type: 'string', default: 'shaded' },
    views: { type: 'string' },
    size: { type: 'string', default: '768' },
    dest: { type: 'string', default: DEFAULT_DEST },
    force: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
  },
});
const [cmd, name] = positionals;
const log = (...a) => { if (!values.quiet) console.log(...a); };

async function build(dir) {
  const t0 = performance.now();
  const { bp, root } = await buildAsset(dir);
  const rules = resolveRules(bp);
  const uvInfo = await unwrapAsset(root, rules);
  await mkdir(join(dir, 'out'), { recursive: true });
  const glb = join(dir, 'out', `${bp.meshName}.glb`);
  await writeGLB(root, glb);
  log(`built ${glb} (${Math.round(performance.now() - t0)} ms)`);
  return { bp, rules, root, glb, uvInfo };
}

async function writeImages(dir, images) {
  const dbg = join(dir, 'debug');
  await mkdir(dbg, { recursive: true });
  for (const im of images) {
    await sharp(Buffer.from(im.rgba), { raw: { width: im.size, height: im.size, channels: 4 } }).png().toFile(join(dbg, `${im.name}.png`));
  }
  return dbg;
}

async function validate(dir) {
  const ctx = await build(dir);
  const { report, images } = await validateAsset({ ...ctx, glbPath: ctx.glb, dir });
  await writeFile(join(dir, 'out', 'report.json'), JSON.stringify(report, null, 2));
  await writeImages(dir, images);
  const icon = { pass: '✔', fail: '✘', warn: '!', pending: '…', 'n/a': '-' };
  log(`\n${report.mesh}  ${report.passed ? 'PASSOU' : 'FALHOU'} nos checks bloqueantes${report.pending.length ? ` (pendente: ${report.pending.join(', ')})` : ''}`);
  for (const c of report.checks) log(`  ${icon[c.status]} ${c.label.padEnd(18)} ${c.value}${c.blocking ? '' : '  (alerta)'}`);
  return { ...ctx, report };
}

async function uv(dir) {
  const { report } = await validate(dir);
  const dbg = join(dir, 'debug');
  log(`UV layouts: ${join(dbg, 'uv0.png')}${report.checks.find((c) => c.id === 'uv1-lightmap')?.status !== 'n/a' ? `, ${join(dbg, 'uv1.png')}` : ''}`);
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
    const files = [];
    for (const mode of values.mode.split(',')) {
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
  const { bp, report } = await validate(dir);
  if (!report.readyToExport && !values.force) {
    console.error(`\nexport bloqueado: ${[...report.blockingFailed, ...report.pending].join(', ')} (use --force para ignorar)`);
    process.exit(1);
  }
  const dest = join(values.dest, bp.name);
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  await cp(join(dir, 'out'), dest, { recursive: true });
  log(`exported ${bp.name} -> ${dest}`);
}

const COMMANDS = { build, uv, render, validate, export: exportAsset };

if (!COMMANDS[cmd] || !name) {
  console.log(`usage: studio3d <${Object.keys(COMMANDS).join('|')}> <asset> [--mode m1,m2] [--views v1,v2] [--size 768] [--dest path] [--force]`);
  process.exit(cmd ? 1 : 0);
}
const result = await COMMANDS[cmd](assetDir(name));
if (cmd === 'validate' && !result.report.passed) process.exit(1);
