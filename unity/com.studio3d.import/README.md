# 3D Studio Import (Unity)

Pacote de editor para os pacotes gerados pelo `studio3d export` (`dist/<nome>/`).

## Instalação

Package Manager → **Add package from disk…** → `unity/com.studio3d.import/package.json`, ou no `Packages/manifest.json`:

```json
"com.studio3d.import": "file:C:/Users/TiagoXavier/www/projects/3D Studio/unity/com.studio3d.import"
```

Para GLB, instale também o **glTFast** (`com.unity.cloud.gltfast`).

## Uso

- **FBX:** copie a pasta `dist/<nome>/` para `Assets/`. No import, o pacote mantém o UV1 do studio3d (sem gerar lightmap UV), usa tangentes MikkTSpace e monta o `LODGroup` (`_LOD0`…`_LOD2`) e um `MeshCollider` convexo a partir do `_col`.
- **GLB (glTFast):** selecione o modelo e use **Assets → 3D Studio → Create Prefab (LODs + Collider)**. Isso cria `<nome>.prefab` ao lado do modelo.

A pasta só é tratada como pacote do 3D Studio quando o `report.json` está ao lado do FBX.
