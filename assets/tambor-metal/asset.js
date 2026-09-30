// Tambor 200 L: corpo em lathe (tampa/fundo rebaixados e frisos), anéis em sweep, bujões.
export default function build(bp, { parts: P, materials }) {
  const R = bp.dimensions.x / 2 - 0.006; // shell radius; chimes stick out 6 mm
  const H = bp.dimensions.y;
  const a = P.assembly(bp, materials);

  a.add('body', P.lathe({
    segments: 40,
    profile: [
      [0, 0.012], [R - 0.012, 0.012], [R - 0.008, 0.002], [R + 0.004, 0], [R + 0.006, 0.012],
      [R + 0.002, 0.024], [R, 0.03], [R, H - 0.03], [R + 0.002, H - 0.024], [R + 0.006, H - 0.012],
      [R + 0.004, H], [R - 0.008, H - 0.002], [R - 0.012, H - 0.012], [0, H - 0.012],
    ],
  }));

  // Rolling hoops at 1/3 and 2/3 of the height: a closed circular path swept with a round profile.
  const ring = (y) => Array.from({ length: 40 }, (_, i) => {
    const t = (i / 40) * Math.PI * 2;
    return [Math.sin(t) * R, y, Math.cos(t) * R];
  });
  for (const y of [H * 0.34, H * 0.66]) {
    a.add('hoop', P.sweep({ path: ring(y), closed: true, radius: 0.007, radialSegments: 8, segments: 40 }));
  }

  // Bungs (2" and 3/4") on the recessed lid.
  a.add('bung', P.cylinder({ radius: 0.03, height: 0.012, segments: 16, bevel: 0.002 }), { position: [0.17, H - 0.013, 0] });
  a.add('bung', P.cylinder({ radius: 0.018, height: 0.012, segments: 12, bevel: 0.002 }), { position: [-0.19, H - 0.013, 0] });
  return a.build();
}
