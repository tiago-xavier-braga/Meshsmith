// 9 L water extinguisher. Scale taken from the photo: Ø18 cm body = 300 px (0.6 mm/px).
// Lathed body, label as a thin layer ∩ front prism, swept hose.
export default function build(bp, { parts: P, materials }) {
  const R = 0.09, top = 0.483;
  const a = P.assembly(bp, materials);

  // Body: flat foot ring, straight wall, elliptical shoulder up to the neck.
  const shoulder = Array.from({ length: 8 }, (_, i) => {
    const t = ((i + 1) / 8) * (Math.PI / 2);
    return [0.021 + (R - 0.021) * Math.cos(t), 0.41 + (top - 0.41) * Math.sin(t)];
  });
  const bodyProfile = [[0, 0.012], [0.07, 0.012], [0.078, 0], [0.086, 0.003], [R, 0.02], [R, 0.41], ...shoulder, [0, top]];
  a.add('body', P.lathe({ profile: bodyProfile, segments: 40 }));

  // Label: 0.8 mm layer of the wall, cut by a front prism (x ±7.5 cm, y 6.6–33.3 cm).
  const wall = (r) => P.cylinder({ radius: r, height: 0.4, segments: 40, bevel: 0 });
  const labelPrism = P.transform(P.extrude({ shape: P.roundedRect(0.15, 0.267, 0.004), depth: 0.3, bevel: 0 }), { position: [0, 0.1995, 0.17] });
  a.add('label', P.csg(P.csg(labelPrism, 'intersect', wall(R + 0.0008)), 'subtract', wall(R - 0.002)));

  // Valve: collar, body and outlet stub on the hose side.
  a.add('valve', P.cylinder({ radius: 0.022, height: 0.018, segments: 20, bevel: 0.0015 }), { position: [0, top - 0.004, 0] });
  a.add('valve', P.bevelBox({ size: [0.032, 0.05, 0.032], bevel: 0.003 }), { position: [0, top + 0.012, 0] });
  a.add('valve', P.cylinder({ radius: 0.009, height: 0.03, segments: 14, bevel: 0.001 }), { position: [-0.012, top + 0.022, 0], rotation: [0, 0, 90] });

  // Levers (top: squeeze lever, bottom: carry handle), drawn side-on and extruded 2.4 cm.
  const lever = (pts) => P.extrude({ shape: pts, depth: 0.024, bevel: 0.002 });
  a.add('lever', lever([[0.008, 0.078], [0.08, 0.1], [0.085, 0.092], [0.012, 0.066]]), { position: [0, top, 0] });
  a.add('lever', lever([[0.012, 0.028], [0.111, 0.034], [0.112, 0.024], [0.014, 0.017]]), { position: [0, top, 0] });

  // Pressure gauge facing the front.
  a.add('gauge', P.cylinder({ radius: 0.012, height: 0.008, segments: 20, bevel: 0.0015 }), { position: [-0.004, top + 0.02, 0.016], rotation: [90, 0, 0] });

  // Hose: arc over the top from the outlet to the nozzle held by the lever (photo trace).
  const path = [
    [-0.027, 0.505, 0], [-0.105, 0.497, 0.012], [-0.195, 0.52, 0.02], [-0.232, 0.597, 0.022], [-0.218, 0.668, 0.022],
    [-0.165, 0.7, 0.02], [-0.087, 0.698, 0.018], [-0.016, 0.657, 0.014], [0.033, 0.618, 0.01], [0.058, 0.6, 0.008],
  ];
  a.add('hose', P.sweep({ path, radius: 0.0095, radialSegments: 12, segments: 64 }));
  // Ferrules at both ends, along the end tangents.
  const ferrule = (p, q) => {
    const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], l = Math.hypot(...d);
    return P.sweep({ path: [p, [p[0] + (d[0] / l) * 0.03, p[1] + (d[1] / l) * 0.03, p[2] + (d[2] / l) * 0.03]], radius: 0.0115, radialSegments: 14, segments: 2, curve: 'polyline' });
  };
  a.add('ferrule', ferrule(path[0], path[1]));
  a.add('ferrule', ferrule(path[path.length - 1], path[path.length - 2]));
  return a.build();
}
