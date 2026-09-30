// Floor module 2 × 2 m: an 8 cm slab with 2 cm of boards on top.
export default function build(bp, { parts: P, materials }) {
  const { x, z } = bp.dimensions;
  const a = P.assembly(bp, materials);
  a.add('slab', P.bevelBox({ size: [x, 0.08, z], bevel: 0.003 }), { position: [x / 2, 0, z / 2] });
  a.add('deck', P.bevelBox({ size: [x, 0.02, z], bevel: 0.002 }), { position: [x / 2, 0.08, z / 2] });
  a.socket('north', [x / 2, 0, 0], [0, 180, 0]);
  a.socket('south', [x / 2, 0, z]);
  a.socket('west', [0, 0, z / 2], [0, -90, 0]);
  a.socket('east', [x, 0, z / 2], [0, 90, 0]);
  return a.build();
}
