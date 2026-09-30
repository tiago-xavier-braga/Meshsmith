# Meshsmith Import (Unity)

Pacote de editor para os pacotes gerados pelo `meshsmith export` (`dist/<nome>/`).

## Instalação

Package Manager → **Add package from disk…** → `unity/com.meshsmith.import/package.json`, ou no `Packages/manifest.json`:

```json
"com.meshsmith.import": "file:<caminho do projeto>/unity/com.meshsmith.import"
```

Para GLB, instale também o **glTFast** (`com.unity.cloud.gltfast`).

## Uso

- **FBX:** copie a pasta `dist/<nome>/` para `Assets/`. No import, o pacote mantém o UV1 do meshsmith (sem gerar lightmap UV), usa tangentes MikkTSpace e monta o `LODGroup` (`_LOD0`…`_LOD2`) e um `MeshCollider` convexo a partir do `_col`.
- **GLB (glTFast):** selecione o modelo e use **Assets → Meshsmith → Create Prefab (LODs + Collider)**. Isso cria `<nome>.prefab` ao lado do modelo.

A pasta só é tratada como pacote do Meshsmith quando o `report.json` está ao lado do FBX.
