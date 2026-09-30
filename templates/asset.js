// __MESH__ generator. Units: metres, Y up, front towards +Z, pivot at the centre of the base.
// Library: see lib/parts/README.md.
export default function build(bp, { parts: P, materials }) {
  const { x, y, z } = bp.dimensions;
  const a = P.assembly(bp, materials);
  a.add('body', P.bevelBox({ size: [x, y, z], bevel: 0.004 }));
  return a.build();
}
