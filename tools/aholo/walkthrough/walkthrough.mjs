/**
 * Aholo World 3DGS 场景漫游实验页：直接把 frontend/public/showcase 里的 Aholo 场景
 * 用 three + @sparkjsdev/spark 打开，第一人称 WASD + 鼠标在公司场地里走。
 *
 * 这是本地实验，不属于产品构建：不上云、不扣 Aholo 额度、不读数据库。
 * 米制口径与 frontend/components/room-organizer/three/splat-preview.ts 对齐：
 * World 产物按真实米制处理，Z-up 转 Y-up，底面贴 y=0、水平中心归零。
 *
 * 交互分两种：能拿到 Pointer Lock 就用锁定鼠标（像 FPS）；拿不到（某些内嵌浏览器/iframe
 * 会禁 pointer-lock）就退化成「按住鼠标拖动转头」，WASD 一样能走。
 */
import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '../../../frontend/node_modules/@sparkjsdev/spark/dist/spark.module.js';

const ASSET_ROOT = '../../../frontend/public/showcase/assets/generated';
const SCENES = [
  { id: 'banquet-a', name: '宴会厅 A', worldId: '3FO4K4QI6N4V', file: 'scene/scendance-m3-mvp.spz' },
  { id: 'launch-hall', name: '发布会小厅', worldId: '3FO4K4RHLLV9', file: 'scene/small-launch-hall.spz' },
  { id: 'banquet-b', name: '宴会厅 B', worldId: '3FO4K4RI3SQE', file: 'scene/cloud-e2e-banquet.spz' },
];

const EYE_HEIGHT = 1.6;
const WALK_SPEED = 2.6;
const RUN_MULTIPLIER = 2.6;
const LOOK_SENSITIVITY = 0.0022;
const DRAG_SENSITIVITY = 0.0042;
const EDGE_PAD = 0.35;

const view = document.getElementById('view');
const overlay = document.getElementById('overlay');
const overlayTitle = overlay.querySelector('h1');
const overlayHint = overlay.querySelector('p');
const progress = document.getElementById('progress');
const hud = document.getElementById('hud');
const status = document.getElementById('status');
const sceneButtons = document.getElementById('scene-buttons');
const lockToggle = document.getElementById('lock-toggle');
const roamExit = document.getElementById('roam-exit');

function setStatus(text, isError = false) {
  status.textContent = text;
  status.classList.toggle('error', isError);
}

/** 任何把页面搞死的情况都在页面上说出来，省得用户只看到一张不动的图。 */
function fatal(message) {
  setStatus(message, true);
  overlay.classList.remove('hidden');
  overlayTitle.textContent = '页面起不来';
  overlayHint.textContent = message;
}

window.addEventListener('error', event => fatal(`脚本错误：${event.message || '未知错误'}（${event.filename}:${event.lineno}）`));
window.addEventListener('unhandledrejection', event => {
  const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
  fatal(`未处理的异常：${reason}`);
});

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: view, antialias: false, powerPreference: 'high-performance' });
} catch (failure) {
  fatal(`这台浏览器拿不到 WebGL：${failure instanceof Error ? failure.message : String(failure)}`);
  throw failure;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d10);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 500);

// Spark 在自己挂进场景后接管 3DGS 的排序与绘制；autoUpdate 让它每帧自行刷新。
const spark = new SparkRenderer({ renderer });
spark.autoUpdate = true;
scene.add(spark);

const state = {
  sceneId: '',
  mesh: null,
  holder: null,
  bounds: null,
  yaw: 0,
  pitch: 0,
  loading: false,
  generation: 0,
  /** idle：说明页；pointer：鼠标锁定；drag：按住拖动转头（pointer-lock 不可用时的兜底）。 */
  mode: 'idle',
  dragging: false,
  lastX: 0,
  lastY: 0,
  frames: 0,
  fpsAt: 0,
  fps: 0,
};

