# 3D Studio — Spec & Roadmap

Sep 28, 2026 · @Tiago Xavier

## Visão e objetivos

O 3D Studio gera modelos 3D prontos para jogo a partir de uma imagem ou de um prompt de referência. O Claude modela em código (Three.js), vê o próprio resultado e refina até ficar fiel à referência. Tudo roda localmente, com ferramentas gratuitas e sem APIs pagas além da licença do Claude.

Objetivos:

1. **Entrada flexível:** uma ou mais imagens de referência, um prompt de texto, ou os dois juntos.
2. **Saída game-ready:** malha limpa, UVs abertas seguindo as regras deste documento e materiais PBR.
3. **Multi-engine e independente:** a ferramenta é um projeto próprio, fora de qualquer engine. Ela gera um pacote padrão (GLB, FBX, OBJ) que importa sem ajustes no Unity, no Godot 4 e no Blender. O teste de import nas engines acontece só na última fase.
4. **Editável:** cada modelo é um arquivo de código versionável, que pode ser reaberto, ajustado e regenerado.
5. **Repetível:** o fluxo inteiro dispara com um comando (`/modelar-3d`) e sempre segue as mesmas etapas e validações.
6. **Dois estilos:** realista (PBR) e low-poly, escolhidos por asset no blueprint.

## Escopo

O sistema foca em assets hard-surface e estilizados, onde a modelagem por código gera resultados limpos e melhores que os de geradores de IA. Formas orgânicas realistas ficam fora da v1.

| Categoria | v1 | Observação |
| --- | --- | --- |
| Props e objetos (caixas, barris, ferramentas, eletrônicos) | Sim | Caso principal |
| Móveis e decoração | Sim | Caso principal |
| Arquitetura e kits modulares (paredes, portas, pisos) | Sim | Grid e snapping definidos no blueprint |
| Low-poly e estilizado | Sim | Paleta de cores ou atlas de gradiente |
| Peças técnicas e mecânicas | Sim | Precisão dimensional via blueprint |
| Veículos estilizados | Parcial | Carroceria simples; curvas complexas limitadas |
| Vegetação estilizada (árvores, rochas) | Parcial | Procedural com ruído |
| Personagens, rostos, animais realistas | Não | Possível na F6 com gerador local opcional |
| Rigging e animação | Não | Fora do escopo |
| Escultura e detalhe de alta frequência | Não | Simulado via normal map procedural |

Fidelidade esperada: forma, proporções e materiais fiéis à referência. Não é uma réplica fotogramétrica.

## Estilos visuais

Os dois estilos são predominantes e têm o mesmo peso. O blueprint escolhe um por asset (`"style": "pbr" | "lowpoly"`). O gerador pode ler `bp.style` para servir aos dois, e a mesma peça gera as duas versões mudando só o blueprint.

| Aspecto | Realista (PBR) | Low-poly |
| --- | --- | --- |
| Geometria | Chanfros de 2 a 5 mm, normais ponderadas e suavizadas até 50° | Facetada (normal por face), sem chanfros, orçamento da categoria `lowpoly` |
| UV0 | Ilhas únicas via xatlas, texel density da categoria | Paleta: cada face aponta para a célula da cor do seu material (overlap intencional) |
| Texturas | `BaseColor`, `Normal` (OpenGL) e `ORM`, bake procedural de 512² a 2048² | `T_<Nome>_Palette` de 256², sem normal map |
| Materiais | Presets procedurais: madeira, metal pintado, metal bruto, plástico, borracha, concreto, tecido | Cores chapadas da paleta, gradiente vertical opcional por material |
| AO | Bake por raycast no ORM | Não usa (o sombreamento facetado já dá a leitura de forma) |
| UV1 (lightmap) | xatlas | xatlas (igual ao PBR) |

## Arquitetura e pipeline

Cada asset passa por 9 etapas. As etapas 3 a 5 formam um ciclo: o Claude renderiza o modelo, compara-o com a referência e ajusta o código até as diferenças serem aceitáveis (máximo de 5 iterações por padrão).

```mermaid
flowchart LR
    A["1. Referência<br/>imagem, prompt ou ambos<br/>+ medidas, se houver"] --> B["2. Blueprint<br/>Claude lista partes,<br/>medidas e materiais (JSON)"]
    B --> C["3. Modelagem<br/>código Three.js com<br/>biblioteca de peças"]
    C --> D["4. Render<br/>4 vistas + câmera igual<br/>à da referência (headless)"]
    D --> E{"5. Comparação<br/>Claude compara render<br/>e referência, lista erros"}
    E -- ajustar --> C
    E -- ok --> F["6. UV unwrap<br/>xatlas + seams, padding<br/>e texel density"]
    F --> G["7. Materiais<br/>PBR e bake de texturas<br/>albedo, normal, ORM"]
    G --> H["8. Validação<br/>checks automáticos;<br/>se falhar, volta à etapa"]
    H --> I["9. Pacote<br/>GLB, FBX e OBJ<br/>em dist/, pronto para as engines"]
```

