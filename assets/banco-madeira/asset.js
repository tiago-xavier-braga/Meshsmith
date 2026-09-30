// Banquinho de 3 pernas: assento em lathe (borda arredondada), pernas cônicas inclinadas, anel em sweep.
export default function build(bp, { parts: P, materials }) {
  const H = bp.dimensions.y;
  const seatR = 0.16, seatT = 0.03, edge = 0.008;
  const splay = 8;                                   // degrees, outwards
  const footR = bp.dimensions.x / 2 - 0.016;         // foot circle radius (leg centre)
  const legLen = (H - seatT) / Math.cos((splay * Math.PI) / 180);
  const a = P.assembly(bp, materials);

  // Seat: flat bottom, rounded top rim (quarter circle of radius `edge`).
  const rim = Array.from({ length: 5 }, (_, i) => {
    const t = (i / 4) * (Math.PI / 2);
    return [seatR - edge + Math.cos(t) * edge, H - edge + Math.sin(t) * edge];
  });
  a.add('seat', P.lathe({ segments: 48, profile: [[0, H - seatT], [seatR - 0.002, H - seatT], [seatR, H - seatT + 0.002], ...rim, [0, H]] }));

  // Legs: tapered cylinders tilted outwards; the top sits under the seat.
  // Floor slab used to cut the tilted feet flat (they would dip ~2 mm below y = 0).
  const keep = P.bevelBox({ size: [1, H, 1], bevel: 0 });
  for (const deg of [0, 120, 240]) {
    const r = (deg * Math.PI) / 180;
    const leg = P.cylinder({ radius: 0.016, radiusTop: 0.012, height: legLen, segments: 16, bevel: 0.002 });
    // Tilt the top inwards (towards -Z before the Y turn), then place the foot on the foot circle.
    const tilted = P.transform(leg, { rotation: [-splay, 0, 0] });
    const placed = P.transform(tilted, { position: [Math.sin(r) * footR, 0, Math.cos(r) * footR], rotation: [0, deg, 0] });
    a.add('leg', P.csg(placed, 'intersect', keep));
  }

  // Ring: closed circle linking the legs at 1/3 of the height.
  const yRing = H / 3;
  const ringR = footR - Math.tan((splay * Math.PI) / 180) * yRing;
  const path = Array.from({ length: 48 }, (_, i) => {
    const t = (i / 48) * Math.PI * 2;
    return [Math.sin(t) * ringR, yRing, Math.cos(t) * ringR];
  });
  a.add('ring', P.sweep({ path, closed: true, radius: 0.005, radialSegments: 8, segments: 48 }));
  return a.build();
}
