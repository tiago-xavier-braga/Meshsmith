// Pilar de canto 20 × 20 cm para fechar encontros de paredes do kit.
import { KIT } from '../../lib/kits/common.js';

export default function build(bp, { parts: P, materials }) {
  const s = bp.dimensions.x, H = bp.dimensions.y, d = KIT.baseboard.depth;
  const a = P.assembly(bp, materials);
  a.add('pillar', P.bevelBox({ size: [s - 2 * d, H, s - 2 * d], bevel: 0.004 }), { position: [s / 2, 0, s / 2] });
  a.add('baseboard', P.bevelBox({ size: [s, KIT.baseboard.height, s], bevel: 0.002 }), { position: [s / 2, 0, s / 2] });
  const sockets = [['north', [s / 2, 0, 0], [0, 180, 0]], ['south', [s / 2, 0, s], [0, 0, 0]], ['west', [0, 0, s / 2], [0, -90, 0]], ['east', [s, 0, s / 2], [0, 90, 0]]];
  for (const [n, pos, rot] of sockets) a.socket(n, pos, rot);
  return a.build();
}
