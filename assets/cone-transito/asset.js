// Cone de trânsito 28" (low-poly): base quadrada extrudada, corpo em loft com o topo lascado,
// faixas refletivas como luvas finas sobre o corpo.
export default function build(bp, { parts: P, materials }) {
  const H = bp.dimensions.y, S = bp.dimensions.x, baseT = 0.03;
  const r0 = 0.125, r1 = 0.045, SEG = 10; // top radius where it broke off (photo: 0,55 mm/px)
  const a = P.assembly(bp, materials);

  const base = P.extrude({ shape: P.roundedRect(S, S, 0.045, 2), depth: baseT, bevel: 0, curveSegments: 2 });
  a.add('base', base, { position: [0, baseT / 2, 0], rotation: [-90, 0, 0] });

  // Body radius falls linearly; the last ring is broken off at uneven heights.
  const radius = (y) => r0 + (r1 - r0) * (y - baseT) / (H - baseT);
  const ring = (y, dr = 0, jag = null) => Array.from({ length: SEG }, (_, i) => {
    const t = (i / SEG) * Math.PI * 2, r = radius(y) + dr;
    return [Math.sin(t) * r, jag ? y - jag[i] : y, Math.cos(t) * r];
  });
  const jag = [0, 0.018, 0.006, 0.024, 0.01, 0, 0.02, 0.004, 0.015, 0.008];
  a.add('cone', P.loft({ sections: [ring(baseT - 0.002), ring(H * 0.5), ring(H, 0, jag)] }));

  // Reflective sleeves: 4 mm proud of the body.
  const sleeve = (y0, y1) => P.loft({ sections: [ring(y0, 0.004), ring(y1, 0.004)] });
  a.add('band', sleeve(0.35, 0.445));
  a.add('band', sleeve(0.495, 0.645));
  return a.build();
}
