// Binary FBX 7.4 writer (assimp and assimpjs can only read FBX, so we write it ourselves).
// Scene: a Null root model with one Mesh model per node (LOD0..n, _col), triangles, per-corner
// normals, UV0 + UV1 (lightmap), per-polygon materials, BaseColor/Normal textures by relative path.
// Units: metres, declared with UnitScaleFactor = 100 (cm per unit); axes Y up, front +Z.
import { deflateSync } from 'node:zlib';

// ---- node tree + binary serialisation -------------------------------------------------------

const P = {
  I: (v) => ({ t: 'I', v }), L: (v) => ({ t: 'L', v: BigInt(v) }), D: (v) => ({ t: 'D', v }),
  C: (v) => ({ t: 'C', v }), S: (v) => ({ t: 'S', v }), R: (v) => ({ t: 'R', v }),
  i: (v) => ({ t: 'i', v }), d: (v) => ({ t: 'd', v }),
};
const node = (name, props = [], children = []) => ({ name, props, children });
/** FBX binary object names are "Name\x00\x01Class". */
const oname = (name, cls) => `${name}\u0000\u0001${cls}`;

function encodeProp(p) {
  switch (p.t) {
    case 'I': { const b = Buffer.alloc(5); b.write('I'); b.writeInt32LE(p.v, 1); return b; }
    case 'L': { const b = Buffer.alloc(9); b.write('L'); b.writeBigInt64LE(p.v, 1); return b; }
    case 'D': { const b = Buffer.alloc(9); b.write('D'); b.writeDoubleLE(p.v, 1); return b; }
    case 'C': { const b = Buffer.alloc(2); b.write('C'); b[1] = p.v ? 1 : 0; return b; }
    case 'S': case 'R': {
      const s = p.t === 'S' ? Buffer.from(p.v, 'utf8') : Buffer.from(p.v);
      const b = Buffer.alloc(5); b.write(p.t); b.writeUInt32LE(s.length, 1); return Buffer.concat([b, s]);
    }
    case 'i': case 'd': {
      const size = p.t === 'i' ? 4 : 8;
      const raw = Buffer.alloc(p.v.length * size);
      p.v.forEach((x, k) => (p.t === 'i' ? raw.writeInt32LE(x, k * 4) : raw.writeDoubleLE(x, k * 8)));
      const zip = raw.length > 128;
      const data = zip ? deflateSync(raw) : raw;
      const h = Buffer.alloc(13); h.write(p.t); h.writeUInt32LE(p.v.length, 1); h.writeUInt32LE(zip ? 1 : 0, 5); h.writeUInt32LE(data.length, 9);
      return Buffer.concat([h, data]);
    }
    default: throw new Error(`unknown FBX property type ${p.t}`);
  }
}

const NULL_RECORD = Buffer.alloc(13);

function encodeNode(n, offset) {
  const props = Buffer.concat(n.props.map(encodeProp));
  const name = Buffer.from(n.name, 'utf8');
  const headLen = 13 + name.length;
  let pos = offset + headLen + props.length;
  const kids = [];
  for (const c of n.children) { const b = encodeNode(c, pos); kids.push(b); pos += b.length; }
  // A NULL record closes a nested list (and marks nodes without properties).
  if (n.children.length || !n.props.length) { kids.push(NULL_RECORD); pos += 13; }
  const head = Buffer.alloc(headLen);
  head.writeUInt32LE(pos, 0);
  head.writeUInt32LE(n.props.length, 4);
  head.writeUInt32LE(props.length, 8);
  head.writeUInt8(name.length, 12);
  name.copy(head, 13);
  return Buffer.concat([head, props, ...kids]);
}

function serialise(top) {
  const header = Buffer.concat([Buffer.from('Kaydara FBX Binary  \u0000', 'latin1'), Buffer.from([0x1a, 0x00]), Buffer.alloc(4)]);
  header.writeUInt32LE(7400, 23);
  const parts = [header];
  let pos = header.length;
  for (const n of top) { const b = encodeNode(n, pos); parts.push(b); pos += b.length; }
  parts.push(NULL_RECORD);
  pos += 13;
  const footerId = Buffer.from([0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e]);
  const pad = Buffer.alloc((16 - ((pos + footerId.length) % 16)) % 16);
  const version = Buffer.alloc(4); version.writeUInt32LE(7400, 0);
  const magic = Buffer.from([0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b]);
  parts.push(footerId, pad, version, Buffer.alloc(120), magic);
  return Buffer.concat(parts);
}