/** 按下的键；指针锁定被释放时可能收不到 keyup，所以统一在 blur / 退出时清空。 */
const keys = new Set();

// ---------- 与产品一致的取样 / 旋转 / 包围盒 ----------

function percentile(values, ratio) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(ratio * (sorted.length - 1))))];
}

function robustBox(centers, ratio = 0.01) {
  if (!centers.length) return null;
  const axis = pick => centers.map(pick);
  const at = (pick, quantile) => percentile(axis(pick), quantile) ?? 0;
  const min = new THREE.Vector3(at(v => v.x, ratio), at(v => v.y, ratio), at(v => v.z, ratio));
  const max = new THREE.Vector3(at(v => v.x, 1 - ratio), at(v => v.y, 1 - ratio), at(v => v.z, 1 - ratio));
  return [min, max].every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) &&
    max.x >= min.x && max.y >= min.y && max.z >= min.z
    ? new THREE.Box3(min, max)
    : null;
}

/** Aholo World 产物是 Z-up：绕 X 转 -90° 才和 three 的 Y-up 对齐。 */
function upAxisQuaternion(upAxis) {
  const euler = upAxis === 'Z' ? new THREE.Euler(-Math.PI / 2, 0, 0) :
    upAxis === 'X' ? new THREE.Euler(0, 0, Math.PI / 2) : new THREE.Euler(0, 0, 0);
  return new THREE.Quaternion().setFromEuler(euler);
}

function rotatedBox(box, quaternion) {
  const result = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        result.expandByPoint(point.set(x, y, z).applyQuaternion(quaternion));
      }
    }
  }
  return result;
}

function sampleCenters(splat, maxSamples = 20000) {
  const step = Math.max(1, Math.floor((splat.numSplats ?? 0) / maxSamples));
  const centers = [];
  splat.forEachSplat((index, center) => {
    if (index % step === 0) centers.push(center.clone());
  });
  return centers;
}

// ---------- UI ----------

function syncButtons() {
  for (const button of sceneButtons.querySelectorAll('button')) {
    button.classList.toggle('on', button.dataset.id === state.sceneId);
  }
}

function syncHud() {
  if (!state.bounds) {
    hud.textContent = state.loading ? '正在解码点云 / LoD…' : '未加载场景';
    return;
  }
  const size = state.bounds.getSize(new THREE.Vector3());
  hud.textContent = [
    `场景  ${SCENES.find(s => s.id === state.sceneId)?.name ?? state.sceneId}  ·  ${state.mesh?.numSplats ?? 0} splats`,
    `实测  ${size.x.toFixed(1)} × ${size.z.toFixed(1)} m  ·  高 ${size.y.toFixed(1)} m`,
    `站位  x ${camera.position.x.toFixed(1)}  z ${camera.position.z.toFixed(1)}  ·  ${state.fps} fps`,
  ].join('\n');
}

function buildButtons() {
  for (const item of SCENES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.dataset.id = item.id;
    button.textContent = item.name;
    button.addEventListener('click', () => { void loadScene(item.id); });
    sceneButtons.appendChild(button);
  }
}

// ---------- 加载 ----------

function release() {
  if (state.holder) {
    state.holder.removeFromParent();
    state.holder = null;
  }
  if (state.mesh) {
    state.mesh.dispose();
    state.mesh = null;
  }
  state.bounds = null;
}

