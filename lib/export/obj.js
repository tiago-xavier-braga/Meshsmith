// Wavefront OBJ + MTL of the render mesh (LOD0) and the collider as a separate object.
// OBJ has no second UV channel and no packed ORM: roughness/metalness go in as the MTL PBR
// scalars (Pr/Pm), textures as map_Kd (BaseColor) and norm/map_Bump (Normal).

const f6 = (v) => (Math.abs(v) < 1e-9 ? '0' : v.toFixed(6));

/**
 * @returns {{ obj: string, mtl: string }}
 */
export function sceneToOBJ(root, { name, textures = {} }) {
  const lines = [`# 3D Studio`, `mtllib ${name}.mtl`];
  const mtl = ['# 3D Studio'];
  const seenMat = new Set();
  let base = 1; // OBJ indices are 1-based and global
  root.traverse((o) => {
    if (!o.isMesh || /_LOD[1-9]$/.test(o.name)) return;
    const g = o.geometry, pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv, idx = g.index.array;
    lines.push(`o ${o.name}`);
    for (let i = 0; i < pos.count; i++) lines.push(`v ${f6(pos.getX(i))} ${f6(pos.getY(i))} ${f6(pos.getZ(i))}`);
    if (uv) for (let i = 0; i < uv.count; i++) lines.push(`vt ${f6(uv.getX(i))} ${f6(uv.getY(i))}`);
    if (nrm) for (let i = 0; i < nrm.count; i++) lines.push(`vn ${f6(nrm.getX(i))} ${f6(nrm.getY(i))} ${f6(nrm.getZ(i))}`);
    const mats = [].concat(o.material);
    const groups = g.groups.length ? g.groups : [{ start: 0, count: idx.length, materialIndex: 0 }];
    const corner = (v) => `${v + base}/${uv ? v + base : ''}/${nrm ? v + base : ''}`;
    for (const grp of groups) {
      const m = mats[grp.materialIndex] ?? mats[0];
      if (!o.userData.collision) {
        lines.push(`usemtl ${m.name}`);
        if (!seenMat.has(m.name)) {
          seenMat.add(m.name);
          const c = m.color ?? { r: 1, g: 1, b: 1 };
          mtl.push('', `newmtl ${m.name}`, `Kd ${f6(c.r)} ${f6(c.g)} ${f6(c.b)}`, `Ks 0.04 0.04 0.04`, `Pr ${f6(m.roughness ?? 1)}`, `Pm ${f6(m.metalness ?? 0)}`, 'illum 2');
          if (m.emissive && (m.emissive.r || m.emissive.g || m.emissive.b)) mtl.push(`Ke ${f6(m.emissive.r)} ${f6(m.emissive.g)} ${f6(m.emissive.b)}`);
          const files = { ...textures, ...(m.userData?.textureFiles ?? {}) };
          if (files.baseColor && m.userData?.textures?.baseColor) mtl.push(`map_Kd ${files.baseColor}`);
          if (files.normal && m.userData?.textures?.normal) mtl.push(`norm ${files.normal}`, `map_Bump ${files.normal}`);
        }
      }
      for (let i = grp.start; i < grp.start + grp.count; i += 3) lines.push(`f ${corner(idx[i])} ${corner(idx[i + 1])} ${corner(idx[i + 2])}`);
    }
    base += pos.count;
  });
  return { obj: lines.join('\n') + '\n', mtl: mtl.join('\n') + '\n' };
}
