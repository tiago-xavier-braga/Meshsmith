// Assembles already-built kit modules into one GLB to check snapping and tile continuity:
//   node tools/kit-scene.mjs <out.glb> <layout.json>
// layout.json: [{ "asset": "kit-parede", "position": [x, y, z], "rotationY": 0 }, ...]
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments } from '@gltf-transform/functions';
import { ROOT } from '../lib/core/asset.js';

const [out, layoutPath] = process.argv.slice(2);
const layout = JSON.parse(await readFile(layoutPath, 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const target = new Document();
const root = target.createScene('KitScene');
target.createBuffer();
for (const item of layout) {
  const bp = JSON.parse(await readFile(join(ROOT, 'assets', item.asset, 'asset.json'), 'utf8'));
  const src = await io.read(join(ROOT, 'assets', item.asset, 'out', `${bp.meshName}.glb`));
  const map = mergeDocuments(target, src);
  const srcScene = src.getRoot().getDefaultScene() ?? src.getRoot().listScenes()[0];
  for (const n of srcScene.listChildren()) {
    const node = map.get(n);
    const a = ((item.rotationY ?? 0) * Math.PI) / 180;
    node.setTranslation(item.position).setRotation([0, Math.sin(a / 2), 0, Math.cos(a / 2)]);
    root.addChild(node);
  }
}
// mergeDocuments brings each source scene along; keep only the composed one.
for (const s of target.getRoot().listScenes()) if (s !== root) s.dispose();
const buffers = target.getRoot().listBuffers();
for (const b of buffers.slice(1)) {
  for (const parent of b.listParents()) if (parent !== target.getRoot()) parent.setBuffer(buffers[0]);
  b.dispose();
}
target.getRoot().setDefaultScene(root);
await io.write(out, target);
console.log(out);