async function loadScene(id) {
  if (state.loading) return;
  const item = SCENES.find(s => s.id === id);
  if (!item) return;
  state.loading = true;
  const generation = ++state.generation;
  state.sceneId = id;
  syncButtons();
  syncHud();
  setStatus('正在从本机静态目录读取 Aholo 场景…');
  progress.style.width = '0%';

  try {
    release();
    const mesh = new SplatMesh({
      url: `${ASSET_ROOT}/${item.file}`,
      onProgress: event => {
        if (generation !== state.generation) return;
        const ratio = event.total > 0 ? event.loaded / event.total : 0;
        progress.style.width = `${Math.round(Math.min(1, ratio) * 100)}%`;
      },
    });
    await mesh.initialized;
    if (generation !== state.generation) {
      mesh.dispose();
      return;
    }

    const local = robustBox(sampleCenters(mesh));
    if (!local) {
      mesh.dispose();
      throw new Error('点云没有有效包围盒，无法摆放。');
    }
    mesh.quaternion.copy(upAxisQuaternion('Z'));
    const rotated = rotatedBox(local, mesh.quaternion);
    const center = rotated.getCenter(new THREE.Vector3());
    // 米制不缩放：底面贴 y=0，水平中心归零，和产品环境预览同一套口径。
    const holder = new THREE.Group();
    holder.position.set(-center.x, -rotated.min.y, -center.z);
    holder.add(mesh);
    scene.add(holder);

    state.holder = holder;
    state.mesh = mesh;
    state.bounds = new THREE.Box3(
      rotated.min.clone().add(holder.position),
      rotated.max.clone().add(holder.position)
    );

    // 站位：场景水平中心、眼高 1.6 m，朝 −Z 看。
    camera.position.set(0, state.bounds.min.y + EYE_HEIGHT, THREE.MathUtils.clamp(0, state.bounds.min.z + EDGE_PAD, state.bounds.max.z - EDGE_PAD));
    state.yaw = 0;
    state.pitch = 0;
    applyLook();

    syncHud();
    setStatus('已载入。点画面进入漫游。');
    overlayTitle.textContent = '进入 Aholo 场景漫游';
    overlayHint.textContent = '点画面开始：默认不锁鼠标，按住左键拖动转头，光标一直在。要 FPS 手感再点顶栏「锁定鼠标（FPS）」。';
    overlay.classList.remove('hidden');
  } catch (failure) {
    setStatus(`加载失败：${failure instanceof Error ? failure.message : String(failure)}`, true);
  } finally {
    if (generation === state.generation) state.loading = false;
    syncHud();
  }
}

// ---------- 漫游 ----------

function applyLook() {
  camera.quaternion.setFromEuler(new THREE.Euler(state.pitch, state.yaw, 0, 'YXZ'));
}

function setMode(mode, hint) {
  state.mode = mode;
  if (mode === 'idle') {
    overlay.classList.remove('hidden');
    state.dragging = false;
  }
  if (hint) setStatus(hint);
}

function enterRoam() {
  if (!state.bounds) {
    setStatus('场景还没载入完，稍等一下再点。', true);
    return;
  }
  overlay.classList.add('hidden');
  // 默认不锁鼠标：光标一直看得见，按住左键拖动转头。要 FPS 手感再点顶栏「锁定鼠标（FPS）」。
  setMode('drag', '漫游中：按住左键拖动转头，WASD 移动，Shift 加速；Esc 回到说明页。');
}

overlay.addEventListener('click', enterRoam);

function toggleLock() {
  if (document.pointerLockElement === view) {
    document.exitPointerLock();
    return;
  }
  try {
    const request = view.requestPointerLock?.();
    if (request && typeof request.catch === 'function') {
      request.catch(() => setStatus('这个浏览器不允许锁定鼠标；继续用「按住左键拖动」即可。', true));
    }
  } catch {
    setStatus('这个浏览器不允许锁定鼠标；继续用「按住左键拖动」即可。', true);
  }
}

lockToggle.addEventListener('click', toggleLock);
roamExit.addEventListener('click', () => {
  if (document.pointerLockElement === view) document.exitPointerLock();
  setMode('idle', '已退出漫游。点画面重新进入。');
});

document.addEventListener('pointerlockchange', () => {
  // 释放鼠标时可能收不到 keyup：清掉按键，免得退出后相机自己漂。
  keys.clear();
  state.dragging = false;
  if (document.pointerLockElement === view) {
    lockToggle.textContent = '取消锁定（Esc）';
    setMode('pointer', 'FPS 模式：WASD 移动，鼠标转向，Shift 加速，Esc 释放鼠标。');
  } else {
    lockToggle.textContent = '锁定鼠标（FPS）';
    // 从 FPS 模式退出来时继续留在漫游里（拖动转头），光标立刻回到屏幕上。
    setMode('drag', '鼠标已释放，光标回来了。按住左键拖动转头，Esc 回到说明页。');
  }
});

