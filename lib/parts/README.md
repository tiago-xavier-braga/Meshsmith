# Part library (`parts`)

`asset.js` receives `(bp, { THREE, parts: P, materials })` and returns `P.assembly(...).build()`.
Units in metres, Y up, front towards +Z, pivot at the centre of the base (y = 0).

## Assembly

```js
export default function build(bp, { parts: P, materials }) {
  const a = P.assembly(bp, materials);
  a.add('top', P.bevelBox({ size: [1.2, 0.03, 0.6] }), { position: [0, 0.72, 0] });
  for (const x of [-0.55, 0.55]) for (const z of [-0.25, 0.25])
    a.add('leg', P.cylinder({ radius: 0.02, height: 0.72 }), { position: [x, 0, z] });
  return a.build();
}
```

- `a.add(id, geometry, { position, rotation (degrees XYZ), scale })`: `id` must exist in `asset.json → parts`. Repeat the id for instances (4 legs = 4 `add('leg', ...)`).
- `a.socket(name, [x,y,z], [rx,ry,rz])`: snap point `SOCKET_<name>` (an empty node in the GLB and the FBX); the socket's +Z points out of the module.
- `a.build({ translate: [x,y,z] })`: shifts everything (to bring the pivot to the centre of the base, for instance).
- The material, the flags (`hidden`, `stack`, `mirror`, `tiling`) and `smoothingAngle` come from the blueprint.
- Every declared part must be added at least once.
- Every part is welded, oriented outwards and given area-weighted normals, split by angle (50° by default; `0` = faceted, low-poly style).

## Primitives

| Function | Parameters | Notes |
| --- | --- | --- |
| `bevelBox` | `{ size: [x,y,z], bevel = 0.003, segments = 1, origin = 'base' }` | `segments` 1 = 45° chamfer, >1 = rounded. `origin: 'center'` centres it in Y |
| `cylinder` | `{ radius, height, segments = 24, bevel = 0.003, radiusTop }` | Base at y = 0; `radiusTop` gives a truncated cone |
| `lathe` | `{ profile: [[r, y], ...], segments = 24, phiStart, phiLength }` | Profile from bottom to top; r = 0 at the ends becomes a flat cap |
| `loft` | `{ sections: [[[x,y,z], ...], ...], capStart = true, capEnd = true }` | Closed sections with the same number of points; shells, helmets, hulls, bottles |
| `superellipse` | `{ y, a, front, back = front, n = 2, segments = 48, cx, cz }` | A section for `loft` on the XZ plane: half-width `a`, front/back half-depth, `n` > 2 is more square |
| `extrude` | `{ shape: [[x,y],...], holes: [[[x,y],...]], depth, bevel = 0.002, bevelSegments = 1, curveSegments = 12 }` | Outline on the XY plane, extruded in Z and centred in Z. Holes wind opposite to the outline |
| `sweep` | `{ path: [[x,y,z],...], profile?: [[x,y],...], radius = 0.01, radialSegments = 12, segments = 32, closed = false, curve = 'catmullrom' \| 'polyline' }` | Tubes, handles, hoops and mouldings; the ends are capped when the path is open |
| `roundedRect(w, h, r, steps = 4)` | 2D outline | For `extrude` (boards, plates, slotted holes) |
| `circle(r, steps = 24, cx, cy)` | 2D outline | Round holes in `extrude` |

## Operations

| Function | Use |
| --- | --- |
| `transform(geo, { position, rotation, scale })` | A transformed copy; a negative scale fixes the winding |
| `mirror(geo, 'x' \| 'y' \| 'z')` | Mirrors across the plane through the origin |
| `csg(base, 'subtract' \| 'add' \| 'intersect', ...others)` | Booleans with manifold-3d (the output is always watertight). Prefer `extrude` with `holes` for holes in flat plates: the topology comes out cleaner |

## Plates on curved surfaces

For masks, panels and plates that follow a shell, cut a **layer** out of the shell with a **prism** of the outline seen from the front or the side:

```js
const shell = (off) => P.loft({ sections: /* superellipses with a+off, front+off, back+off */ });
const layer = { outer: shell(0.004), inner: shell(-0.004) };
const prism = P.transform(P.extrude({ shape: frontOutline, holes: [rightEye, leftEye], depth: 0.3, bevel: 0 }), { position: [0, 0, 0.17] });
const plate = P.csg(P.csg(prism, 'intersect', layer.outer), 'subtract', layer.inner);
```

Grooves (a mouth, panel gaps) are thin prisms subtracted from the plate.

## Modelling tips

- Chamfer every visible edge (2 to 5 mm), except in the faceted low-poly style.
- Parts that touch may interpenetrate; the manifold is checked per part.
- Faces that are never seen (the bottom on the floor) go in a part with `"hidden": true` and get 25% of the texel density.
- Identical instances (4 feet, screws) can use `"stack": true` and share UVs. Mirrored copies use `"mirror": true`.
- Surfaces with a repeating texture (floor, wall) use `"tiling": <metres per repeat>`: the material gets its own seamless tile (`T_<Name>_<Material>_*`), with UVs in world scale. A material is either tiled or part of the atlas, never both.
- Modular kits: `category: "architecture"`, `pivot: "grid-corner"` and `grid: [x, y, z]`. The dimensions must be multiples of the grid. See `lib/kits/common.js` and `assets/kit-*`; `node tools/kit-scene.mjs <output.glb> <layout.json>` assembles the modules so the fit can be checked.
