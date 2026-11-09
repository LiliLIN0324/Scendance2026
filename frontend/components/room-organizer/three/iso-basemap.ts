import { ISO_MANIFEST_URL, loadMapRelease } from '@/lib/iso-map-release';
import { anchorBasemapYawRad, anchorGeoToWorld, sceneAnchorOf } from '../lib/scene-anchor';
import { disposeObject } from './builder-utils';
import { RESEARCH_BASEMAP_TAG, RESEARCH_BASEMAP_Y, researchBasemapMesh, setResearchBasemapElevation } from './research-basemap';
import type { RoomLayout } from '../lib/types';
import type * as ThreeNS from 'three';

export type IsoBasemapStatus = 'loading' | 'ready' | 'fallback';

export function setIsoBasemapVisible(scene: ThreeNS.Scene, visible: boolean, showBasemap = true): void {
  const iso = scene.children.find(child => child.userData.isoBasemap === true);
  if (iso) iso.visible = showBasemap && visible;
  const fallback = researchBasemapMesh(scene);
  if (fallback) fallback.visible = showBasemap && (!iso || !visible);
  for (const child of scene.children) {
    if (child.userData.mapVenueGround === true) child.visible = !iso?.visible;
  }
}

export function mountIsoBasemap(
  THREE: typeof ThreeNS,
  scene: ThreeNS.Scene,
  invalidate: () => void,
  onStatus: (status: IsoBasemapStatus) => void,
  showIso: () => boolean,
  showBasemap: () => boolean,
): { place(layout: RoomLayout): void; dispose(): void } {
  const request = new AbortController();
  const group = new THREE.Group();
  group.name = '西湖 ISO 底图';
  group.userData.type = RESEARCH_BASEMAP_TAG;
  group.userData.isoBasemap = true;
  group.userData.mapReference = true;
  let layout: RoomLayout | undefined;
  let placement: { origin: { lng: number; lat: number }; waterY: number } | undefined;
  onStatus('loading');
  const timeout = window.setTimeout(() => {
    request.abort();
    onStatus('fallback');
  }, 60000);

  async function load() {
    const release = await loadMapRelease(ISO_MANIFEST_URL, request.signal);
    if (!release.editor) throw new Error('当前发布版缺少编辑器模型');
    const [{ GLTFLoader }, buffers] = await Promise.all([
      import('three/addons/loaders/GLTFLoader.js'),
      Promise.all(release.editor.assets.map(async url => {
        const response = await fetch(url, { signal: request.signal });
        if (!response.ok) throw new Error('ISO 底图模型加载失败');
        return response.arrayBuffer();
      })),
    ]);
    const loader = new GLTFLoader();
    for (const buffer of buffers) {
      const model = await loader.parseAsync(buffer, '');
      group.add(model.scene);
      if (request.signal.aborted) {
        disposeObject(group);
        group.clear();
        return;
      }
    }
    placement = release.editor;
    scene.add(group);
    place();
    onStatus('ready');
  }

  function place() {
    if (!layout || !placement) return;
    const { origin, waterY } = placement;
    const anchor = sceneAnchorOf(layout) ?? { ...origin, orientationDeg: 0, metersPerUnit: 1 };
    const center = anchorGeoToWorld(anchor, origin.lng, origin.lat);
    group.rotation.y = anchorBasemapYawRad(anchor);
    group.scale.setScalar(1 / anchor.metersPerUnit);
    group.position.set(center.x, 0, center.z);
    group.updateMatrixWorld(true);

    // Use the terrain at the project anchor as the local ground datum.
    const terrain = group.getObjectByName('scendance-iso-terrain');
    const ray = new THREE.Raycaster(
      new THREE.Vector3(0, 10000 / anchor.metersPerUnit, 0),
      new THREE.Vector3(0, -1, 0),
    );
    const ground = terrain && ray.intersectObject(terrain, true)[0];
    group.position.y = -(ground?.point.y ?? waterY / anchor.metersPerUnit) - 0.15;
    const lakeWorldY = group.position.y + waterY / anchor.metersPerUnit;
    const fallback = researchBasemapMesh(scene);
    if (fallback) setResearchBasemapElevation(scene, fallback, lakeWorldY);
    setIsoBasemapVisible(scene, showIso(), showBasemap());
    invalidate();
  }

  void load().catch(error => {
    group.removeFromParent();
    disposeObject(group);
    group.clear();
    if (request.signal.aborted) return;
    request.abort();
    console.warn('西湖 ISO 底图加载失败', error);
    onStatus('fallback');
  }).finally(() => window.clearTimeout(timeout));

  return { place(next) {
    layout = next;
    place();
  }, dispose() {
    window.clearTimeout(timeout);
    request.abort();
    group.removeFromParent();
    disposeObject(group);
    group.clear();
    const fallback = researchBasemapMesh(scene);
    if (fallback) setResearchBasemapElevation(scene, fallback, RESEARCH_BASEMAP_Y);
    setIsoBasemapVisible(scene, showIso(), showBasemap());
  } };
}
