// Loads an asset folder (asset.json + asset.js) and builds its Three.js scene.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import * as parts from '../parts/index.js';
import { createMaterials } from '../materials/index.js';
import { validateBlueprint } from './blueprint.js';

export const ROOT = resolve(import.meta.dirname, '../..');

export function assetDir(name) {
  const dir = existsSync(name) ? resolve(name) : join(ROOT, 'assets', name);
  if (!existsSync(join(dir, 'asset.json'))) throw new Error(`asset.json not found in ${dir}`);
  return dir;
}

export async function loadBlueprint(dir) {
  const bp = JSON.parse(await readFile(join(dir, 'asset.json'), 'utf8'));
  const errors = validateBlueprint(bp);
  if (errors.length) throw new Error(`Invalid blueprint:\n  - ${errors.join('\n  - ')}`);
  return bp;
}

/** Builds the asset scene. Returns { bp, root }. */
export async function buildAsset(dir) {
  const bp = await loadBlueprint(dir);
  const url = pathToFileURL(join(dir, 'asset.js'));
  url.searchParams.set('t', Date.now()); // bypass the ESM cache between iterations
  const { default: build } = await import(url.href);
  const materials = createMaterials(bp);
  const root = await build(bp, { THREE, parts, materials });
  if (!root?.isObject3D) throw new Error('asset.js must return a THREE.Object3D');
  root.name ||= bp.meshName;
  root.updateMatrixWorld(true);
  return { bp, root };
}
