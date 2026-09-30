// Shared pieces of the modular architecture kit (kit-* assets). Units in metres, pivot on the
// grid corner (min x, y, z = 0), wall faces along X, thickness along Z. The baseboards live
// inside the module thickness so the bounding box stays on the grid.
export const KIT = {
  grid: [0.5, 0.5, 0.1],
  wall: { length: 2, height: 3, thickness: 0.2 },
  baseboard: { height: 0.1, depth: 0.015 },
};

/** Plaster core between the baseboards; `cut` is subtracted (door/window openings). */
export function wallSlab(P, a, { length, height, thickness }, cut = null) {
  const d = KIT.baseboard.depth, core = thickness - 2 * d;
  let wall = P.transform(P.bevelBox({ size: [length, height, core], bevel: 0.003 }), { position: [length / 2, 0, thickness / 2] });
  if (cut) wall = P.csg(wall, 'subtract', cut);
  a.add('wall', wall);
}

/** Baseboards on both faces over the [x0, x1] spans (skip door openings). */
export function baseboards(P, a, spans, thickness) {
  const { height, depth } = KIT.baseboard;
  for (const [x0, x1] of spans) {
    const len = x1 - x0;
    for (const z of [depth / 2, thickness - depth / 2]) {
      a.add('baseboard', P.bevelBox({ size: [len, height, depth], bevel: 0.002 }), { position: [x0 + len / 2, 0, z] });
    }
  }
}

/** Wall end sockets: +Z of each socket points away from the module. */
export function wallSockets(a, { length, thickness }) {
  a.socket('left', [0, 0, thickness / 2], [0, -90, 0]);
  a.socket('right', [length, 0, thickness / 2], [0, 90, 0]);
}
