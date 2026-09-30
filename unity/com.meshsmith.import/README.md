# Meshsmith Import (Unity)

An editor package for the packages `meshsmith export` produces (`dist/<name>/`).

## Installation

Package Manager → **Add package from disk…** → `unity/com.meshsmith.import/package.json`, or in `Packages/manifest.json`:

```json
"com.meshsmith.import": "file:<project path>/unity/com.meshsmith.import"
```

For GLB, also install **glTFast** (`com.unity.cloud.gltfast`).

## Usage

- **FBX:** copy the `dist/<name>/` folder into `Assets/`. On import, the package keeps meshsmith's UV1 (without generating lightmap UVs), uses MikkTSpace tangents and assembles the `LODGroup` (`_LOD0`…`_LOD2`) plus a convex `MeshCollider` from `_col`.
- **GLB (glTFast):** select the model and use **Assets → Meshsmith → Create Prefab (LODs + Collider)**. That creates `<name>.prefab` next to the model.

A folder is only treated as a Meshsmith package when `report.json` sits next to the FBX.
