// Starts a static server over the project root and drives studio/ with Playwright.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, relative, sep } from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from './asset.js';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm',
};

function serve() {
  const server = createServer(async (req, res) => {
    const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (!path.startsWith(ROOT + sep) && path !== ROOT) return res.writeHead(403).end();
    try {
      const body = await readFile(path);
      res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

/** Opens the studio once; call .load(glbPath) and .render(opts, outPath) repeatedly. */
export async function openStudio() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  // Ask Chromium for the real GPU instead of SwiftShader. The ANGLE backend is left to the
  // platform default (d3d11 on Windows, GL on Linux): pinning d3d11 loses the context off Windows.
  const browser = await chromium.launch({
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`${base}/studio/index.html`);
  try {
    await page.waitForFunction(() => window.studioReady === true, null, { timeout: 30000 });
  } catch (e) {
    throw new Error(`studio failed to start:\n${logs.join('\n')}`);
  }
  const toUrl = (p) => '/' + relative(ROOT, p).split(sep).map(encodeURIComponent).join('/');
  return {
    logs,
    info: () => page.evaluate(() => window.studio.info()),
    meshes: () => page.evaluate(() => window.studio.meshes()),
    load: (glbPath) => page.evaluate((u) => window.studio.load(u), `${toUrl(glbPath)}?t=${Date.now()}`),
    async render(opts, outPath) {
      const dataUrl = await page.evaluate((o) => window.studio.render(o), opts);
      const png = Buffer.from(dataUrl.split(',')[1], 'base64');
      if (outPath) await writeFile(outPath, png);
      return png;
    },
    async close() {
      await browser.close();
      server.close();
    },
  };
}
