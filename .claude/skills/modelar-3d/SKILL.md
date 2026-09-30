---
name: modelar-3d
description: Gera um modelo 3D game-ready (GLB com UV0/UV1, validado) a partir de imagens de referência e/ou prompt, modelando em código Three.js com a biblioteca do 3D Studio e refinando por comparação visual. Use quando o usuário pedir para modelar, gerar ou criar um asset/prop/modelo 3D, ou invocar /modelar-3d.
---

# /modelar-3d

Fluxo fixo do 3D Studio (spec: `3D Studio - Spec & Roadmap.md`). Rode tudo a partir da raiz do projeto (`www/projects/3D Studio`). Sempre as mesmas etapas, na ordem.

## 1. Referência

1. Escolha um nome em kebab-case e rode `node cli/studio3d.js new <nome>`.
2. Copie as imagens de referência para `assets/<nome>/ref/` e liste-as em `asset.json → reference.images` (caminhos relativos a `ref/`).
3. Registre em `ref/prompt.md` o prompt, as medidas conhecidas e as observações do usuário.
4. Sem medidas reais, estime pela referência e por objetos de escala conhecida (porta ≈ 2,1 m, assento ≈ 0,45 m, tampo de mesa ≈ 0,75 m) e anote a estimativa no `prompt.md`.

## 2. Blueprint (`asset.json`)

Olhe as referências e decomponha o objeto antes de escrever código:

- `style`: `pbr` (realista) ou `lowpoly`. Os dois estilos são de primeira classe; pergunte ao usuário se não estiver claro. O gerador pode ler `bp.style` para servir aos dois (veja `assets/banco-madeira/asset.js` e `banco-madeira-lp`, que reusa o mesmo gerador).
- `category`: `prop-small` | `prop-medium` | `prop-hero` | `architecture` | `lowpoly` (define o orçamento de triângulos e a densidade de texel).
- `dimensions`: bounding box final em metros. O validate exige ±2%.
- `parts`: uma entrada por peça lógica, com `material` e as flags (`hidden` para faces nunca vistas, `stack`/`mirror` para instâncias que compartilham UV, `tiling` para superfícies repetidas).
- `materials`: cor `#rrggbb` lida da referência, `roughness` e `metalness` (metal = 1, pintura e plástico entre 0 e 0,2, madeira 0).
  - **PBR:** `wear` (0 a 1) no `painted-metal` gera lascas nas bordas, riscos e sujeira nas frestas; `emissive: "#rrggbb"` para olhos e LEDs. `preset` define o bake procedural: `wood`, `painted-metal`, `bare-metal`, `plastic`, `rubber`, `concrete`, `fabric` ou `solid` (sem preset, ele é deduzido do id/nome do material). Na peça, `grain: "x"|"y"|"z"` orienta o veio da madeira ou a escovação do metal (padrão: eixo mais longo da peça).
  - **Low-poly:** cada material vira uma célula de `T_<Nome>_Palette`; `gradient: "#rrggbb"` cria um gradiente vertical (base = `color`, topo = `gradient`).
- `reference.cameras` (quando há foto): uma câmera por imagem, `{ "frente.jpg": { "position": [x,y,z], "target": [x,y,z], "fov": 28 } }`, estimada para reproduzir o enquadramento da foto. Cada uma gera a vista `ref-<imagem>_*`, colocada ao lado da foto na `sheet.png`: são as vistas mais importantes na comparação.
- Referências da internet: prefira o Wikimedia Commons (licença livre, URL direta), salve os recortes em `ref/` e registre autor e licença em `ref/SOURCES.md`.

O schema completo está em `lib/core/blueprint.js` (`BLUEPRINT_SCHEMA_DOC`).

## 3. Modelagem (`asset.js`)

Escreva o gerador usando **apenas** a biblioteca `parts`. Leia `lib/parts/README.md` antes da primeira vez na sessão. Regras:

- Pivot no centro da base (y = 0) e frente em +Z.
- Chanfro de 2 a 5 mm nas arestas visíveis (exceto low-poly).
- Low-poly: sem chanfros, poucos segmentos (5 a 8 em cilindros; use 8 lados com vértice nos eixos quando o bbox precisar bater) e normais facetadas automáticas.
- Proporções derivadas de `bp.dimensions`, não de números soltos, para ajustes rápidos.
- Comente só o que não for óbvio (por exemplo, de onde veio uma medida).

## 4 e 5. Render e comparação (ciclo, máximo de 5 iterações)

