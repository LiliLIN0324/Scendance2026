// 单件道具棚拍预览（缩略图 spike）。
// 用法：thumb-preview.html?glb=<file:// 绝对路径>
// 页面暴露 window.__thumb：status / meta / error / encode()。
// 布光与色彩档案对齐只读查看器 neutral 预设（render-look.ts）。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const canvas = document.getElementById('view');
const params = new URLSearchParams(location.search);
const glbUrl = params.get('glb');

window.__thumb = { status: 'loading', error: null, meta: null, encoded: null };

const SIZE = 256;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();

function mixHex(a, b, t) {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const ch = (x, y) => Math.round(x + (y - x) * t);
  return [ch(ar, br), ch(ag, bg), ch(ab, bb)];
}

function makeBackdrop(zenith, horizon) {
  const size = 256;
  const data = new Uint8Array(size * 4);
  for (let y = 0; y < size; y += 1) {
    const t = 1 - y / (size - 1);
    const blend = t < 0.65 ? (t / 0.65) * 0.7 : 0.7 + ((t - 0.65) / 0.35) * 0.3;
    const [r, g, b] = mixHex(zenith, horizon, blend);
    data[y * 4] = r; data[y * 4 + 1] = g; data[y * 4 + 2] = b; data[y * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, 1, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200);

// neutral 棚拍布光
const hemi = new THREE.HemisphereLight(0xe7f1ff, 0xd8d7d2, 1.35);
const ambient = new THREE.AmbientLight(0xe7f1ff, 0.18);
const key = new THREE.DirectionalLight(0xfff4de, 2.1);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.bias = -0.00025;
key.shadow.normalBias = 0.035;
scene.add(hemi, ambient, key, key.target);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.7;

// 阴影承接平面（帮助目检悬浮），不画实体地面。
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(50, 50),
  new THREE.ShadowMaterial({ opacity: 0.15 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

function frameModel(box, size) {
  const { width, depth, height } = size;
  key.position.set(width * 0.4 + 0.5, Math.max(height * 2.4, width * 0.75) + 0.5, depth * 0.3 + 0.5);
  key.target.position.set(0, height * 0.5, 0);
  const extent = Math.max(width, depth) * 0.7 + 2;
  Object.assign(key.shadow.camera, {
    left: -extent, right: extent, top: extent, bottom: -extent, far: Math.max(60, extent * 5),
  });
  key.shadow.camera.updateProjectionMatrix();

  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  const radius = sphere.radius || 0.5;
  const target = new THREE.Vector3(0, height * 0.5, 0);
  const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.08;
  const az = THREE.MathUtils.degToRad(35);
  const el = THREE.MathUtils.degToRad(28);
  camera.position.set(
    target.x + dist * Math.cos(el) * Math.sin(az),
    target.y + dist * Math.sin(el),
    target.z + dist * Math.cos(el) * Math.cos(az),
  );
  camera.lookAt(target);
}

if (!glbUrl) {
  window.__thumb.status = 'error';
  window.__thumb.error = '缺少 glb 参数';
} else {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  loader.load(glbUrl, (gltf) => {
    const model = gltf.scene;
    model.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    // 水平居中、底部贴 y=0。
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;
    scene.add(model);

    const dims = { width: size.x, depth: size.z, height: size.y };
    window.__thumb.meta = dims;
    frameModel(box, dims);
    renderer.render(scene, camera);
    window.__thumb.status = 'ready';
  }, undefined, (err) => {
    window.__thumb.status = 'error';
    window.__thumb.error = err?.message || String(err);
  });
}

window.__thumb.encode = async function encode() {
  if (window.__thumb.status !== 'ready') throw new Error(`模型未就绪：${window.__thumb.error ?? 'unknown'}`);
  renderer.render(scene, camera);
  const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob 返回空'))), 'image/webp', 0.85));
  const buf = await blob.arrayBuffer();
  window.__thumb.encoded = { type: blob.type, bytes: buf.byteLength };
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return `data:${blob.type};base64,${btoa(bin)}`;
};
