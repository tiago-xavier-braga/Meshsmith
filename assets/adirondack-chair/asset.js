// Adirondack chair (low-poly). Typical measurements: 78 × 96 × 92 cm, seat ~40 cm high at the front.
// Side profiles drawn in (u = -z, y) and extruded in X; back slats fanned out.
export default function build(bp, { parts: P, materials }) {
  const a = P.assembly(bp, materials);
  const deg = Math.PI / 180;
  // Side-profile board: outline in (z, y), thickness t along X, centred at x.
  const side = (pts, x, t) => P.transform(P.extrude({ shape: pts.map(([z, y]) => [-z, y]), depth: t, bevel: 0 }), { position: [x, 0, 0], rotation: [0, 90, 0] });

  // Stringers: front top at 40 cm, sloping to the ground at the back with an angled end.
  const stringer = [[0.43, 0.40], [-0.36, 0.13], [-0.47, 0.0], [-0.26, 0.0], [0.43, 0.27]];
  for (const x of [-0.3, 0.3]) a.add('stringer', side(stringer, x, 0.03));

  // Seat slats along the stringer top line (slope ≈ 19°, front higher).
  const slope = (0.40 - 0.13) / (0.43 + 0.36), tilt = Math.atan(slope) / deg;
  const topAt = (z) => 0.40 - (0.43 - z) * slope;
  for (let i = 0; i < 7; i++) {
    const z = 0.39 - i * 0.078;
    a.add('seat', P.bevelBox({ size: [0.63, 0.02, 0.066], bevel: 0 }), { position: [0, topAt(z), z], rotation: [-tilt, 0, 0] });
  }

  // Front apron: two boards under the front of the seat, between the legs.
  for (const y of [0.27, 0.33]) a.add('apron', P.bevelBox({ size: [0.635, 0.05, 0.02], bevel: 0 }), { position: [0, y, 0.415] });

  // Front legs and rear arm posts.
  for (const x of [-0.335, 0.335]) {
    a.add('leg', P.bevelBox({ size: [0.035, 0.575, 0.09], bevel: 0 }), { position: [x, 0, 0.36] });
    a.add('post', P.bevelBox({ size: [0.035, 0.42, 0.07], bevel: 0 }), { position: [x, 0.155, -0.24] });
  }

  // Back: 6 slats fanning out, leaning back 31°, tops on an arc.
  const lean = 31, base = [0, 0.26, -0.12];
  const arc = (x) => 0.40 + Math.sqrt(0.46 ** 2 - x * x);
  const backXf = (geo, fan = 0) => P.transform(P.transform(geo, { rotation: [0, 0, fan] }), { position: base, rotation: [-lean, 0, 0] });
  for (let i = 0; i < 6; i++) {
    const cx = (i - 2.5) * 0.092, w = 0.084;
    const slat = P.extrude({ shape: [[cx - w / 2, 0], [cx + w / 2, 0], [cx + w / 2, arc(cx + w / 2)], [cx - w / 2, arc(cx - w / 2)]], depth: 0.02, bevel: 0 });
    a.add('back', backXf(slat, -(i - 2.5) * 2.2));
  }
  // Two rails behind the slats (slat-local height h, 2.5 cm behind them).
  for (const h of [0.12, 0.44]) {
    const rail = P.transform(P.bevelBox({ size: [0.6, 0.04, 0.03], bevel: 0, origin: 'center' }), { position: [0, h, -0.025] });
    a.add('rail', backXf(rail));
  }

  // Arms: wide flat boards, front corners cut, 58 cm high.
  const armShape = [[-0.075, -0.34], [0.075, -0.34], [0.075, 0.42], [0.05, 0.47], [-0.05, 0.47], [-0.075, 0.42]];
  const arm = P.transform(P.extrude({ shape: armShape.map(([x, z]) => [x, -z]), depth: 0.025, bevel: 0 }), { rotation: [-90, 0, 0] });
  for (const x of [-0.33, 0.33]) {
    a.add('arm', arm, { position: [x, 0.5875, 0] });
    // Corbel under the front of each arm, on the outer face of the leg.
    a.add('bracket', side([[0.42, 0.575], [0.3, 0.575], [0.42, 0.43]], x + Math.sign(x) * 0.03, 0.025));
    a.add('bolt', P.cylinder({ radius: 0.008, height: 0.006, segments: 6, bevel: 0 }), { position: [x + Math.sign(x) * 0.0175, 0.33, 0.36], rotation: [0, 0, Math.sign(x) * -90] });
  }
  return a.build();
}
