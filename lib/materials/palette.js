// Low-poly style: every material is a cell of a small palette texture (T_<Nome>_Palette).
// UV0 of a face points inside its material's cell, so overlap is intentional; the lightmap
// UV1 is still a regular xatlas layout. A material may declare `gradient: "#rrggbb"` for a
// vertical gradient (bottom = color, top = gradient) sampled by the asset height.
import sharp from 'sharp';
import * as THREE from 'three';

export const PALETTE = { size: 256, grid: 8 }; // 8 × 8 cells of 32 px
const INSET = 0.25; // keep UVs this fraction of a cell away from its border (mip safety)

export function paletteCells(bp) {
  const ids = Object.keys(bp.materials);
  if (ids.length > PALETTE.grid * PALETTE.grid) throw new Error(`palette holds at most ${PALETTE.grid ** 2} materials`);
  return Object.fromEntries(ids.map((id, i) => [id, { index: i, col: i % PALETTE.grid, row: Math.floor(i / PALETTE.grid) }]));
}

/** Cell bounds in Three UV space (V up): row 0 is the top row of the image. */
export function cellBounds(cell) {
  const s = 1 / PALETTE.grid;
  const u0 = cell.col * s, v1 = 1 - cell.row * s;
  return { u0, u1: u0 + s, v0: v1 - s, v1 };
}

/** Writes palette UVs on every mesh and returns the palette PNG. */
export async function applyPalette(root, bp) {
  const cells = paletteCells(bp);
  const matIds = Object.keys(bp.materials);
  const box = new THREE.Box3().setFromObject(root, true);
  const h = Math.max(1e-6, box.max.y - box.min.y);
  root.traverse((o) => {
    if (!o.isMesh || !o.userData._parts) return;
    const g = o.geometry, pos = g.attributes.position, idx = g.index.array;
    const uv = new Float32Array(pos.count * 2);
    for (const grp of g.groups) {
      const id = matIds[grp.materialIndex];
      const b = cellBounds(cells[id]);
      const def = bp.materials[id];
      const dv = (b.v1 - b.v0) * INSET;
      for (let i = grp.start; i < grp.start + grp.count; i++) {
        const v = idx[i];
        const t = def.gradient ? (pos.getY(v) - box.min.y) / h : 0.5;
        uv[v * 2] = (b.u0 + b.u1) / 2;
        uv[v * 2 + 1] = b.v0 + dv + t * (b.v1 - b.v0 - 2 * dv);
      }
    }
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  });
  return paletteImage(bp, cells);
}

async function paletteImage(bp, cells) {
  const N = PALETTE.size, cellPx = N / PALETTE.grid;
  const rgba = new Uint8Array(N * N * 4).fill(255);
  const hex = (c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
  for (const [id, cell] of Object.entries(cells)) {
    const def = bp.materials[id];
    const a = hex(def.color ?? '#cccccc'), b = hex(def.gradient ?? def.color ?? '#cccccc');
    for (let y = 0; y < cellPx; y++) {
      // Image rows go down; the gradient runs bottom (color) -> top (gradient) of the cell.
      const t = def.gradient ? 1 - (y + 0.5) / cellPx : 0;
      // Interpolate in linear light so the gradient matches what the engine will display.
      const c = a.map((ai, k) => {
        const lin = (x) => (x / 255) ** 2.2;
        return Math.round(255 * ((1 - t) * lin(ai) + t * lin(b[k])) ** (1 / 2.2));
      });
      for (let x = 0; x < cellPx; x++) {
        const p = ((cell.row * cellPx + y) * N + cell.col * cellPx + x) * 4;
        rgba.set([c[0], c[1], c[2], 255], p);
      }
    }
  }
  return sharp(Buffer.from(rgba), { raw: { width: N, height: N, channels: 4 } }).png().toBuffer();
}
