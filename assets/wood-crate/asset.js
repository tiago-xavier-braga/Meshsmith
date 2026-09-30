// Wooden crate: 4 corner posts, 3 gapped boards per side, lid and base.
export default function build(bp, { parts: P, materials }) {
  const S = bp.dimensions.x;          // 0.6 m
  const post = 0.05, t = 0.02, gap = 0.012, lidT = 0.02;
  const inner = S - 2 * lidT;          // height available for the side planks
  const plankH = (inner - 2 * gap) / 3;
  const span = S - 2 * post;           // plank length between posts
  const a = P.assembly(bp, materials);

  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    a.add('post', P.bevelBox({ size: [post, S, post], bevel: 0.004 }), {
      position: [x * (S / 2 - post / 2), 0, z * (S / 2 - post / 2)],
    });
  }

  // Front/back planks run along X; left/right along Z and the middle one has the handle.
  // Handle plank: outline with a rounded slot, extruded (clean topology, no CSG slivers).
  const handlePlank = P.extrude({
    shape: P.roundedRect(span, plankH, 0.002, 1),
    holes: [P.roundedRect(0.18, 0.055, 0.025, 6).reverse()],
    depth: t,
    bevel: 0.003,
  });
  for (let i = 0; i < 3; i++) {
    const y = lidT + i * (plankH + gap);
    for (const s of [-1, 1]) {
      a.add('plank', P.bevelBox({ size: [span, plankH, t], bevel: 0.003 }), {
        position: [0, y, s * (S / 2 - t / 2 - 0.004)],
      });
      const side = P.bevelBox({ size: [t, plankH, span], bevel: 0.003 });
      if (i === 1) {
        a.add('plank-handle', handlePlank, { position: [s * (S / 2 - t / 2 - 0.004), y + plankH / 2, 0], rotation: [0, 90, 0] });
      } else {
        a.add('plank', side, { position: [s * (S / 2 - t / 2 - 0.004), y, 0] });
      }
    }
  }

  // Lid and bottom: 4 boards along X spanning the full width.
  const boardW = (S - 3 * 0.006) / 4;
  for (let i = 0; i < 4; i++) {
    const z = -S / 2 + boardW / 2 + i * (boardW + 0.006);
    a.add('lid', P.bevelBox({ size: [S, lidT, boardW], bevel: 0.003 }), { position: [0, S - lidT, z] });
    a.add('bottom', P.bevelBox({ size: [S, lidT, boardW], bevel: 0.002 }), { position: [0, 0, z] });
  }
  return a.build();
}
