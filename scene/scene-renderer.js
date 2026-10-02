/**
 * Scene renderer — light template.
 *
 *   - infinite anti-aliased ground grid (procedural, no texture)
 *   - fixed daylight: a hemisphere fill plus one directional sun with shadows
 *   - placed models are selectable and draggable on the grid
 *   - a persistent local model cache so a repeat drop is instant
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const SHADOW_RADIUS = 30;
const SHADOW_MAP_SIZE = 2048;

/**
 * Grid geometry size, in metres. The mesh follows the camera and is far smaller
 * than the old 3000 m plane on purpose:
 *
 *  - fragments beyond the fog are invisible but still cost fill rate;
 *  - `fwidth` differentiates the world position, so at kilometre-scale distances
 *    the float precision of `vWorld` is poor enough that the computed line width
 *    wobbles — which reads as a shimmering grid while the camera or a model moves.
 *
 * 600 m half-extent (300 m) covers the furthest visible ground at the capped
 * orbit distance, so the mesh edge is never in frame.
 */
const GRID_SIZE = 600;

/** The grid snaps to this period, so recentring never makes lines slide. */
const GRID_SNAP = 1;

/**
 * How far from the origin a model may be placed or dragged, in metres. Kept
 * inside the shadow camera's footprint so a model can never be dragged to a spot
 * where its shadow would silently disappear.
 */
const PLACEMENT_LIMIT = SHADOW_RADIUS * 1.15;

/** Light palette. Kept neutral so model materials read as their own colour. */
const PALETTE = {
  canvas: 0xeef2f6,
  fog: 0xeef2f6,
  // Grid lines sit only a little darker than the canvas: the brief is a quiet
  // planning surface, not a graph-paper backdrop.
  gridFine: 0xd3dce5,
  gridCoarse: 0xb3c1cf,
  gridAxis: 0x8fa8c4,
  sun: 0xfff4e2,
  skyFill: 0xdce9f7,
  groundFill: 0xb9b3a6,
};

const GRID_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/**
 * Screen-space anti-aliased grid.
 *
 * Two things make a ground grid flicker, and both are fixed here:
 *
 *  1. A hard coverage threshold. `fwidth` alone keeps the line one pixel wide but
 *     leaves the edge binary, so as the camera moves a pixel flips between full
 *     and zero coverage — that is the shimmer. The coverage here is a smoothstep
 *     ramp, i.e. analytic AA, so an edge crossing a pixel is a gradient.
 *
 *  2. Lines thinner than a pixel in the distance. Screen-space line width is
 *     `linePx = 2 * lineHalf / fwidth(coord)`, so it shrinks with distance and
 *     aliases into moiré. Each level widens back to `uMinLinePx` and is faded out
 *     by its own pixel spacing, so the grid dissolves smoothly rather than
 *     shimmering. That replaces the old distance fades, which fought the shader.
 */
