# Biblioteca de peças (`parts`)

O `asset.js` recebe `(bp, { THREE, parts: P, materials })` e devolve `P.assembly(...).build()`.
Unidades em metros, Y para cima, frente em +Z, pivot no centro da base (y = 0).

## Montagem

```js
export default function build(bp, { parts: P, materials }) {
  const a = P.assembly(bp, materials);
  a.add('tampo', P.bevelBox({ size: [1.2, 0.03, 0.6] }), { position: [0, 0.72, 0] });
  for (const x of [-0.55, 0.55]) for (const z of [-0.25, 0.25])
    a.add('perna', P.cylinder({ radius: 0.02, height: 0.72 }), { position: [x, 0, z] });
  return a.build();
}
```

- `a.add(id, geometria, { position, rotation (graus XYZ), scale })`: `id` precisa existir em `asset.json → parts`. Repita o id para instâncias (4 pernas = 4 `add('perna', ...)`).
- O material, as flags (`hidden`, `stack`, `mirror`, `tiling`) e o `smoothingAngle` vêm do blueprint.
- Toda peça declarada precisa ser adicionada pelo menos uma vez.
- Toda peça é soldada, orientada para fora e recebe normais ponderadas por área, divididas por ângulo (padrão de 50°; `0` = facetado, estilo low-poly).

## Primitivas

| Função | Parâmetros | Observações |
| --- | --- | --- |
| `bevelBox` | `{ size: [x,y,z], bevel = 0.003, segments = 1, origin = 'base' }` | `segments` 1 = chanfro de 45°, >1 = arredondado. `origin: 'center'` centraliza em Y |
| `cylinder` | `{ radius, height, segments = 24, bevel = 0.003, radiusTop }` | Base em y = 0; `radiusTop` gera tronco de cone |
| `lathe` | `{ profile: [[r, y], ...], segments = 24, phiStart, phiLength }` | Perfil de baixo para cima; r = 0 nas pontas vira tampa plana |
| `extrude` | `{ shape: [[x,y],...], holes: [[[x,y],...]], depth, bevel = 0.002, bevelSegments = 1, curveSegments = 12 }` | Contorno no plano XY, extrudado em Z e centrado em Z. Furos em sentido oposto ao contorno |
| `sweep` | `{ path: [[x,y,z],...], profile?: [[x,y],...], radius = 0.01, radialSegments = 12, segments = 32, closed = false, curve = 'catmullrom' \| 'polyline' }` | Tubos, alças, aros e molduras; as pontas são tampadas se o caminho for aberto |
| `roundedRect(w, h, r, steps = 4)` | contorno 2D | Para `extrude` (tábuas, placas, furos oblongos) |
| `circle(r, steps = 24, cx, cy)` | contorno 2D | Furos redondos em `extrude` |

## Operações

| Função | Uso |
| --- | --- |
| `transform(geo, { position, rotation, scale })` | Cópia transformada; escala negativa corrige o winding |
| `mirror(geo, 'x' \| 'y' \| 'z')` | Espelha pelo plano da origem |
| `csg(base, 'subtract' \| 'add' \| 'intersect', ...outros)` | Booleanas com manifold-3d (saída sempre watertight). Prefira `extrude` com `holes` para furos em chapas planas: a topologia fica mais limpa |

## Dicas de modelagem

- Chanfre toda aresta visível (2 a 5 mm), a não ser no estilo low-poly facetado.
- Peças que se tocam podem se interpenetrar; o manifold é checado por peça.
- Faces nunca vistas (fundo no chão) vão numa peça com `"hidden": true` e recebem 25% da densidade de texel.
- Instâncias idênticas (4 pés, parafusos) podem usar `"stack": true` e compartilhar UV. Cópias espelhadas usam `"mirror": true`.
- Superfícies com textura repetida (piso, parede) usam `"tiling": <metros por repetição>`.