Peças principais:

- **Blueprint (`asset.json`):** descrição estruturada do asset: partes, dimensões em metros, materiais, orçamento de triângulos e engine-alvo. É o contrato entre a análise e a modelagem.
- **Gerador (`asset.js`):** módulo Three.js que lê o blueprint e constrói a cena. Usa uma biblioteca interna de peças (caixa chanfrada, cilindro, lathe, extrude, sweep, booleanas).
- **Estúdio headless:** página Three.js aberta via Playwright ou pelo browser do Claude. Renderiza as vistas de comparação e a textura de checker de UV.
- **CLI `studio3d`:** comandos `build`, `render`, `uv`, `validate` e `export`, que o Claude chama em sequência.
- **Skill `/modelar-3d`:** orquestra o fluxo e registra cada iteração no relatório do asset.

## Stack de ferramentas

Todas as ferramentas são gratuitas e open source e rodam em Node.js (a v24 já está instalada). Nenhuma exige Python nem conta em serviço externo.

| Ferramenta | Função no pipeline | Licença | Fase |
| --- | --- | --- | --- |
| Node.js 24 | Runtime da CLI `studio3d` | MIT | 0 |
| Three.js | Modelagem, render, GLTFExporter, OBJExporter | MIT | 0 |
| Playwright | Browser headless para render WebGL e screenshots | Apache-2.0 | 0 |
| manifold-3d | Operações booleanas (furos, recortes, uniões) com saída sempre watertight | Apache-2.0 | 1 |
| three-mesh-bvh | Raycast rápido para bake de AO e checagens | MIT | 4 |
| mikktspace (WASM) | Tangentes MikkTSpace iguais às das engines, para o normal map | MIT | 4 |
| xatlas (build WASM) | UV unwrap, empacotamento e UV2 de lightmap | MIT | 2 |
| glTF-Transform | Weld, dedup, tangentes, compressão e inspeção de GLB | MIT | 2 |
| Khronos glTF-Validator | Validação formal do GLB exportado | Apache-2.0 | 2 |
| sharp | Redimensionar e converter texturas (PNG, WebP, KTX2 via toktx) | Apache-2.0 | 4 |
| meshoptimizer | Simplificação para LODs | MIT | 5 |
| assimpjs | Releitura do FBX e do OBJ exportados (verificação automática); o assimp só importa FBX | BSD-3 | 5 |
| studio3d (writer próprio) | Export FBX binário 7.4 e OBJ/MTL | — | 5 |
| Blender CLI (opcional) | Fallback headless para FBX, se o writer próprio falhar em alguma engine | GPL | 7 |
| TripoSR local (opcional) | Malha-base para formas orgânicas, na RTX 3060 | MIT | 6 |

No lado das engines, o Unity importa GLB com o pacote gratuito **glTFast**; o Godot 4 e o Blender importam GLB nativamente.

## Regras de UV e topologia

Todo asset sai com dois canais de UV: **UV0** para texturas e **UV1** para lightmap. Ambos são gerados e validados automaticamente. Os valores abaixo são padrões e podem ser sobrescritos no blueprint de cada asset.

### UV0: texturas

1. **Cobertura total:** todo vértice tem UV0; nenhuma face fica sem mapeamento.
2. **Espaço 0–1:** todas as ilhas ficam dentro de 0–1. A exceção são superfícies com tiling ou trim sheet declaradas no blueprint.
3. **Sem sobreposição:** 0% de overlap. Só é permitido quando o blueprint marca a peça como `mirror` ou `stack`, e nesse caso o bake usa uma única cópia.
4. **Seams em lugares certos:** em arestas vivas (≥ 60°) e em áreas pouco visíveis (base, costas, interior). Nunca no meio de uma superfície contínua visível. O `studio3d` define os charts (chanfros ficam com a face, faixas fechadas são cortadas na linha de trás) e o xatlas só parametriza e empacota.
5. **Hard edge = seam:** toda aresta com normal dividida também é seam de UV. Isso evita artefatos no normal map.
6. **Distorção baixa:** stretch de área e de ângulo ≤ 5% por ilha, medido pelo relatório do xatlas.
7. **Texel density uniforme:** variação ≤ ±10% entre ilhas do mesmo asset. Faces nunca vistas (fundo encostado no chão) podem ter 25% da densidade.
8. **Orientação:** ilhas retangulares ficam alinhadas a U ou V; madeira segue o veio; textos e logos ficam na direção de leitura.
9. **Aproveitamento:** as ilhas ocupam ≥ 70% do espaço UV.

