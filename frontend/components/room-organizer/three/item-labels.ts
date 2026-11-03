import { disposeObject } from './builder-utils';
import { DisposableLruCache } from './texture-lru';
import type { FurnitureItem } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

const LABEL_TAG = 'item-label';

/**
 * Cache the 256×64 label texture keyed on the label text. Regenerating the
 * canvas + CanvasTexture on every scene rebuild is wasteful when the item
 * names haven't changed. Each caller gets a `.clone()` of the cached master
 * so the clone shares the underlying canvas image (cheap) yet is independently
 * disposable. The cache is LRU-capped because label text is user-authored:
 * evicted masters are disposed, which is safe for live clones (see
 * texture-lru.ts), while cached masters keep the shared GPU image alive.
 */
const labelTextureCache = new DisposableLruCache<ThreeNS.CanvasTexture>();

export function clearItemLabels(scene: ThreeNS.Scene): void {
  for (const obj of scene.children.filter((child) => child.userData.type === LABEL_TAG)) {
    scene.remove(obj);
    disposeObject(obj);
  }
}

export function renderItemLabels(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  items: readonly FurnitureItem[],
  yOffset: number
): void {
  clearItemLabels(scene);
  for (const item of items) {
    if (!item.position) continue;
    const sprite = createLabelSprite(THREE, item.name);
    // 间距语义对齐 2D：标签贴在物件外缘 15px 处，这里取 0.3 m（约等于俯视 15px）。
    sprite.position.set(item.position.x, yOffset + item.height + 0.3, item.position.z);
    sprite.userData.type = LABEL_TAG;
    sprite.userData.itemId = item.id;
    scene.add(sprite);
  }
}

function createLabelSprite(THREE: ThreeModule, text: string): ThreeNS.Sprite {
  const master = getLabelTexture(THREE, text);
  // Clone per sprite so each mesh owns a disposable copy sharing the cached
  // canvas image. (`Texture.clone()` already flags needsUpdate.)
  const texture = master.clone();

  // 与 2D 区域/尺寸标注同一套语言：纸面留白 + 墨色字 + 白色描边光晕，不使用深色胶囊底。
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 10;
  sprite.scale.set(1.2, 0.3, 1);
  return sprite;
}

function getLabelTexture(THREE: ThreeModule, text: string): ThreeNS.CanvasTexture {
  const cached = labelTextureCache.get(text);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  const padding = 12;
  const fontSize = 28;
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Truncate over-long names with an ellipsis so the texture stays readable.
    const maxWidth = canvas.width - padding * 2;
    const display = fitText(ctx, text, maxWidth);
    // 2D 的标签是「墨色字 + 3px 白色光晕」，3D 纹理按同比例放大到 6px。
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 6;
    ctx.strokeText(display, canvas.width / 2, canvas.height / 2);
    ctx.fillStyle = '#333';
    ctx.fillText(display, canvas.width / 2, canvas.height / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  // Crisper sampling at oblique angles.
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  labelTextureCache.set(text, texture);
  return texture;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}
