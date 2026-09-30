#!/usr/bin/env node
// studio3d <command> <asset> [options]
//   new       scaffold assets/<asset>/ (ref/, prompt.md, asset.json, asset.js)
//   build     asset.js -> UV0/UV1 -> out/SM_<Nome>.glb
//   uv        build + UV layout images (debug/uv0.png, uv1.png) + UV metrics
//   render    build + views -> iterations/<n>/ + sheet.png (reference beside renders)
//             --mode shaded,checker,uv1,wire,clay,normals  --views front,right,top,iso
//   validate  build + all checks -> out/report.json (exit 1 on blocking failures)
//   export    validate, then build the package dist/<asset>/ + dist/<asset>.zip (--dest, --force to skip the gate)
import { mkdir, readdir, cp, writeFile, rm, readFile, stat } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { existsSync } from 'node:fs';
import { join, basename, sep } from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { assetDir, buildAsset } from '../lib/core/asset.js';
import { resolveRules } from '../lib/core/rules.js';
import { writeGLB } from '../lib/core/gltf.js';
import { openStudio } from '../lib/core/render.js';
import { unwrapAsset } from '../lib/uv/unwrap.js';
import { validateAsset } from '../lib/validate/index.js';
import { contactSheet } from '../lib/core/sheet.js';
import { ROOT } from '../lib/core/asset.js';

// The tool never writes into engine projects: packages go to dist/ and are copied from there.
const DEFAULT_DEST = join(ROOT, 'dist');
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

function referenceImages(dir, bp) {
  return (bp.reference?.images ?? []).map((p) => join(dir, 'ref', p)).filter((p) => existsSync(p));
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
    // One sheet per iteration: references first, then the camera-matched render and the views.
    const refs = referenceImages(dir, bp).map((p, i) => ({ label: `referência ${i + 1}`, input: p }));
    const renders = files.map((f) => ({ label: basename(f, '.png'), input: f }));
    const sheet = join(out, 'sheet.png');
    const n = Number(basename(out));
    await writeFile(sheet, await contactSheet([...refs, ...renders], {
      columns: Math.min(4, refs.length + renders.length),
      title: `${bp.meshName} · iteração ${n} · ${stats.triangles} tris · ${stats.size.map((v) => v.toFixed(3)).join(' × ')} m`,
    }));
    const max = resolveRules(bp).maxIterations;
    if (n > max) console.warn(`aviso: iteração ${n} passou do teto de ${max} (spec: máximo de 5 por padrão)`);
    console.log(JSON.stringify({ iteration: out, sheet, stats, files }, null, 2));
  } finally {
    await studio.close();
  }
}

/** out/preview.png: the four views side by side with the references (spec package). */
async function writePreview(dir, bp) {
  const studio = await openStudio();
  try {
    await studio.load(join(dir, 'out', `${bp.meshName}.glb`));
    const cells = referenceImages(dir, bp).map((p, i) => ({ label: `referência ${i + 1}`, input: p }));
    for (const view of DEFAULT_VIEWS) cells.push({ label: view, input: await studio.render({ view, width: 512, height: 512 }) });
    await writeFile(join(dir, 'out', 'preview.png'), await contactSheet(cells, { cell: 512, columns: Math.min(4, cells.length), title: bp.meshName }));
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
  await writePreview(dir, bp);
  const dest = join(values.dest, bp.name);
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  await cp(join(dir, 'out'), dest, { recursive: true });
  // Zip of the same folder, for handing the package over.
  const files = {};
  for (const rel of await readdir(dest, { recursive: true, withFileTypes: false })) {
    const abs = join(dest, rel);
    if ((await stat(abs)).isFile()) files[`${bp.name}/${rel.split(sep).join('/')}`] = new Uint8Array(await readFile(abs));
  }
  await writeFile(`${dest}.zip`, zipSync(files, { level: 6 }));
  log(`exported ${bp.name} -> ${dest} (+ .zip)`);
}

const pascal = (s) => s.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());

async function scaffold(name) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) throw new Error('asset name must be kebab-case');
  const dir = join(ROOT, 'assets', name);
  if (existsSync(dir)) throw new Error(`${dir} already exists`);
  await mkdir(join(dir, 'ref'), { recursive: true });
  const tpl = join(ROOT, 'templates');
  const fill = async (f) => (await readFile(join(tpl, f), 'utf8')).replaceAll('__NAME__', name).replaceAll('__MESH__', `SM_${pascal(name)}`);
  await writeFile(join(dir, 'asset.json'), await fill('asset.json'));
  await writeFile(join(dir, 'asset.js'), await fill('asset.js'));
  await writeFile(join(dir, 'ref', 'prompt.md'), await fill('prompt.md'));
  console.log(`created ${dir}`);
}

const COMMANDS = { build, uv, render, validate, export: exportAsset };

if (cmd === 'new' && name) {
  await scaffold(name);
  process.exit(0);
}
if (!COMMANDS[cmd] || !name) {
  console.log(`usage: studio3d <new|${Object.keys(COMMANDS).join('|')}> <asset> [--mode m1,m2] [--views v1,v2] [--size 768] [--dest path] [--force]`);
  process.exit(cmd ? 1 : 0);
}
const result = await COMMANDS[cmd](assetDir(name));
if (cmd === 'validate' && !result.report.passed) process.exit(1);
