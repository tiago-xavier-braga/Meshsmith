// Three.js scene -> glTF 2.0 (GLB) via glTF-Transform.
// We write the document ourselves instead of using GLTFExporter so we control
// TEXCOORD_1 (lightmap), node names, embedded textures and run in plain Node.
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';

export function createIO() {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS);
}

/**
 * @param {THREE.Object3D} root
 * @param {{ generator?: string }} [opts]
 * @returns {Document}
 */
export function sceneToDocument(root, opts = {}) {
  const doc = new Document();
  doc.getRoot().getAsset().generator = opts.generator ?? '3D Studio';
  const buffer = doc.createBuffer();
  const scene = doc.createScene(root.name || 'Scene');
  const materialCache = new Map();
  const textureCache = new Map();

  const texture = (png, name, mime = 'image/png') => {
    if (!png) return null;
    if (textureCache.has(png)) return textureCache.get(png);
    const tex = doc.createTexture(name).setImage(new Uint8Array(png)).setMimeType(mime).setURI(`${name}.png`);
    textureCache.set(png, tex);
    return tex;
  };

  const material = (m) => {
    if (materialCache.has(m)) return materialCache.get(m);
    const gm = doc.createMaterial(m.name || 'M_Default');
    const c = m.color ?? new THREE.Color(1, 1, 1);
    gm.setBaseColorFactor([c.r, c.g, c.b, m.opacity ?? 1]);
    gm.setRoughnessFactor(m.roughness ?? 1);
    gm.setMetallicFactor(m.metalness ?? 0);
    if (m.emissive && (m.emissive.r || m.emissive.g || m.emissive.b)) {
      gm.setEmissiveFactor([m.emissive.r, m.emissive.g, m.emissive.b]);
    }
    if (m.transparent) gm.setAlphaMode('BLEND');
    if (m.side === THREE.DoubleSide) gm.setDoubleSided(true);
    // Baked textures are attached as PNG buffers by lib/materials.
    const t = m.userData?.textures ?? {};
    const base = m.userData?.textureBaseName ?? gm.getName().replace(/^M_/, 'T_');
    if (t.baseColor) gm.setBaseColorTexture(texture(t.baseColor, `${base}_BaseColor`));
    if (t.normal) gm.setNormalTexture(texture(t.normal, `${base}_Normal`));
    if (t.orm) {
      const orm = texture(t.orm, `${base}_ORM`);
      gm.setOcclusionTexture(orm);
      gm.setMetallicRoughnessTexture(orm);
    }
    if (t.baseColor) gm.getBaseColorTextureInfo().setTexCoord(0);
    materialCache.set(m, gm);
    return gm;
  };

  const accessor = (name, array, type) =>
    doc.createAccessor(name).setArray(array).setType(type).setBuffer(buffer);

  const primitivesFor = (mesh) => {
    const g = mesh.geometry;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const attrs = {};
    const pos = g.getAttribute('position');
    attrs.POSITION = accessor(`${mesh.name}_POSITION`, new Float32Array(pos.array), 'VEC3');
    const nrm = g.getAttribute('normal');
    if (nrm) attrs.NORMAL = accessor(`${mesh.name}_NORMAL`, new Float32Array(nrm.array), 'VEC3');
    const tan = g.getAttribute('tangent');
    if (tan) attrs.TANGENT = accessor(`${mesh.name}_TANGENT`, new Float32Array(tan.array), 'VEC4');
    // Three authors UVs with V up (origin bottom-left); glTF puts the origin top-left.
    const flipV = (a) => {
      const out = new Float32Array(a.array);
      for (let i = 1; i < out.length; i += 2) out[i] = 1 - out[i];
      return out;
    };
    const uv = g.getAttribute('uv');
    if (uv) attrs.TEXCOORD_0 = accessor(`${mesh.name}_UV0`, flipV(uv), 'VEC2');
    const uv1 = g.getAttribute('uv1');
    if (uv1) attrs.TEXCOORD_1 = accessor(`${mesh.name}_UV1`, flipV(uv1), 'VEC2');
    const col = g.getAttribute('color');
    if (col) attrs.COLOR_0 = accessor(`${mesh.name}_COLOR`, new Float32Array(col.array), col.itemSize === 4 ? 'VEC4' : 'VEC3');

    const vertexCount = pos.count;
    const fullIndex = g.index ? g.index.array : Uint32Array.from({ length: vertexCount }, (_, i) => i);
    const groups = g.groups.length ? g.groups : [{ start: 0, count: fullIndex.length, materialIndex: 0 }];
    // One primitive per distinct material (Three groups often repeat a material).
    const byMaterial = new Map();
    for (const grp of groups) {
      const m = mats[grp.materialIndex ?? 0] ?? mats[0];
      if (!byMaterial.has(m)) byMaterial.set(m, []);
      byMaterial.get(m).push(...fullIndex.slice(grp.start, grp.start + grp.count));
    }
    return [...byMaterial].map(([m, indices], gi) => {
      const idx = vertexCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
      const prim = doc.createPrimitive()
        .setIndices(accessor(`${mesh.name}_INDEX_${gi}`, idx, 'SCALAR'))
        .setMaterial(material(m));
      for (const [k, a] of Object.entries(attrs)) prim.setAttribute(k, a);
      return prim;
    });
  };

  const visit = (obj) => {
    const node = doc.createNode(obj.name || obj.type);
    node.setTranslation(obj.position.toArray());
    node.setRotation(obj.quaternion.toArray());
    node.setScale(obj.scale.toArray());
    if (obj.isMesh) {
      const gmesh = doc.createMesh(obj.name);
      for (const p of primitivesFor(obj)) gmesh.addPrimitive(p);
      node.setMesh(gmesh);
    }
    if (Object.keys(obj.userData ?? {}).length) {
      const extras = { ...obj.userData };
      delete extras.textures;
      if (Object.keys(extras).length) node.setExtras(extras);
    }
    for (const child of obj.children) node.addChild(visit(child));
    return node;
  };

  // The root group itself becomes the single top node so pivots stay intact.
  scene.addChild(visit(root));
  return doc;
}

export async function writeGLB(root, path, opts) {
  const doc = sceneToDocument(root, opts);
  await createIO().write(path, doc);
  return doc;
}
