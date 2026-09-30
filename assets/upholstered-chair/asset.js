// Classic dining chair (typical measurements: seat at 47 cm, 98 cm tall, 45 × 53 cm).
// Turned front legs (lathe) with square blocks; curved rear legs swept from a
// square section rising into the finials; upholstery as rounded boxes.
export default function build(bp, { parts: P, materials }) {
  const a = P.assembly(bp, materials);
  const X = bp.dimensions.x / 2 - 0.025; // leg centre line (x)
  const zF = 0.235;                      // front legs
  const seatY = 0.43, apronH = 0.06;
  const lean = -9.5;                     // back leans 9.5° (back-leg slope above the seat)

  // Front legs: turned column with a foot, a block at the stretcher and a block under the apron.
  const turned = [
    [0, 0], [0.014, 0], [0.019, 0.012], [0.02, 0.028], [0.013, 0.05], [0.017, 0.06], [0.017, 0.13],
    [0.014, 0.145], [0.019, 0.165], [0.012, 0.195], [0.016, 0.24], [0.021, 0.275], [0.014, 0.305], [0.018, 0.32], [0, 0.33],
  ];
  for (const x of [-X, X]) {
    a.add('front-leg', P.lathe({ profile: turned, segments: 16 }), { position: [x, 0, zF] });
    a.add('block', P.bevelBox({ size: [0.04, 0.07, 0.04], bevel: 0.003 }), { position: [x, 0.062, zF] });
    a.add('block', P.bevelBox({ size: [0.045, 0.105, 0.045], bevel: 0.003 }), { position: [x, 0.325, zF] });
  }

  // Back legs: one curved square-section sweep from the floor up to the finial.
  const backPath = (x) => [[x, 0, -0.245], [x, 0.2, -0.222], [x, 0.37, -0.202], [x, 0.47, -0.205], [x, 0.65, -0.232], [x, 0.8, -0.26], [x, 0.915, -0.282]];
  const square = [[-0.018, -0.022], [0.018, -0.022], [0.018, 0.022], [-0.018, 0.022]];
  const finial = [[0, 0], [0.011, 0], [0.012, 0.012], [0.009, 0.02], [0.016, 0.028], [0.021, 0.042], [0.017, 0.058], [0.008, 0.065], [0, 0.066]];
  const floor = P.bevelBox({ size: [1, 1, 1], bevel: 0 }); // keeps y >= 0: the swept end cap dips 3 mm
  for (const x of [-X, X]) {
    a.add('back-leg', P.csg(P.sweep({ path: backPath(x), profile: square, segments: 28 }), 'intersect', floor));
    a.add('finial', P.lathe({ profile: finial, segments: 16 }), { position: [x, 0.912, -0.282] });
  }

  // Seat frame: scalloped side and front aprons, straight back apron.
  const scallop = (len, n = 24) => Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, s = Math.sin(t * Math.PI);
    return [t, 0.018 * s + 0.008 * Math.sin(t * Math.PI * 3) * s];
  });
  const sideShape = [
    [zF - 0.02, seatY], [-0.2, seatY],
    ...scallop().map(([t, h]) => [-0.2 + t * (zF - 0.02 + 0.2), seatY - apronH + h]),
  ];
  for (const x of [-X, X]) {
    a.add('apron', P.transform(P.extrude({ shape: sideShape.map(([z, y]) => [-z, y]), depth: 0.02, bevel: 0.0015 }), { position: [x - Math.sign(x) * 0.005, 0, 0], rotation: [0, 90, 0] }));
  }
  const frontShape = [[X - 0.02, seatY], [-(X - 0.02), seatY], ...scallop().map(([t, h]) => [-(X - 0.02) + t * 2 * (X - 0.02), seatY - apronH + h])];
  a.add('apron', P.extrude({ shape: frontShape, depth: 0.02, bevel: 0.0015 }), { position: [0, 0, zF - 0.005] });
  a.add('apron', P.bevelBox({ size: [2 * X - 0.03, apronH, 0.02], bevel: 0.0015 }), { position: [0, seatY - apronH, -0.2] });

  // Stretchers: one per side near the floor and an H cross-bar.
  for (const x of [-X, X]) a.add('stretcher', P.bevelBox({ size: [0.022, 0.028, 0.46], bevel: 0.002 }), { position: [x, 0.09, -0.005] });
  a.add('stretcher', P.bevelBox({ size: [2 * X, 0.024, 0.022], bevel: 0.002 }), { position: [0, 0.092, 0.01] });

  // Back: carved crest rail (arched top) and a low rail, both leaning with the posts.
  const crestTop = (x) => 0.9 + 0.018 * Math.cos((x / X) * Math.PI / 2);
  const crestShape = [...Array.from({ length: 13 }, (_, i) => { const x = -X + (i / 12) * 2 * X; return [x, crestTop(x)]; }).reverse(), [-X, 0.845], [X, 0.845]];
  // Lean a piece around its own centre at height y; `absolute` pieces are drawn at their final height.
  const leanAt = (g, y, z, absolute = false) => P.transform(absolute ? P.transform(g, { position: [0, -y, 0] }) : g, { position: [0, y, z], rotation: [lean, 0, 0] });
  a.add('crest', leanAt(P.extrude({ shape: crestShape, depth: 0.022, bevel: 0.002 }), 0.87, -0.272, true));
  a.add('crest', leanAt(P.bevelBox({ size: [2 * X - 0.03, 0.04, 0.02], bevel: 0.002, origin: 'center' }), 0.5, -0.21));

  // Upholstery: rounded seat cushion and back pad (velvet).
  a.add('seat', P.bevelBox({ size: [2 * X + 0.045, 0.08, 0.48], bevel: 0.036, segments: 4 }), { position: [0, seatY - 0.008, 0.022] });
  a.add('back-pad', leanAt(P.bevelBox({ size: [2 * X - 0.06, 0.33, 0.05], bevel: 0.02, segments: 4, origin: 'center' }), 0.68, -0.232));
  return a.build();
}
