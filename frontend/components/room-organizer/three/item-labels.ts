import { disposeObject } from './builder-utils';
import { DisposableLruCache } from './texture-lru';
import type { FurnitureItem } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

const LABEL_TAG = 'item-label';
// 超过这个物件数就不再逐件铺名字：一屋子标签会糊成一片、压住场景。
const NAME_LIMIT = 8;
const LABEL_FONT_PX = 24;
const DOT_PAD_PX = 2;
// 与 measurement.ts 同一套像素→世界换算：24px 字 ≈ 0.225 m，对齐 2D 的 10px 物件标签。
const M_PER_PX = 0.009375;
// 圆点纹理的缓存键（用户不会叫这个名字）。
const DOT_KEY = '\u0000item-dot';

export interface ItemLabelOptions {
  /** 选中的物件即使在密集场景里也保留名字——「多时只留圆点，选中/靠近再展开」。 */
  emphasis?: ReadonlySet<string> | null;
}

/**
 * Cache the label texture keyed on the label text. Regenerating the
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
  yOffset: number,
  options: ItemLabelOptions = {}
): void {
  clearItemLabels(scene);
  // 物件多时默认只画圆点，名字只在选中/高亮时展开。
  const dense = items.length > NAME_LIMIT;
  const emphasis = options.emphasis ?? null;
  for (const item of items) {
    if (!item.position) continue;
    const named = !dense || emphasis?.has(item.id) === true;
    const sprite = named ? createLabelSprite(THREE, item.name) : createDotSprite(THREE);
    // 间距语义对齐 2D：标签贴在物件外缘 15px 处，这里取 0.3 m（约等于俯视 15px）；
    // 圆点只是指示点，贴到 0.15 m，不额外占画面。
    sprite.position.set(item.position.x, yOffset + item.height + (named ? 0.3 : 0.15), item.position.z);
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
  // 底片按字宽收紧：旧版固定 256 宽的纹理里，短名字有七成是空白。
  const image = master.image as { width: number; height: number };
  sprite.scale.set(image.width * M_PER_PX, image.height * M_PER_PX, 1);
  return sprite;
}

/**
 * 密集场景的降级标记：一个墨色小圆点 + 白环，不写字。
 * 和名字用同一张纹理缓存，随 clearItemLabels 一起释放。
 */
function createDotSprite(THREE: ThreeModule): ThreeNS.Sprite {
  const master = getDotTexture(THREE);
  const texture = master.clone();
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 10;
  const image = master.image as { width: number; height: number };
  sprite.scale.set(image.width * M_PER_PX, image.height * M_PER_PX, 1);
  return sprite;
}

function getDotTexture(THREE: ThreeModule): ThreeNS.CanvasTexture {
  const cached = labelTextureCache.get(DOT_KEY);
  if (cached) return cached;

  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - DOT_PAD_PX, 0, Math.PI * 2);
    ctx.fillStyle = '#333';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  labelTextureCache.set(DOT_KEY, texture);
  return texture;
}

function getLabelTexture(THREE: ThreeModule, text: string): ThreeNS.CanvasTexture {
  const cached = labelTextureCache.get(text);
  if (cached) return cached;

  const padding = 6;
  const font = `600 ${LABEL_FONT_PX}px -apple-system, BlinkMacSystemFont, sans-serif`;
  const probe = document.createElement('canvas').getContext('2d');
  const canvas = document.createElement('canvas');
  if (probe) probe.font = font;

  // Truncate over-long names with an ellipsis so the texture stays readable,
  // then size the canvas to the glyphs instead of a fixed 256×64 plate.
  const maxWidth = 220;
  const display = probe ? fitText(probe, text, maxWidth) : text;
  const textWidth = probe ? Math.ceil(probe.measureText(display).width) : display.length * LABEL_FONT_PX * 0.6;
  canvas.width = textWidth + padding * 2;
  canvas.height = LABEL_FONT_PX + padding * 2;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 2D 的标签是「墨色字 + 3px 白色光晕」，3D 纹理按同比例放大到 6px。
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 5;
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
