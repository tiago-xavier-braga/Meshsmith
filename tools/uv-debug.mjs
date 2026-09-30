// Lists the worst UV0 islands by distortion for an asset (debug helper).
import { assetDir, buildAsset } from '../lib/core/asset.js';
import { resolveRules } from '../lib/core/rules.js';
import { unwrapAsset } from '../lib/uv/unwrap.js';
import { islands, islandStats } from '../lib/uv/metrics.js';
const { bp, root } = await buildAsset(assetDir(process.argv[2]));
const rules = resolveRules(bp);
const [info] = await unwrapAsset(root, rules);
let mesh; root.traverse((o) => { if (o.isMesh) mesh = o; });
const geo = mesh.geometry, parts = mesh.userData._parts, pi = geo.attributes.partIndex.array, idx = geo.index.array;
const { triIsland, count } = islands(geo, () => true, 'uv');
const stats = islandStats(geo, 'uv', info.resolution, triIsland, count, (t) => (parts[pi[idx[t * 3]]].hidden ? 0.25 : 1));
const partOf = new Map();
for (let t = 0; t < idx.length / 3; t++) partOf.set(triIsland[t], parts[pi[idx[t * 3]]].id);
const withId = stats.map((s, i) => ({ i, part: partOf.get(i), ...s })).filter((s) => s.uvArea >= 64);
withId.sort((a, b) => Math.max(b.areaDistortion, b.angleDistortion) - Math.max(a.areaDistortion, a.angleDistortion));
console.table(withId.slice(0, 10).map((s) => ({ part: s.part, area_cm2: +(s.worldArea * 1e4).toFixed(2), tris: s.n, density: +s.density.toFixed(0), px2: Math.round(s.uvArea), areaD: +(s.areaDistortion * 100).toFixed(1), angleD: +(s.angleDistortion * 100).toFixed(1) })));
console.log('islands', count, 'resolution', info.resolution);