| Categoria | Texel density | Textura típica |
| --- | --- | --- |
| Prop pequeno ou médio | 512 px/m | 1024² |
| Prop herói (close-up) | 1024 px/m | 2048² |
| Arquitetura e modulares | 512 px/m com tiling | 1024² tileável |
| Low-poly estilizado | Atlas de paleta (células de cor) | 256² a 512² |

| Resolução da textura | Padding entre ilhas | Margem da borda |
| --- | --- | --- |
| 256² | 2 px | 1 px |
| 512² | 4 px | 2 px |
| 1024² | 8 px | 4 px |
| 2048² | 16 px | 8 px |
| 4096² | 32 px | 16 px |

### UV1: lightmap

- Gerado pelo xatlas em todo asset marcado como `static` (arquitetura e props fixos).
- Sem sobreposição, dentro de 0–1 e com padding ≥ 2 texels na resolução de lightmap declarada (padrão de 128² por asset).
- Exportado como `TEXCOORD_1` no GLB. O Unity lê como canal UV1 (`Mesh.uv2`), o Godot como UV2 e o Blender como segundo UV map.

### Topologia e escala

- **Escala real:** 1 unidade = 1 metro, com dimensões dentro de ±2% do blueprint.
- **Eixos:** convenção glTF, com +Y para cima e a frente do asset voltada para +Z.
- **Pivot:** centro da base para props; canto inferior alinhado ao grid para modulares.
- **Malha limpa:** vértices soldados (weld), sem faces de área zero, sem arestas non-manifold e com normais para fora. Objetos fechados são watertight.
- **Suavização:** normais ponderadas por área e divididas por ângulo (padrão de 50°, para chanfros de 45° ficarem suaves e pegarem luz) ou chanfros reais.
- **Chanfros:** arestas visíveis têm chanfro de 2 a 5 mm para pegar luz, exceto no estilo low-poly facetado.
- **Orçamento de triângulos:** prop pequeno 300 a 1.500; prop médio 1.500 a 5.000; prop herói 5.000 a 15.000; módulo de arquitetura 200 a 2.000.

## Export por engine

O GLB é o formato mestre: um único arquivo abre corretamente nas três engines. O FBX e o OBJ são derivados dele, para pipelines que ainda os exigem. A ferramenta não escreve em projetos de engine: ela gera o pacote em `dist/<nome>/` (e um `.zip`), e quem usa copia para o projeto. Os scripts de import do lado da engine (LODGroup e colliders no Unity) ficam em `unity/com.studio3d.import` e são testados na F7.

| Aspecto | Unity | Godot 4 | Blender |
| --- | --- | --- | --- |
| Formato principal | FBX (binary), padrão da equipe | GLB nativo | GLB nativo |
| Formato alternativo | GLB via glTFast | — | FBX, OBJ |
| Material | URP Lit (convertido pelo glTFast) | StandardMaterial3D | Principled BSDF |
| UV de lightmap | Canal UV1 (`TEXCOORD_1`) | UV2 (`TEXCOORD_1`) | Segundo UV map |
| Colisão | Malha `<nome>_col` vira MeshCollider via script de import | Sufixo `-col` ou `-colonly` no nó (hint nativo) | Objeto separado `<nome>_col` |
| LODs | Nós `_LOD0` a `_LOD2` viram LODGroup via script de import | Nós `_LOD` separados, ou LOD automático do importador | Objetos separados por LOD |

Pacote gerado por asset (`dist/<nome>/`):

- `SM_<Nome>.glb`, com texturas embutidas
- `SM_<Nome>.fbx` (binário 7.4, com UV1 e LODs) e `SM_<Nome>.obj` + `.mtl` (só LOD0 e colisor)
- Dentro do GLB e do FBX: `SM_<Nome>_LOD0` a `_LOD2` (a partir de 600 triângulos) e `SM_<Nome>_col` (casco convexo, ≤ 256 triângulos)
- `textures/`, com PNGs soltos: `T_<Nome>_BaseColor`, `T_<Nome>_Normal` (OpenGL, Y+) e `T_<Nome>_ORM` (R = AO, G = roughness, B = metallic). No low-poly, só `T_<Nome>_Palette`
- `preview.png`: as quatro vistas lado a lado com a referência
- `report.json`: resultado de todas as validações

