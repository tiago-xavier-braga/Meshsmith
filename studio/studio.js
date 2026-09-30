// Headless studio: loads a GLB and renders comparison views.
// Driven from Node through Playwright (see lib/core/render.js) via window.studio.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const BG = new THREE.Color('#3a3d42');
scene.background = BG;
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;

const key = new THREE.DirectionalLight('#ffffff', 2.2);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0005;
scene.add(key, key.target);
const fill = new THREE.DirectionalLight('#dfe8ff', 0.6);
scene.add(fill);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  new THREE.ShadowMaterial({ opacity: 0.35 }),
);
ground.receiveShadow = true;
scene.add(ground);

let model = null;
let box = new THREE.Box3();
const originalMaterials = new Map();
const loader = new GLTFLoader();

function checkerTexture(label) {
  const size = 1024, cells = 16, c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const s = size / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const hue = ((x + y * cells) / (cells * cells)) * 300;
      g.fillStyle = (x + y) % 2 ? `hsl(${hue},55%,62%)` : `hsl(${hue},25%,22%)`;
      g.fillRect(x * s, y * s, s, s);
    }
  }
  g.fillStyle = '#fff';
  g.font = `bold ${s * 0.32}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let y = 0; y < cells; y += 2) {
    for (let x = 0; x < cells; x += 2) g.fillText(`${label}${String.fromCharCode(65 + x / 2)}${y / 2}`, (x + 0.5) * s, (y + 0.5) * s);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.flipY = false; // glTF UV convention
  return t;
}
const checkers = { uv0: null, uv1: null };

function applyMode(mode) {
  model.traverse((o) => {
    if (!o.isMesh) return;
    if (!originalMaterials.has(o)) originalMaterials.set(o, o.material);
    const orig = originalMaterials.get(o);
    if (mode === 'shaded' || mode === 'wire') {
      o.material = orig;
    } else if (mode === 'checker' || mode === 'uv1') {
      const key = mode === 'checker' ? 'uv0' : 'uv1';
      checkers[key] ??= checkerTexture(key === 'uv0' ? '' : 'L');
      const m = new THREE.MeshStandardMaterial({ map: checkers[key], roughness: 0.8 });
      if (mode === 'uv1') m.map.channel = 1;
      o.material = m;
    } else if (mode === 'normals') {
      o.material = new THREE.MeshNormalMaterial();
    } else if (mode === 'clay') {
      o.material = new THREE.MeshStandardMaterial({ color: '#b8b8b8', roughness: 0.7 });
    }
  });
  scene.getObjectByName('__wire')?.removeFromParent();
  if (mode === 'wire') {
    const wires = new THREE.Group();
    wires.name = '__wire';
    model.traverse((o) => {
      if (!o.isMesh) return;
      const w = new THREE.LineSegments(
        new THREE.WireframeGeometry(o.geometry),
        new THREE.LineBasicMaterial({ color: '#10141a', transparent: true, opacity: 0.45 }),
      );
      o.updateWorldMatrix(true, false);
      w.applyMatrix4(o.matrixWorld);
      wires.add(w);
    });
    scene.add(wires);
  }
}

const VIEWS = {
  front: new THREE.Vector3(0, 0.15, 1),
  back: new THREE.Vector3(0, 0.15, -1),
  right: new THREE.Vector3(1, 0.15, 0),
  left: new THREE.Vector3(-1, 0.15, 0),
  top: new THREE.Vector3(0, 1, 0.0001),
  bottom: new THREE.Vector3(0, -1, 0.0001),
  iso: new THREE.Vector3(1, 0.8, 1.25),
};

function cameraFor(view, aspect) {
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  if (typeof view === 'object') {
    // Custom camera matching the reference photo: { position, target, fov }
    const cam = new THREE.PerspectiveCamera(view.fov ?? 35, aspect, 0.01, 1000);
    cam.position.fromArray(view.position);
    cam.lookAt(new THREE.Vector3().fromArray(view.target ?? sphere.center.toArray()));
    return cam;
  }
  const fov = 30;
  const cam = new THREE.PerspectiveCamera(fov, aspect, 0.01, 1000);
  const dir = VIEWS[view].clone().normalize();
  const dist = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(fov / 2))) * 1.08;
  cam.position.copy(sphere.center).addScaledVector(dir, dist);
  cam.up.set(0, 1, 0);
  if (view === 'top' || view === 'bottom') cam.up.set(0, 0, -1);
  cam.lookAt(sphere.center);
  return cam;
}

window.studio = {
  async load(url) {
    if (model) {
      scene.remove(model);
      originalMaterials.clear();
    }
    const gltf = await loader.loadAsync(url);
    model = gltf.scene;
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = o.receiveShadow = true;
        // Multi-primitive nodes load as a Group of renamed meshes: tag LOD / collision from the
        // nearest ancestor carrying the suffix. Only LOD0 is part of the default look.
        let lodLevel = 0, col = false;
        for (let p = o; p; p = p.parent) {
          const m = /_LOD(\d)$/.exec(p.name);
          if (m) { lodLevel = Number(m[1]); break; }
          if (/_col$|-col(only)?$/.test(p.name)) { col = true; break; }
        }
        o.userData.tag = { lod: lodLevel, col };
        o.visible = !col && lodLevel === 0;
      }
    });
    scene.add(model);
    box = new THREE.Box3().setFromObject(model, true);
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z);
    ground.scale.setScalar(r * 20);
    ground.position.y = box.min.y;
    key.position.copy(box.getCenter(new THREE.Vector3())).add(new THREE.Vector3(r * 1.5, r * 3, r * 2));
    key.target.position.copy(box.getCenter(new THREE.Vector3()));
    const sc = key.shadow.camera;
    sc.left = sc.bottom = -r * 1.5;
    sc.right = sc.top = r * 1.5;
    sc.near = 0.01;
    sc.far = r * 10;
    sc.updateProjectionMatrix();
    fill.position.set(-r * 2, r, -r);
    let tris = 0;
    model.traverse((o) => { if (o.isMesh && o.visible) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    return { size: size.toArray(), min: box.min.toArray(), max: box.max.toArray(), triangles: tris };
  },

  /** @returns {string} PNG data URL */
  /** lod: which LOD to show (0 = render mesh); 'col' shows the collision mesh. */
  render({ view = 'front', mode = 'shaded', width = 768, height = 768, background = null, lod = 0 } = {}) {
    renderer.setSize(width, height, false);
    model.traverse((o) => {
      if (!o.isMesh) return;
      const { lod: level, col } = o.userData.tag;
      o.visible = lod === 'col' ? col : !col && level === lod;
    });
    scene.background = background ? new THREE.Color(background) : BG;
    applyMode(mode);
    ground.visible = view !== 'bottom';
    const cam = cameraFor(view, width / height);
    renderer.render(scene, cam);
    return renderer.domElement.toDataURL('image/png');
  },

  meshes() {
    const out = [];
    model?.traverse((o) => { if (o.isMesh) out.push([o.name, o.parent?.name, JSON.stringify(o.userData.tag), o.visible]); });
    return out;
  },

  info() {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  },
};
window.studioReady = true;