const GRID_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec3 vWorld;
  uniform vec3 uFine;
  uniform vec3 uCoarse;
  uniform vec3 uAxis;
  uniform float uOpacity;
  uniform float uMajor;
  uniform float uLinePx;
  uniform float uFeatherPx;
  uniform float uFineFadeStartPx;
  uniform float uFineFadeEndPx;
  uniform float uCoarseFadeStartPx;
  uniform float uCoarseFadeEndPx;
  uniform float uAxisWidth;

  // Coverage of the nearest line, in pixel space.
  //
  // d is the distance to the nearest line measured in pixels, per axis, so the
  // derivative already accounts for a grazing view where the depth axis is
  // compressed. The ramp is uFeatherPx wide rather than one pixel: a 1-pixel ramp
  // is a binary edge for practical purposes, and a binary edge is exactly what
  // makes a grid crawl as the camera moves. (No backticks or block comments in
  // here: this text lives inside a JS template literal.)
  float gridCoverage(vec2 coord, float linePx, float featherPx) {
    vec2 d = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
    float edge = min(d.x, d.y);
    return 1.0 - smoothstep(linePx * 0.5 - featherPx * 0.5, linePx * 0.5 + featherPx * 0.5, edge);
  }

  // Pixels between this level's lines; drives the fade into the distance.
  float spacingPx(float worldSpacing) {
    return worldSpacing / max(fwidth(vWorld.x) + fwidth(vWorld.z), 1e-5) * 2.0;
  }

  void main() {
    vec2 coord = vWorld.xz;
    float fineSpacing = spacingPx(1.0);
    float coarseSpacing = spacingPx(uMajor);

    // Each level fades out as its own lines approach the pixel grid. The fine
    // level needs its own thresholds: 0.2 m cells are five times denser than 1 m
    // ones, so reusing the coarse band would erase them almost immediately.
    float fineFade = smoothstep(uFineFadeStartPx, uFineFadeEndPx, fineSpacing);
    float coarseFade = smoothstep(uCoarseFadeStartPx, uCoarseFadeEndPx, coarseSpacing);

    float fine = gridCoverage(coord / 0.2, uLinePx, uFeatherPx) * fineFade;
    float coarse = gridCoverage(coord / uMajor, uLinePx, uFeatherPx) * coarseFade;

    // The fine level fills in around the coarse one instead of stacking on top of
    // it, so a coarse line is never twice as dark as a fine one.
    float fineOnly = fine * (1.0 - coarse);
    vec3 color = mix(uCoarse, uFine, fineOnly / max(coarse + fineOnly, 1e-4));
    float alpha = max(coarse, fineOnly * 0.85);

    vec2 axis = abs(coord) / fwidth(coord);
    float axisCoverage = 1.0 - smoothstep(uAxisWidth * 0.5 - uFeatherPx * 0.5, uAxisWidth * 0.5 + uFeatherPx * 0.5, min(axis.x, axis.y));
    axisCoverage *= coarseFade;
    color = mix(color, uAxis, axisCoverage);
    alpha = max(alpha, axisCoverage);

    alpha *= uOpacity;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

export class SceneRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ onSelection?: (model: object | null) => void, onStatus?: (text: string, kind?: string) => void }} hooks
   */
  constructor(canvas, { onSelection, onStatus } = {}) {
    if (!canvas?.getContext) throw new Error('SceneRenderer 需要一个 canvas。');
    this.canvas = canvas;
    this.onSelection = typeof onSelection === 'function' ? onSelection : () => {};
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};

    this.destroyed = false;
    this.dirty = true;
    this.frame = null;

    this.modelCache = new Map();   // url -> { source, size, offset }
    this.loading = new Map();      // url -> Promise, so two drops share one fetch
    this.placed = [];              // { group, spec }
    this.selected = null;

    /* ---------------------------------------------------------- renderer */
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.canvas);
    // Fog matches the background so the grid dissolves instead of ending. It is
    // also what hides the edge of the (finite) grid mesh.
    this.scene.fog = new THREE.Fog(PALETTE.fog, 40, 170);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 800);
    this.camera.position.set(11, 8.5, 13);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.085;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.controls.minDistance = 1.2;
    // Kept inside the grid and fog range: past this the mesh edge would show.
    this.controls.maxDistance = 150;
    this.controls.target.set(0, 0.6, 0);
    this.controls.addEventListener('change', () => this.invalidate());

    this.modelGroup = new THREE.Group();
    this.modelGroup.name = 'Placed models';
    this.scene.add(this.modelGroup);

    this.buildGrid();
    this.buildShadowCatcher();
    this.buildLights();
    this.buildSelectionHelper();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.bindEvents();

    this.observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    if (this.observer) this.observer.observe(canvas);
    else window.addEventListener('resize', this.handlers.resize);

    this.resize();
    this.invalidate();
  }

  /**
   * Keep the small grid mesh under the camera, snapped to the line period.
   *
   * The grid pattern is periodic, so translating the mesh by a whole number of
   * periods reproduces the identical image — the lines do not slide, they just
   * stay centred. That is what lets a 400 m mesh read as an infinite ground while
   * keeping `vWorld` small enough for `fwidth` to stay accurate.
   */
  recentreGrid() {
    const target = this.controls.target;
    const snappedX = Math.round(target.x / GRID_SNAP) * GRID_SNAP;
    const snappedZ = Math.round(target.z / GRID_SNAP) * GRID_SNAP;
    if (snappedX === this.grid.position.x && snappedZ === this.grid.position.z) return false;
    this.grid.position.x = snappedX;
    this.grid.position.z = snappedZ;
    return true;
  }

  /* ----------------------------------------------------------------- grid */

  buildGrid() {
    const geometry = new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    this.gridMaterial = new THREE.ShaderMaterial({
      vertexShader: GRID_VERTEX,
      fragmentShader: GRID_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      uniforms: {
        uFine: { value: new THREE.Color(PALETTE.gridFine) },
        uCoarse: { value: new THREE.Color(PALETTE.gridCoarse) },
        uAxis: { value: new THREE.Color(PALETTE.gridAxis) },
        uOpacity: { value: 0.34 },
        // 0.2 m cells with a 1 m major line.
        uMajor: { value: 5 },
        // Thin and softly feathered: 1.0 px wide with a 1.1 px ramp reads as a
        // quiet guide rather than graph paper. resize() scales these by DPR.
        uLinePx: { value: 1.0 },
        uFeatherPx: { value: 1.1 },
        // The 0.2 m level and the 1 m level need separate fade bands: the fine
        // level is five times denser, so it must start fading much sooner.
        uFineFadeStartPx: { value: 1.15 },
        uFineFadeEndPx: { value: 3.0 },
        uCoarseFadeStartPx: { value: 1.2 },
        uCoarseFadeEndPx: { value: 2.6 },
        uAxisWidth: { value: 1.6 },
      },
    });
    this.grid = new THREE.Mesh(geometry, this.gridMaterial);
    this.grid.name = 'Grid';
    // A hair above the shadow catcher: two coplanar transparent surfaces z-fight,
    // which itself reads as a flickering grid while the camera moves.
    this.grid.position.y = 0.004;
    this.grid.renderOrder = 2;
    this.scene.add(this.grid);
  }

  /** Receives the sun's shadow without drawing a visible floor. */
  buildShadowCatcher() {
    // Sized to the shadow camera: any larger only adds fragments that can never
    // receive a shadow, because the sun's frustum does not reach them.
    this.shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(SHADOW_RADIUS * 2.4, SHADOW_RADIUS * 2.4),
      new THREE.ShadowMaterial({ opacity: 0.26 })
    );
    this.shadowCatcher.rotation.x = -Math.PI / 2;
    this.shadowCatcher.name = 'Shadow catcher';
    this.shadowCatcher.receiveShadow = true;
    this.scene.add(this.shadowCatcher);
  }

  /* --------------------------------------------------------------- lights */

  buildLights() {
    // One sun, fixed to a pleasant mid-morning angle so every model gets a
    // readable key light and a directional shadow.
    this.sun = new THREE.DirectionalLight(PALETTE.sun, 2.6);
    this.sun.position.set(14, 20, 10);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    const cam = this.sun.shadow.camera;
    cam.left = -SHADOW_RADIUS;
    cam.right = SHADOW_RADIUS;
    cam.top = SHADOW_RADIUS;
    cam.bottom = -SHADOW_RADIUS;
    cam.near = 0.5;
    cam.far = 120;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.022;
    this.scene.add(this.sun, this.sun.target);
    this.sun.target.position.set(0, 0, 0);

    // Hemisphere fill: bright sky above, warm ground bounce below. This is what
    // keeps shaded faces readable instead of black, and it needs no environment
    // map, which keeps startup instant.
    this.fill = new THREE.HemisphereLight(PALETTE.skyFill, PALETTE.groundFill, 1.5);
    this.scene.add(this.fill);

    // A soft counter-light stops the shadow side from going flat.
    this.bounce = new THREE.DirectionalLight(0xdfe8f2, 0.42);
    this.bounce.position.set(-12, 8, -9);
    this.scene.add(this.bounce);
  }

  /* ------------------------------------------------------------ selection */

  buildSelectionHelper() {
    this.selectionBox = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(PALETTE.gridAxis));
    this.selectionBox.visible = false;
    this.selectionBox.material.depthTest = false;
    this.selectionBox.material.transparent = true;
    this.selectionBox.material.opacity = 0.9;
    this.selectionBox.renderOrder = 3;
    this.scene.add(this.selectionBox);
  }

  setSelected(entry) {
    this.selected = entry ?? null;
    if (!this.selected) {
      this.selectionBox.visible = false;
    } else {
      const box = new THREE.Box3().setFromObject(this.selected.group);
      box.expandByScalar(0.02);
      this.selectionBox.box.copy(box);
      this.selectionBox.visible = true;
    }
    this.onSelection(this.selected ? { name: this.selected.spec.name, index: this.placed.indexOf(this.selected) } : null);
    this.invalidate();
  }

  /** Nearest placed model under a client point, or null. */
  pickPlaced(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const roots = this.placed.map(entry => entry.group);
    const hits = this.raycaster.intersectObjects(roots, true);
    if (!hits.length) return null;
    // Walk up to the group that owns the instance.
    let node = hits[0].object;
    while (node && node.parent !== this.modelGroup) node = node.parent;
    return this.placed.find(entry => entry.group === node) ?? null;
  }

  /** Screen point on the grid plane (y = 0), or null when the ray misses. */
  groundPointFromClient(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    return {
      x: Math.min(PLACEMENT_LIMIT, Math.max(-PLACEMENT_LIMIT, hit.x)),
      z: Math.min(PLACEMENT_LIMIT, Math.max(-PLACEMENT_LIMIT, hit.z)),
    };
  }

  /* ----------------------------------------------------------------- model */

  /** Load a GLB once; concurrent callers share the same request. */
  loadModel(url) {
    if (this.modelCache.has(url)) return Promise.resolve(this.modelCache.get(url));
    if (this.loading.has(url)) return this.loading.get(url);
    const request = (async () => {
      const gltf = await new GLTFLoader().loadAsync(url);
      const source = gltf.scene;
      source.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(source);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      if (![size.x, size.y, size.z].every(v => Number.isFinite(v) && v > 1e-5)) {
        throw new Error('模型尺寸无效');
      }
      const entry = { source, size, offset: new THREE.Vector3(-center.x, -bounds.min.y, -center.z) };
      this.modelCache.set(url, entry);
      return entry;
    })();
    // Clear the in-flight marker on both outcomes so a failure can be retried.
    const settled = request.finally(() => this.loading.delete(url));
    this.loading.set(url, settled);
    return settled;
  }

  /** Fresh geometry per instance so disposing one copy cannot break another. */
  instantiate(entry) {
    const instance = entry.source.clone(true);
    instance.traverse(node => {
      if (!node.isMesh) return;
      node.geometry = node.geometry.clone();
      node.material = Array.isArray(node.material)
        ? node.material.map(material => material.clone())
        : node.material.clone();
      node.castShadow = true;
      node.receiveShadow = true;
    });
    instance.position.copy(entry.offset);
    return instance;
  }

  /** Drop a model at a grid position, scaled to the size the toolbar advertises. */
  async placeModel(spec, point) {
    if (!spec?.glb) throw new Error('模型信息不完整');
    const entry = await this.loadModel(spec.glb);
    if (this.destroyed) throw new Error('场景已关闭');
    const width = Number(spec.width) || entry.size.x;
    const depth = Number(spec.depth) || entry.size.z;
    const height = Number(spec.height) || entry.size.y;
    const position = point ?? { x: 0, z: 0 };

    const group = new THREE.Group();
    group.name = spec.name || '模型';
    group.position.set(position.x, 0, position.z);
    group.scale.set(width / entry.size.x, height / entry.size.y, depth / entry.size.z);
    group.add(this.instantiate(entry));

    this.modelGroup.add(group);
    const record = { group, spec, glb: spec.glb };
    this.placed.push(record);
    this.renderer.shadowMap.needsUpdate = true;
    this.invalidate();
    return record;
  }

  placeModelFromClient(clientX, clientY, spec) {
    return this.placeModel(spec, this.groundPointFromClient(clientX, clientY));
  }

  /**
   * Move a placed model to a new grid position (used by drag-to-move).
   *
   * `options.live` is set while the pointer is still moving. A shadow-map rebuild
   * is a full extra 2048x2048 depth pass; doing that on every pointermove stalls
   * the frame and shows up as a stutter exactly when dragging. During a live drag
   * the shadow therefore lags by one frame and is refreshed once on pointerup,
   * which is invisible at pointer speed and keeps the motion smooth.
   */
  moveModel(record, point, options = {}) {
    if (!record) return;
    record.group.position.set(
      Math.min(PLACEMENT_LIMIT, Math.max(-PLACEMENT_LIMIT, point.x)),
      0,
      Math.min(PLACEMENT_LIMIT, Math.max(-PLACEMENT_LIMIT, point.z))
    );
    if (record === this.selected) {
      const box = new THREE.Box3().setFromObject(record.group);
      box.expandByScalar(0.02);
      this.selectionBox.box.copy(box);
    }
    if (options.live !== true) this.renderer.shadowMap.needsUpdate = true;
    this.invalidate();
  }

  /** Refresh the shadow map once, after a drag or any other burst of movement. */
  refreshShadows() {
    this.renderer.shadowMap.needsUpdate = true;
    this.invalidate();
  }

  removeModel(record) {
    const index = record ? this.placed.indexOf(record) : this.placed.length - 1;
    if (index < 0) return null;
    const entry = this.placed[index];
    this.placed.splice(index, 1);
    this.modelGroup.remove(entry.group);
    entry.group.traverse(node => {
      if (!node.isMesh) return;
      node.geometry?.dispose?.();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
        material.dispose?.();
      }
    });
    if (this.selected === entry) this.setSelected(null);
    this.renderer.shadowMap.needsUpdate = true;
    this.invalidate();
    return entry.spec.name;
  }

  clearModels() {
    let removed = 0;
    while (this.placed.length) {
      this.removeModel(this.placed[this.placed.length - 1]);
      removed++;
    }
    return removed;
  }

  /** Frame everything placed, or the grid origin when the scene is empty. */
  frameAll() {
    const box = new THREE.Box3();
    if (this.placed.length) for (const entry of this.placed) box.expandByObject(entry.group);
    else box.setFromCenterAndSize(new THREE.Vector3(0, 0.6, 0), new THREE.Vector3(8, 4, 8));
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(1.4, size.length() * 0.62);
    const distance = radius / Math.tan((this.camera.fov * Math.PI) / 360);
    const direction = new THREE.Vector3(0.9, 0.66, 1).normalize();
    this.camera.position.copy(center).addScaledVector(direction, distance * 1.2);
    this.controls.target.copy(center);
    this.controls.update();
    this.invalidate();
  }

  /* --------------------------------------------------------------- events */

  resize() {
    if (this.destroyed) return;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // `fwidth` measures in device pixels, so the pixel-space uniforms have to
    // scale with the ratio or the grid is half as thick on a retina display.
    const u = this.gridMaterial.uniforms;
    u.uLinePx.value = 1.0 * ratio;
    u.uFeatherPx.value = 1.1 * ratio;
    u.uFineFadeStartPx.value = 1.15 * ratio;
    u.uFineFadeEndPx.value = 3.0 * ratio;
    u.uCoarseFadeStartPx.value = 1.2 * ratio;
    u.uCoarseFadeEndPx.value = 2.6 * ratio;
    u.uAxisWidth.value = 1.6 * ratio;
    this.renderer.shadowMap.needsUpdate = true;
    this.invalidate();
  }

  bindEvents() {
    this.handlers = { resize: () => this.resize() };
    document.addEventListener('visibilitychange', this.handlers.visibility = () => this.invalidate());
  }

  invalidate() {
    if (this.destroyed) return;
    this.dirty = true;
    if (this.frame === null) this.frame = requestAnimationFrame(() => this.tick());
  }

  tick() {
    this.frame = null;
    if (this.destroyed) return;
    const changed = this.controls.update();
    // Keep the small mesh under the camera; returns true only when it moved a
    // whole period, so this does not force a redraw on its own.
    const recentred = this.recentreGrid();
    if (this.dirty || changed || recentred) {
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
    if (changed) this.invalidate();
  }

  dispose() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    window.removeEventListener('resize', this.handlers.resize);
    document.removeEventListener('visibilitychange', this.handlers.visibility);
    this.clearModels();
    this.controls.dispose();
    this.gridMaterial.dispose();
    this.grid.geometry.dispose();
    this.shadowCatcher.geometry.dispose();
    this.shadowCatcher.material.dispose();
    this.renderer.dispose();
  }
}

/** Metres as the tile shows them. */
export function formatSize(width, depth, height) {
  const f = v => (Math.round(v * 100) / 100).toFixed(2);
  return `${f(width)} × ${f(depth)} × ${f(height)} m`;
}
