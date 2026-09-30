---
name: model-3d
description: Produces a game-ready 3D model (a validated GLB with UV0/UV1) from reference images and/or a prompt, modelling in Three.js code with the Meshsmith library and refining it by visual comparison. Use when the user asks to model, generate or create a 3D asset/prop/model, or invokes /model-3d.
---

# /model-3d

Meshsmith's fixed workflow (spec: `Meshsmith - Spec & Roadmap.md`). Run everything from the project root. Always the same steps, in order.

## 1. Reference

1. Pick a kebab-case name and run `node cli/meshsmith.js new <name>`.
2. Copy the reference images into `assets/<name>/ref/` and list them in `asset.json → reference.images` (paths relative to `ref/`).
3. Record the prompt, the known measurements and the user's notes in `ref/prompt.md`.
4. Without real measurements, estimate from the reference and from objects of known scale (a door ≈ 2.1 m, a seat ≈ 0.45 m, a table top ≈ 0.75 m) and write the estimate down in `prompt.md`.

## 2. Blueprint (`asset.json`)

Look at the references and break the object down before writing any code:

- `style`: `pbr` (realistic) or `lowpoly`. Both styles are first class; ask the user if it is not clear. The generator can read `bp.style` to serve both (see `assets/wood-stool/asset.js` and `wood-stool-lp`, which reuses the same generator).
- `category`: `prop-small` | `prop-medium` | `prop-hero` | `architecture` | `lowpoly` (sets the triangle budget and the texel density).
- `dimensions`: the final bounding box in metres. Validate requires ±2%.
- `parts`: one entry per logical part, with its `material` and flags (`hidden` for faces that are never seen, `stack`/`mirror` for instances that share UVs, `tiling` for repeating surfaces).
- `materials`: `#rrggbb` colour read off the reference, plus `roughness` and `metalness` (metal = 1, paint and plastic between 0 and 0.2, wood 0).
  - **PBR:** `wear` (0 to 1) on `painted-metal` gives edge chips, scratches and grime in the crevices; `emissive: "#rrggbb"` for eyes and LEDs. `preset` picks the procedural bake: `wood`, `painted-metal`, `bare-metal`, `plastic`, `rubber`, `concrete`, `fabric` or `solid` (with no preset it is guessed from the material's id/name). On the part, `grain: "x"|"y"|"z"` orients the wood grain or the brushing on metal (default: the part's longest axis).
  - **Low-poly:** each material becomes a cell of `T_<Name>_Palette`; `gradient: "#rrggbb"` creates a vertical gradient (base = `color`, top = `gradient`).
- `reference.cameras` (when there is a photo): one camera per image, `{ "front.jpg": { "position": [x,y,z], "target": [x,y,z], "fov": 28 } }`, estimated to reproduce the photo's framing. Each one produces the view `ref-<image>_*`, placed next to the photo in `sheet.png`: these are the most important views in the comparison.
- References from the internet: prefer Wikimedia Commons (free licence, direct URL), save the crops in `ref/` and record the author and licence in `ref/SOURCES.md`.

The full schema is in `lib/core/blueprint.js` (`BLUEPRINT_SCHEMA_DOC`).

## 3. Modelling (`asset.js`)

Write the generator using **only** the `parts` library. Read `lib/parts/README.md` before the first time in a session. Rules:

- Pivot at the centre of the base (y = 0) and front towards +Z.
- A 2 to 5 mm chamfer on visible edges (except low-poly).
- Low-poly: no chamfers, few segments (5 to 8 on cylinders; use 8 sides with a vertex on the axes when the bbox has to match) and automatic faceted normals.
- Derive proportions from `bp.dimensions`, not from loose numbers, so adjustments stay quick.
- Comment only what is not obvious (where a measurement came from, for instance).

## 4 and 5. Render and comparison (a loop, 5 iterations at most)

```
node cli/meshsmith.js render <name>
```

This produces `iterations/NN/` and a `sheet.png` with the references next to the front, right, top and iso views (plus `reference`, when there is a camera). **Read only the `sheet.png`**, not the loose images, to save tokens.

