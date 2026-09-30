// Kit wall module 2 × 3 m (0.5 m grid).
import { KIT, wallSlab, baseboards, wallSockets } from '../../lib/kits/common.js';

export default function build(bp, { parts: P, materials }) {
  const a = P.assembly(bp, materials);
  wallSlab(P, a, KIT.wall);
  baseboards(P, a, [[0, KIT.wall.length]], KIT.wall.thickness);
  wallSockets(a, KIT.wall);
  return a.build();
}