// 拖动转头：pointer-lock 不可用时的兜底，也顺便让「点了没反应」变成能用的交互。
view.addEventListener('mousedown', event => {
  if (event.button !== 0) return;
  if (state.mode === 'idle') { enterRoam(); return; }
  state.dragging = true;
  state.lastX = event.clientX;
  state.lastY = event.clientY;
});
window.addEventListener('mouseup', () => { state.dragging = false; });
window.addEventListener('blur', () => { state.dragging = false; keys.clear(); });

document.addEventListener('mousemove', event => {
  if (document.pointerLockElement === view) {
    state.yaw -= event.movementX * LOOK_SENSITIVITY;
    state.pitch = THREE.MathUtils.clamp(state.pitch - event.movementY * LOOK_SENSITIVITY, -1.35, 1.35);
    applyLook();
    return;
  }
  if (!state.dragging) return;
  const dx = event.clientX - state.lastX;
  const dy = event.clientY - state.lastY;
  state.lastX = event.clientX;
  state.lastY = event.clientY;
  state.yaw -= dx * DRAG_SENSITIVITY;
  state.pitch = THREE.MathUtils.clamp(state.pitch - dy * DRAG_SENSITIVITY, -1.35, 1.35);
  applyLook();
});

window.addEventListener('keydown', event => {
  if (event.code === 'Escape') {
    if (document.pointerLockElement === view) {
      document.exitPointerLock();
    } else if (state.mode !== 'idle') {
      setMode('idle', '已回到说明页。点画面继续。');
    }
    return;
  }
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
    event.preventDefault();
    keys.add(event.code);
  }
});
window.addEventListener('keyup', event => keys.delete(event.code));

view.addEventListener('contextmenu', event => event.preventDefault());

function moveCamera(deltaSeconds) {
  if (!state.bounds) return;
  // 说明页上按 WASD 不应让相机偷跑。
  if (state.mode === 'idle') return;
  const speed = WALK_SPEED * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN_MULTIPLIER : 1) * deltaSeconds;
  let forward = 0;
  let strafe = 0;
  if (keys.has('KeyW')) forward += 1;
  if (keys.has('KeyS')) forward -= 1;
  if (keys.has('KeyD')) strafe += 1;
  if (keys.has('KeyA')) strafe -= 1;
  if (!forward && !strafe) return;
  const sin = Math.sin(state.yaw);
  const cos = Math.cos(state.yaw);
  const dx = (-sin * forward + cos * strafe) * speed;
  const dz = (-cos * forward - sin * strafe) * speed;
  const bounds = state.bounds;
  camera.position.x = THREE.MathUtils.clamp(camera.position.x + dx, bounds.min.x + EDGE_PAD, bounds.max.x - EDGE_PAD);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z + dz, bounds.min.z + EDGE_PAD, bounds.max.z - EDGE_PAD);
  // 眼高固定贴地走，不飞出去；底面就是 splat 自己的地面。
  camera.position.y = bounds.min.y + EYE_HEIGHT;
}

// ---------- 主循环 ----------

let last = performance.now();
function tick(now) {
  const delta = Math.min(0.1, (now - last) / 1000);
  last = now;
  moveCamera(delta);
  renderer.render(scene, camera);

  state.frames += 1;
  if (now - state.fpsAt >= 500) {
    state.fps = Math.round((state.frames * 1000) / (now - state.fpsAt));
    state.frames = 0;
    state.fpsAt = now;
    syncHud();
  }
  requestAnimationFrame(tick);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

buildButtons();
syncHud();
setStatus('准备中…');
requestAnimationFrame(tick);
void loadScene(SCENES[0].id);