// ---- scene -> FBX objects -------------------------------------------------------------------

const prop70 = (name, type, label, flags, ...values) => node('P', [P.S(name), P.S(type), P.S(label), P.S(flags), ...values]);

function geometryNode(id, name, geo) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal, idx = geo.index.array;
  const vertices = Array.from(pos.array);
  const pvi = [], normals = [], materials = [];
  const groups = geo.groups.length ? geo.groups : [{ start: 0, count: idx.length, materialIndex: 0 }];
  const triMat = new Int32Array(idx.length / 3);
  groups.forEach((g, gi) => { for (let i = g.start; i < g.start + g.count; i += 3) triMat[i / 3] = g.materialSlot ?? gi; });
  for (let t = 0; t < idx.length / 3; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    pvi.push(a, b, -(c + 1)); // last corner of a polygon is stored as ~index
    for (const v of [a, b, c]) normals.push(nrm ? nrm.getX(v) : 0, nrm ? nrm.getY(v) : 1, nrm ? nrm.getZ(v) : 0);
    materials.push(triMat[t]);
  }
  const children = [
    node('Properties70'), node('GeometryVersion', [P.I(124)]),
    node('Vertices', [P.d(vertices)]), node('PolygonVertexIndex', [P.i(pvi)]),
    node('LayerElementNormal', [P.I(0)], [
      node('Version', [P.I(101)]), node('Name', [P.S('')]),
      node('MappingInformationType', [P.S('ByPolygonVertex')]), node('ReferenceInformationType', [P.S('Direct')]),
      node('Normals', [P.d(normals)]),
    ]),
  ];
  const uvLayers = [];
  for (const [k, attr, label] of [[0, 'uv', 'UVMap'], [1, 'uv1', 'Lightmap']]) {
    const uv = geo.attributes[attr];
    if (!uv) continue;
    const uvIndex = [];
    for (let t = 0; t < idx.length; t++) uvIndex.push(idx[t]);
    children.push(node('LayerElementUV', [P.I(k)], [
      node('Version', [P.I(101)]), node('Name', [P.S(label)]),
      node('MappingInformationType', [P.S('ByPolygonVertex')]), node('ReferenceInformationType', [P.S('IndexToDirect')]),
      node('UV', [P.d(Array.from(uv.array))]), node('UVIndex', [P.i(uvIndex)]),
    ]));
    uvLayers.push(k);
  }
  children.push(node('LayerElementMaterial', [P.I(0)], [
    node('Version', [P.I(101)]), node('Name', [P.S('')]),
    node('MappingInformationType', [P.S('ByPolygon')]), node('ReferenceInformationType', [P.S('IndexToDirect')]),
    node('Materials', [P.i(materials)]),
  ]));
  const layerEl = (type, i) => node('LayerElement', [], [node('Type', [P.S(type)]), node('TypedIndex', [P.I(i)])]);
  children.push(node('Layer', [P.I(0)], [
    node('Version', [P.I(100)]), layerEl('LayerElementNormal', 0), layerEl('LayerElementMaterial', 0),
    ...(uvLayers.includes(0) ? [layerEl('LayerElementUV', 0)] : []),
  ]));
  if (uvLayers.includes(1)) children.push(node('Layer', [P.I(1)], [node('Version', [P.I(100)]), layerEl('LayerElementUV', 1)]));
  return node('Geometry', [P.L(id), P.S(oname(name, 'Geometry')), P.S('Mesh')], children);
}