```
node cli/studio3d.js render <nome>
```

Isso gera `iterations/NN/` e um `sheet.png` com as referências ao lado das vistas front, right, top, iso (e `reference`, se houver câmera). **Leia só o `sheet.png`**, não as imagens soltas, para economizar tokens.

Compare e preencha o checklist fixo de cada vista, com 0 a 2 pontos por critério (nota da vista = soma, 0 a 10):

| Critério | 2 | 1 | 0 |
| --- | --- | --- | --- |
| `silhueta` | contorno igual | pequenas diferenças | forma diferente |
| `proporcoes` | medidas relativas batem | alguma parte fora de proporção | proporções erradas |
| `partes` | todas as peças visíveis presentes | falta detalhe secundário | falta peça principal |
| `materiais` | cor, brilho e metal corretos | tom ou rugosidade diferente | material errado |
| `detalhes` | chanfros, furos e frisos presentes | detalhes simplificados | sem detalhes |

Liste as diferenças concretas (por exemplo: "encosto 20% mais alto que na referência"), corrija o `asset.json`/`asset.js` e renderize de novo. Pare quando todas as vistas tiverem nota ≥ 8 ou ao chegar na 5ª iteração. Nesse caso, registre as diferenças que restaram e avise o usuário.

Para detalhes que a folha não mostra (desgaste, sulcos), faça closes sem criar iteração: `node tools/closeup.mjs <nome> <saida.png> x,y,z tx,ty,tz fov`.

Grave a avaliação final em `assets/<nome>/review.json`:

```json
{
  "iteration": 3,
  "checklist": {
    "reference": { "silhueta": 2, "proporcoes": 2, "partes": 2, "materiais": 1, "detalhes": 2 },
    "front":     { "silhueta": 2, "proporcoes": 2, "partes": 2, "materiais": 2, "detalhes": 1 },
    "right":     { "...": 0 },
    "top":       { "...": 0 },
    "iso":       { "...": 0 }
  },
  "differences": ["o que ainda difere da referência"],
  "notes": "decisões e estimativas relevantes"
}
```

Sem imagem de referência (só prompt), avalie contra a descrição do prompt e omita a vista `reference`.

## 6 a 8. UV, materiais e validação

```
node cli/studio3d.js validate <nome>
```

UV0/UV1 e texturas são gerados automaticamente: PBR faz o bake de `T_<Nome>_BaseColor`/`Normal`/`ORM` (10 a 20 s por asset), e o low-poly gera a paleta. O comando grava `out/report.json`, `out/textures/` e os layouts em `debug/uv0.png`/`uv1.png`. Corrija toda falha bloqueante (✘) antes de seguir:

- **Malha** (peça não watertight): contorno com auto-interseção, furo sem sentido oposto ou CSG de entradas abertas.
- **Dimensões**: ajuste o `asset.js` ou o `asset.json` (se a medida do blueprint estiver errada, corrija a medida e anote no `prompt.md`).
- **Triângulos acima do orçamento**: menos `segments`/`curveSegments`, ou outra categoria se o asset for maior.
- **Overlap ou padding**: normalmente só com `stack`/`mirror` mal declarados.

Os alertas (!) não bloqueiam, mas cite no resumo os relevantes. Para ver o checker de UV, rode `node cli/studio3d.js render <nome> --mode checker --views front,iso`: os quadrados precisam ficar quadrados e do mesmo tamanho.

## 9. Export

```
node cli/studio3d.js export <nome>
```

O export só roda com `readyToExport` (todos os checks bloqueantes ok e `review.json` presente). Ele grava `out/preview.png`, monta o pacote em `dist/<nome>/` (GLB, FBX, OBJ+MTL, texturas, preview, report) + `dist/<nome>.zip` e relê o FBX e o OBJ com o assimp: se triângulos ou bbox não baterem com o GLB, o export falha.

LODs (`_LOD1`, `_LOD2` a 50% e 25%) e o colisor (`_col`, casco convexo) são gerados no build. No blueprint: `lods: [0.5, 0.25] | false`, `collision: "hull" | "box" | false`, e `decal: true` nas peças finas coladas na superfície (rótulos, adesivos), que os LODs não simplificam. A ferramenta nunca escreve em projetos de engine: o usuário copia o pacote. Nunca use `--force` sem o usuário pedir.

## Resumo para o usuário

Ao final, informe: iterações usadas, nota por vista, triângulos, resolução e densidade de texel, alertas relevantes, diferenças que restaram e o caminho do pacote exportado.