No Unity, o normal map OpenGL (Y+) é o padrão. No Godot e no Blender também, então nenhuma engine precisa inverter o canal verde.

## Validação e critérios de aceite

Um asset só é exportado quando passa em todos os checks bloqueantes. O comando `studio3d validate` gera o `report.json`, e o Claude corrige as falhas antes de seguir.

| Check | Critério | Ferramenta | Bloqueia |
| --- | --- | --- | --- |
| GLB válido | 0 erros, 0 warnings | glTF-Validator | Sim |
| UV0 presente | 100% dos vértices | studio3d | Sim |
| UV0 overlap | 0% (exceto `mirror`, `stack` e paleta low-poly) | studio3d (rasterização) | Sim |
| UV0 fora de 0–1 | 0 ilhas (exceto tiling declarado) | studio3d | Sim |
| Padding | ≥ tabela de padding | studio3d | Sim |
| Texel density | ±10% entre ilhas | studio3d | Não (alerta) |
| Distorção | ≤ 5% por ilha | xatlas | Não (alerta) |
| UV1 lightmap | Presente e sem overlap se `static` | studio3d | Sim |
| Malha | Manifold, sem faces de área zero, normais para fora | three-mesh-bvh + studio3d | Sim |
| Dimensões | ±2% do blueprint | studio3d (bounding box) | Sim |
| Triângulos | Dentro do orçamento da categoria | glTF-Transform inspect | Sim |
| Texturas | Potência de 2, no tamanho declarado; bordas das ilhas dilatadas (sem fundo vazando) | sharp | Sim |
| Paleta (low-poly) | Toda face dentro de uma célula da paleta | studio3d | Sim |
| Fidelidade visual | Nota ≥ 8/10 do Claude em cada vista | Claude (visão) | Sim |

Critérios de aceite da v1, medidos em um conjunto de 10 referências de teste:

- [ ] 10 de 10 assets passam em todos os checks bloqueantes
- [ ] Pelo menos 3 assets de cada estilo (realista e low-poly) no conjunto
- [ ] Cada asset importa sem erros no Unity (FBX), no Godot 4 e no Blender (testado na F7)
- [ ] A textura de checker não mostra esticamento visível em nenhuma vista
- [ ] O lightmap bake no Unity não mostra vazamentos (light bleeding) nas seams (testado na F7)
- [ ] Tempo médio de uma referência até o pacote final abaixo de 15 minutos

## Estrutura de pastas e convenções

A ferramenta é um projeto independente em `www/projects/3D Studio/`, sem dependência de nenhum projeto de engine. Cada asset tem uma pasta própria com a referência, o código-fonte e a saída de build. O `studio3d export` monta o pacote final em `dist/<nome>/` e `dist/<nome>.zip`.

```
3D Studio/
  package.json
  cli/                 # comandos studio3d (new, build, render, uv, validate, export)
  lib/
    parts/             # biblioteca de peças: bevelBox, lathe, extrude, sweep, csg
    materials/         # materiais PBR procedurais e bake de texturas
    uv/                # wrapper do xatlas, regras e métricas
    validate/          # checks do report.json
  studio/
    index.html         # estúdio headless: luzes, câmeras, checker
  assets/
    <nome>/
      ref/             # imagens de referência e prompt.md
      asset.json       # blueprint
      asset.js         # gerador Three.js
      iterations/      # renders de cada iteração
      out/             # saída de build: SM_<Nome>.glb, textures/, report.json
      review.json      # avaliação visual (checklist por vista)
  dist/
    <nome>/            # pacote final: .glb, .fbx, .obj, textures/, preview.png, report.json
  templates/           # esqueleto de asset para `studio3d new`
  tools/               # scripts de diagnóstico (UV, topologia)
  .claude/skills/modelar-3d/SKILL.md
```

| Item | Convenção | Exemplo |
| --- | --- | --- |
| Pasta do asset | kebab-case | `cadeira-madeira` |
| Malha estática | `SM_` + PascalCase | `SM_CadeiraMadeira` |
| Textura | `T_<Nome>_<Mapa>` | `T_CadeiraMadeira_ORM` |
| Material | `M_<Nome>_<Parte>` | `M_CadeiraMadeira_Assento` |
| Colisão | `<malha>_col` | `SM_CadeiraMadeira_col` |
| LOD | `<malha>_LOD<n>` | `SM_CadeiraMadeira_LOD1` |