function modelNode(id, name, type, obj) {
  return node('Model', [P.L(id), P.S(oname(name, 'Model')), P.S(type)], [
    node('Version', [P.I(232)]),
    node('Properties70', [], [
      prop70('Lcl Translation', 'Lcl Translation', '', 'A', P.D(obj.position.x), P.D(obj.position.y), P.D(obj.position.z)),
      prop70('Lcl Rotation', 'Lcl Rotation', '', 'A', P.D(0), P.D(0), P.D(0)),
      prop70('Lcl Scaling', 'Lcl Scaling', '', 'A', P.D(obj.scale.x), P.D(obj.scale.y), P.D(obj.scale.z)),
      prop70('DefaultAttributeIndex', 'int', 'Integer', '', P.I(0)),
      prop70('InheritType', 'enum', '', '', P.I(1)),
    ]),
    node('MultiLayer', [P.I(0)]), node('MultiTake', [P.I(0)]), node('Shading', [P.C(true)]), node('Culling', [P.S('CullingOff')]),
  ]);
}

function materialNode(id, m) {
  const c = m.color ?? { r: 1, g: 1, b: 1 };
  return node('Material', [P.L(id), P.S(oname(m.name, 'Material')), P.S('')], [
    node('Version', [P.I(102)]), node('ShadingModel', [P.S('phong')]), node('MultiLayer', [P.I(0)]),
    node('Properties70', [], [
      prop70('DiffuseColor', 'Color', '', 'A', P.D(c.r), P.D(c.g), P.D(c.b)),
      prop70('SpecularFactor', 'Number', '', 'A', P.D(0.5 * (1 - (m.roughness ?? 0.5)))),
      prop70('ShininessExponent', 'Number', '', 'A', P.D(2 + 98 * (1 - (m.roughness ?? 0.5)) ** 2)),
      prop70('ReflectionFactor', 'Number', '', 'A', P.D(m.metalness ?? 0)),
      ...(m.emissive && (m.emissive.r || m.emissive.g || m.emissive.b)
        ? [prop70('EmissiveColor', 'Color', '', 'A', P.D(m.emissive.r), P.D(m.emissive.g), P.D(m.emissive.b)), prop70('EmissiveFactor', 'Number', '', 'A', P.D(1))]
        : []),
    ]),
  ]);
}

function textureNodes(texId, videoId, name, file) {
  return [
    node('Texture', [P.L(texId), P.S(oname(name, 'Texture')), P.S('')], [
      node('Type', [P.S('TextureVideoClip')]), node('Version', [P.I(202)]), node('TextureName', [P.S(oname(name, 'Texture'))]),
      node('Properties70', [], [prop70('UseMaterial', 'bool', '', '', P.I(1))]),
      node('Media', [P.S(oname(name, 'Video'))]), node('FileName', [P.S(file)]), node('RelativeFilename', [P.S(file)]),
      node('ModelUVTranslation', [P.D(0), P.D(0)]), node('ModelUVScaling', [P.D(1), P.D(1)]),
      node('Texture_Alpha_Source', [P.S('None')]), node('Cropping', [P.I(0), P.I(0), P.I(0), P.I(0)]),
    ]),
    node('Video', [P.L(videoId), P.S(oname(name, 'Video')), P.S('Clip')], [
      node('Type', [P.S('Clip')]),
      node('Properties70', [], [prop70('Path', 'KString', 'XRefUrl', '', P.S(file))]),
      node('UseMipMap', [P.I(0)]), node('Filename', [P.S(file)]), node('RelativeFilename', [P.S(file)]),
    ]),
  ];
}

/**
 * @param {import('three').Object3D} root asset root (render mesh, LODs, collider as children)
 * @param {{ textures?: { baseColor?: string, normal?: string } }} opts relative texture paths
 * @returns {Buffer} binary FBX
 */
