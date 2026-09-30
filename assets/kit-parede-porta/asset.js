// Módulo de parede com porta: vão 0,9 × 2,1 m centralizado, batente em três peças.
import { KIT, wallSlab, baseboards, wallSockets } from '../../lib/kits/common.js';

export default function build(bp, { parts: P, materials }) {
  const { length, thickness } = KIT.wall;
  const w = 0.9, h = 2.1, x0 = (length - w) / 2, x1 = x0 + w, jamb = 0.07;
  const a = P.assembly(bp, materials);
  const opening = P.transform(P.bevelBox({ size: [w, h, 1], bevel: 0 }), { position: [length / 2, -0.01, thickness / 2] });
  wallSlab(P, a, KIT.wall, opening);
  baseboards(P, a, [[0, x0 - jamb], [x1 + jamb, length]], thickness);
  // Casing: two jambs and a head, as deep as the module so both faces get a frame.
  for (const x of [x0 - jamb / 2, x1 + jamb / 2]) a.add('casing', P.bevelBox({ size: [jamb, h + jamb, thickness], bevel: 0.004 }), { position: [x, 0, thickness / 2] });
  a.add('casing', P.bevelBox({ size: [w, jamb, thickness], bevel: 0.004 }), { position: [length / 2, h, thickness / 2] });
  wallSockets(a, KIT.wall);
  a.socket('door', [length / 2, 0, thickness / 2]);
  return a.build();
}