## Roadmap

O MVP (referência vira asset aprovado) fecha no fim da F3. A F4 e a F5 levam o asset a padrão de produção nos dois estilos, sem depender de nenhuma engine. A F6 traz os extras (kits modulares, lote). Os testes de import ficam para a F7, a última fase da v1. Cada fase só avança quando o seu gate é cumprido. As datas ficam para definir.

| Fase | Entregas | Gate de saída | Status |
| --- | --- | --- | --- |
| **F0 · Fundação** | Projeto Node, Three.js, estúdio headless com Playwright, GLB de um cubo de teste | O GLB passa no glTF-Validator e renderiza certo no estúdio | Concluída |
| **F1 · Biblioteca de peças** | bevelBox, cilindro, lathe, extrude, sweep e CSG; schema do blueprint (asset.json); normais por ângulo | 3 props feitos só com a biblioteca | Concluída |
| **F2 · UV e validação** | xatlas (UV0 + UV1), seams por ângulo, padding, texel density, checker e report.json | report.json sem falhas bloqueantes nos 3 props | Concluída |
| **F3 · Referência para modelo (MVP)** | Skill /modelar-3d, blueprint a partir de imagem ou prompt, render de 4 vistas, ciclo de comparação | **MVP: 5 referências reais viram assets aprovados** | 4 de 5 referências aprovadas (extintor, cadeira Adirondack, cone, cadeira estofada); falta 1 |
| **F4 · Materiais e estilos** | Presets PBR procedurais, bake de BaseColor, Normal e ORM, AO via raycast, estilo low-poly (facetado + paleta) | 1 asset de cada estilo com texturas aprovadas: checker, vista de materiais e checks de textura | Concluída |
| **F5 · Pacote de export** | FBX binário e OBJ (writers próprios, relidos pelo assimpjs), LODs com meshoptimizer, colisores, pacote `dist/<nome>/` + zip | 10 assets (pelo menos 3 de cada estilo) com pacote completo e checks ok, incluindo releitura do FBX e do OBJ | Concluída |
| **F6 · Extras** | Kits modulares com grid, snapping e texturas tileáveis; geração em lote; TripoSR local para formas orgânicas (opcional, exige Python/CUDA) | Kit modular de arquitetura validado e lote dos 10+ assets em um comando | Em andamento |
| **F7 · Testes nas engines (última)** | Import no Unity por FBX (formato principal da equipe) com o pacote `unity/com.studio3d.import` (LODGroup, colisores), bake de lightmap; GLB via glTFast opcional; Godot e Blender se instalados | Critérios de aceite da v1 | Pacote Unity pronto; teste adiado para o fim |

A ordem prioriza UV e validação (F2) antes do ciclo com referência (F3): as regras de UV passam a ser garantidas desde o primeiro asset gerado.

## Riscos e questões em aberto

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Formas curvas complexas ficam genéricas | Fidelidade baixa em veículos e orgânicos | Peças sweep e lathe, subdivisão; TripoSR local na F6 (opcional) |
| Seams automáticos do xatlas em lugares visíveis | Viola as regras de UV | Seams definidos por peça no gerador; xatlas só empacota |
| assimpjs gera FBX com eixos ou escala errados | Import quebrado no Unity | Releitura automática do FBX na F5; teste real na F7; fallback para Blender CLI headless |
| WebGL headless sem GPU no Playwright | Render lento ou diferente | Forçar GPU (RTX 3060) ou usar o browser do Claude |
| Nota visual do Claude varia entre iterações | Critério de aprovação instável | Checklist fixo por vista, anotado no report.json |
| Uso de tokens alto por asset (várias iterações com imagem) | Limite da licença | Teto de 5 iterações; renders em 768 px |

Questões em aberto:

- [ ] Qual pipeline de render é o alvo no Unity: URP, HDRP ou Built-in? (necessário na F7)
- [x] O GLB com glTFast basta no Unity, ou o FBX é obrigatório no fluxo da equipe? FBX é o formato principal no Unity; o GLB segue como formato mestre e para Godot/Blender
- [ ] Os padrões de texel density (512 px/m para props) servem para os projetos atuais?
- [x] Qual o estilo visual predominante? Os dois: realista (PBR) e low-poly (ver "Estilos visuais")
- [x] Quais são as 10 referências do conjunto de teste da v1? caixa, tambor, suporte, banquinho (PBR e low-poly), extintor, cadeira Adirondack (low-poly), cone (low-poly) e cadeira estofada
