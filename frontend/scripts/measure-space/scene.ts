/**
 * 布置实测的渲染夹具：同一台相机、同一套目录，分别渲染「改前 / 改后」。
 * 改前 = 建模原始模型直接放在 y=0（不核对尺寸、不对底面）；改后 = 编辑器实际用的对表模型。
 */
import * as THREE from 'three';
import { FURNITURE_CATALOG } from '../../components/room-organizer/lib/constants';
import { createFurnitureModel } from '../../components/room-organizer/three/furniture-builders';
import type { FurnitureItem } from '../../components/room-organizer/lib/types';

const TYPES = ['chair', 'table', 'sofa', 'floor-lamp', 'rose-bush', 'bbq'];
const A4 = { width: 0.297, depth: 0.210 };

export function mount(mode: 'before' | 'after'): void {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(900, 760, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0d1117');
  const camera = new THREE.PerspectiveCamera(40, 900 / 760, 0.1, 100);
  camera.position.set(5.9, 3.5, 7.4);
  camera.lookAt(0, 0.45, 0.9);

  scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x1a2028, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(4, 9, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -8;
  sun.shadow.camera.right = 8;
  sun.shadow.camera.top = 8;
  sun.shadow.camera.bottom = -8;
  scene.add(sun);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(13, 9),
    new THREE.MeshStandardMaterial({ color: 0x1b2028, roughness: 0.95 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(12, 12, 0x38414d, 0x262d36);
  grid.position.y = 0.002;
  scene.add(grid);

  // 1 m 参考线与地面线：物件底面是否真的在 y=0，一眼能看出来。
  const groundLine = new THREE.Mesh(
    new THREE.BoxGeometry(8.4, 0.012, 0.02),
    new THREE.MeshBasicMaterial({ color: 0xff5d5d })
  );
  groundLine.position.set(0, 0.006, 2);
  scene.add(groundLine);

  TYPES.forEach((type, index) => {
    const catalog = FURNITURE_CATALOG.find(item => item.type === type);
    if (!catalog) return;
    const item = { ...catalog, id: type, position: { x: 0, z: 0 }, rotation: 0 } as FurnitureItem;
    const model = createFurnitureModel(THREE, item, false);
    if (mode === 'before' && model.userData.fitToDeclared) {
      // 还原成建模时的原始模型：不缩放、不对底面。
      model.scale.set(1, 1, 1);
      model.position.set(0, 0, 0);
    }
    model.position.x = -3.4 + index * 1.3;
    model.position.z = 1.7;
    model.traverse(child => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    scene.add(model);
  });

  // 标定区：1 m 地砖 + 上面一张 A4（真实 210×297 mm），两种标定物一起对照网格。
  const tile = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: 0x2b333d, roughness: 0.9 })
  );
  tile.rotation.x = -Math.PI / 2;
  tile.position.set(0.2, 0.003, -2.2);
  scene.add(tile);
  const tileEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
    new THREE.LineBasicMaterial({ color: 0x5f6c7a })
  );
  tileEdge.rotation.x = -Math.PI / 2;
  tileEdge.position.copy(tile.position).setY(0.005);
  scene.add(tileEdge);

  const sheet = new THREE.Mesh(
    new THREE.PlaneGeometry(A4.width, A4.depth),
    new THREE.MeshStandardMaterial({ color: 0xf2f5f8, roughness: 0.7 })
  );
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.set(0.35, 0.006, -2.05);
  scene.add(sheet);
  const sheetEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(A4.width, A4.depth)),
    new THREE.LineBasicMaterial({ color: 0x8b98a8 })
  );
  sheetEdge.rotation.x = -Math.PI / 2;
  sheetEdge.position.copy(sheet.position).setY(0.006);
  scene.add(sheetEdge);

  renderer.render(scene, camera);
  window.dispatchEvent(new Event('scene-ready'));
}
