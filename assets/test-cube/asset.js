// F0 smoke test: a 1 m cube with the pivot at the centre of its base.
export default function build(bp, { THREE, materials }) {
  const root = new THREE.Group();
  root.name = bp.meshName;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mesh = new THREE.Mesh(geo, materials.body);
  mesh.name = `${bp.meshName}_Body`;
  root.add(mesh);
  return root;
}