Compare and fill in the fixed checklist for each view, 0 to 2 points per criterion (a view's score = the sum, 0 to 10):

| Criterion | 2 | 1 | 0 |
| --- | --- | --- | --- |
| `silhouette` | the same outline | small differences | a different shape |
| `proportions` | relative measurements match | some part out of proportion | the proportions are wrong |
| `parts` | every visible part is there | a secondary detail is missing | a main part is missing |
| `materials` | colour, gloss and metal correct | a different tone or roughness | the wrong material |
| `details` | chamfers, holes and beads present | details simplified | no details |

List the concrete differences (for instance: "the back is 20% taller than in the reference"), fix `asset.json`/`asset.js` and render again. Stop when every view scores ≥ 8, or on reaching the 5th iteration. In that case, record the differences that remain and tell the user.

For details the sheet does not show (wear, grooves), take close-ups without creating an iteration: `node tools/closeup.mjs <name> <output.png> x,y,z tx,ty,tz fov`.

Write the final assessment to `assets/<name>/review.json`:

```json
{
  "iteration": 3,
  "checklist": {
    "reference": { "silhouette": 2, "proportions": 2, "parts": 2, "materials": 1, "details": 2 },
    "front":     { "silhouette": 2, "proportions": 2, "parts": 2, "materials": 2, "details": 1 },
    "right":     { "...": 0 },
    "top":       { "...": 0 },
    "iso":       { "...": 0 }
  },
  "differences": ["what still differs from the reference"],
  "notes": "relevant decisions and estimates"
}
```

With no reference image (prompt only), assess against the prompt's description and leave the `reference` view out.

## 6 to 8. UV, materials and validation

```
node cli/meshsmith.js validate <name>
```

UV0/UV1 and the textures are generated automatically: PBR bakes `T_<Name>_BaseColor`/`Normal`/`ORM` (10 to 20 s per asset), and low-poly generates the palette. The command writes `out/report.json`, `out/textures/` and the layouts in `debug/uv0.png`/`uv1.png`. Fix every blocking failure (✘) before moving on:

- **Mesh** (a part is not watertight): a self-intersecting outline, a hole without the opposite winding, or a CSG over open inputs.
- **Dimensions**: adjust `asset.js` or `asset.json` (when the blueprint's measurement is the wrong one, correct it and note it in `prompt.md`).
- **Triangles over budget**: fewer `segments`/`curveSegments`, or another category if the asset really is bigger.
- **Overlap or padding**: usually only happens with `stack`/`mirror` declared wrongly.

Warnings (!) do not block, but mention the relevant ones in the summary. To see the UV checker, run `node cli/meshsmith.js render <name> --mode checker --views front,iso`: the squares must stay square and all the same size.

## 9. Export

```
node cli/meshsmith.js export <name>
```

Export only runs with `readyToExport` (every blocking check ok and `review.json` present). It writes `out/preview.png`, assembles the package in `dist/<name>/` (GLB, FBX, OBJ+MTL, textures, preview, report) + `dist/<name>.zip` and re-reads the FBX and the OBJ with assimp: if the triangles or the bbox do not match the GLB, the export fails.

LODs (`_LOD1`, `_LOD2` at 50% and 25%) and the collider (`_col`, a convex hull) are generated during the build. In the blueprint: `lods: [0.5, 0.25] | false`, `collision: "hull" | "box" | false`, and `decal: true` on thin parts stuck to the surface (labels, stickers), which the LODs do not simplify. The tool never writes into engine projects: the user copies the package over. Never use `--force` unless the user asks for it.

## Batch

`node cli/meshsmith.js batch [asset ...] [--step validate|export]` runs several assets (all of `assets/` when none are given), each in its own process, and writes `dist/batch-report.md` and `.json`.

## Summary for the user

At the end, report: the iterations used, the score per view, the triangle count, the resolution and texel density, the relevant warnings, the differences that remain and the path to the exported package.