export function sceneToFBX(root, { textures = {} } = {}) {
  let nextId = 1_000_000;
  const id = () => nextId++;
  const objects = [], connections = [];
  const connect = (child, parent, propName) => connections.push(node('C', propName ? [P.S('OP'), P.L(child), P.L(parent), P.S(propName)] : [P.S('OO'), P.L(child), P.L(parent)]));
  const counts = { Model: 0, Geometry: 0, Material: 0, Texture: 0, Video: 0 };

  const rootId = id();
  objects.push(modelNode(rootId, root.name, 'Null', root));
  counts.Model++;
  connect(rootId, 0);

  const matIds = new Map();
  const materialId = (m) => {
    if (matIds.has(m)) return matIds.get(m);
    const mid = id();
    matIds.set(m, mid);
    objects.push(materialNode(mid, m));
    counts.Material++;
    for (const [key, slot] of [['baseColor', 'DiffuseColor'], ['normal', 'NormalMap']]) {
      if (!textures[key] || !m.userData?.textures?.[key]) continue;
      const tid = id(), vid = id();
      objects.push(...textureNodes(tid, vid, textures[key].replace(/^.*\//, '').replace(/\.png$/, ''), textures[key]));
      counts.Texture++; counts.Video++;
      connect(vid, tid);
      connect(tid, mid, slot);
    }
    return mid;
  };

  root.traverse((o) => {
    if (!o.isMesh) return;
    const modelId = id(), geoId = id();
    const mats = [].concat(o.material);
    // FBX material slots follow the order materials are connected to the model.
    const used = [];
    const geo = o.geometry.clone();
    geo.groups.forEach((g) => {
      const m = mats[g.materialIndex] ?? mats[0];
      if (!used.includes(m)) used.push(m);
      g.materialSlot = used.indexOf(m);
    });
    if (!geo.groups.length) used.push(mats[0]);
    objects.push(geometryNode(geoId, o.name, geo));
    objects.push(modelNode(modelId, o.name, 'Mesh', o));
    counts.Model++; counts.Geometry++;
    connect(geoId, modelId);
    connect(modelId, rootId);
    if (!o.userData.collision) for (const m of used) connect(materialId(m), modelId);
  });

  const now = new Date();
  const ts = node('CreationTimeStamp', [], [
    node('Version', [P.I(1000)]), node('Year', [P.I(now.getFullYear())]), node('Month', [P.I(now.getMonth() + 1)]), node('Day', [P.I(now.getDate())]),
    node('Hour', [P.I(now.getHours())]), node('Minute', [P.I(now.getMinutes())]), node('Second', [P.I(now.getSeconds())]), node('Millisecond', [P.I(0)]),
  ]);
  const top = [
    node('FBXHeaderExtension', [], [
      node('FBXHeaderVersion', [P.I(1003)]), node('FBXVersion', [P.I(7400)]), node('EncryptionType', [P.I(0)]), ts,
      node('Creator', [P.S('3D Studio')]),
    ]),
    node('GlobalSettings', [], [
      node('Version', [P.I(1000)]),
      node('Properties70', [], [
        prop70('UpAxis', 'int', 'Integer', '', P.I(1)), prop70('UpAxisSign', 'int', 'Integer', '', P.I(1)),
        prop70('FrontAxis', 'int', 'Integer', '', P.I(2)), prop70('FrontAxisSign', 'int', 'Integer', '', P.I(1)),
        prop70('CoordAxis', 'int', 'Integer', '', P.I(0)), prop70('CoordAxisSign', 'int', 'Integer', '', P.I(1)),
        prop70('OriginalUpAxis', 'int', 'Integer', '', P.I(1)), prop70('OriginalUpAxisSign', 'int', 'Integer', '', P.I(1)),
        prop70('UnitScaleFactor', 'double', 'Number', '', P.D(100)), prop70('OriginalUnitScaleFactor', 'double', 'Number', '', P.D(100)),
      ]),
    ]),
    node('Documents', [], [node('Count', [P.I(1)]), node('Document', [P.L(id()), P.S(''), P.S('Scene')], [node('RootNode', [P.L(0)])])]),
    node('References'),
    node('Definitions', [], [
      node('Version', [P.I(100)]),
      node('Count', [P.I(1 + Object.values(counts).reduce((s, v) => s + v, 0))]),
      node('ObjectType', [P.S('GlobalSettings')], [node('Count', [P.I(1)])]),
      ...Object.entries(counts).filter(([, v]) => v).map(([k, v]) => node('ObjectType', [P.S(k)], [node('Count', [P.I(v)])])),
    ]),
    node('Objects', [], objects),
    node('Connections', [], connections),
  ];
  return serialise(top);
}
