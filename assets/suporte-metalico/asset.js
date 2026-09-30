// Cantoneira em L: perfil extrudado, reforço central e furos cortados via CSG.
export default function build(bp, { parts: P, materials }) {
  const W = bp.dimensions.x, L = bp.dimensions.z, H = bp.dimensions.y;
  const T = 0.008, r = 0.0045;
  const a = P.assembly(bp, materials);
  // Profile drawn in (u = -z, v = y) and extruded along Z, then turned 90° so width runs along X.
  const toX = { rotation: [0, 90, 0] };

  const profile = [[0, 0], [-L, 0], [-L, T], [-T - 0.006, T], [-T, T + 0.006], [-T, H], [0, H]];
  const body = P.transform(P.extrude({ shape: profile, depth: W, bevel: 0.0012 }), toX);

  // Slotted holes (capsule outline), horizontal on both flanges.
  const slot = P.extrude({ shape: P.roundedRect(0.016, 2 * r, r - 0.0002, 5), depth: 0.04, bevel: 0 });
  const cuts = [];
  for (const x of [-W * 0.3, W * 0.3]) {
    cuts.push(P.transform(slot, { position: [x, 0, 0.075], rotation: [90, 0, 0] }));      // base flange (vertical)
    cuts.push(P.transform(slot, { position: [x, 0.08, 0] }));                           // back flange (along Z)
  }
  a.add('bracket', P.csg(body, 'subtract', ...cuts), { position: [0, 0, -L / 2] });

  const gusset = P.extrude({ shape: [[-T, T], [-0.075, T], [-T, 0.075]], depth: 0.006, bevel: 0.0008 });
  a.add('gusset', P.transform(gusset, toX), { position: [0, 0, -L / 2] });
  return a.build();
}
