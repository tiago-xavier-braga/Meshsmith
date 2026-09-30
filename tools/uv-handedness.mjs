// Counts triangles whose UV winding is mirrored relative to their 3D winding.
import { assetDir, buildAsset } from '../lib/core/asset.js';
import { resolveRules } from '../lib/core/rules.js';
import { unwrapAsset } from '../lib/uv/unwrap.js';
const { bp, root } = await buildAsset(assetDir(process.argv[2]));
await unwrapAsset(root, resolveRules(bp));
let mesh; root.traverse((o) => { if (o.isMesh) mesh = o; });
const g = mesh.geometry, uv = g.attributes.uv, idx = g.index.array;
let pos = 0, neg = 0;
for (let t = 0; t < idx.length / 3; t++) {
  const [a, b, c] = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
  const s = (uv.getX(b) - uv.getX(a)) * (uv.getY(c) - uv.getY(a)) - (uv.getY(b) - uv.getY(a)) * (uv.getX(c) - uv.getX(a));
  if (s > 0) pos++; else if (s < 0) neg++;
}
console.log(process.argv[2], { counterClockwise: pos, mirrored: neg });
