// Contact sheets: reference images next to the renders, as one PNG.
// One image per iteration keeps the comparison loop cheap in tokens.
import sharp from 'sharp';

const BG = { r: 30, g: 31, b: 34, alpha: 1 };

async function label(text, width) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="28">
    <rect width="100%" height="100%" fill="#1e1f22"/>
    <text x="10" y="19" font-family="Segoe UI, Arial, sans-serif" font-size="15" fill="#d6d8dc">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * @param {{ label: string, input: string|Buffer }[]} cells images (paths or buffers)
 * @param {{ cell?: number, columns?: number, title?: string }} opts
 * @returns {Promise<Buffer>} PNG
 */
export async function contactSheet(cells, { cell = 384, columns = 3, title } = {}) {
  const rows = Math.ceil(cells.length / columns);
  const labelH = 28, titleH = title ? 34 : 0;
  const width = columns * cell, height = titleH + rows * (cell + labelH);
  const layers = [];
  if (title) layers.push({ input: await label(title, width), top: 3, left: 0 });
  for (let i = 0; i < cells.length; i++) {
    const x = (i % columns) * cell, y = titleH + Math.floor(i / columns) * (cell + labelH);
    const img = await sharp(cells[i].input).resize(cell, cell, { fit: 'contain', background: BG }).png().toBuffer();
    layers.push({ input: await label(cells[i].label, cell), top: y, left: x });
    layers.push({ input: img, top: y + labelH, left: x });
  }
  return sharp({ create: { width, height, channels: 4, background: BG } }).composite(layers).png().toBuffer();
}
