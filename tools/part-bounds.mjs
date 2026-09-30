// Prints the bounding box of every part add() call of an asset (debug helper).
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as P from '../lib/parts/index.js';
import { assetDir } from '../lib/core/asset.js';
const dir = assetDir(process.argv[2]);
const bp = JSON.parse(readFileSync(join(dir, 'asset.json'), 'utf8'));
const { default: build } = await import(pathToFileURL(join(dir, 'asset.js')).href);
const fake = { ...P, assembly: () => ({ add: (id, g, xf) => { const b = new THREE.Box3().setFromBufferAttribute((xf ? P.transform(g, xf) : g).attributes.position); console.log(id.padEnd(12), b.min.toArray().map((v) => v.toFixed(3)).join(','), '->', b.max.toArray().map((v) => v.toFixed(3)).join(',')); }, build: () => new THREE.Group() }) };
build(bp, { THREE, parts: fake, materials: {} });
