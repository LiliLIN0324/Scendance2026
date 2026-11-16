import * as THREE from 'three';
import type { Sprite } from 'three';

/**
 * 人群岗位标签（2026-11-16）。
 *
 * 3D 里满场小人长得一样，用户分不清哪个是安保、哪个是保洁，只能回 2D 点位对照。
 * 这一层给每个人头顶挂一个岗位名：**同一岗位只在第一个人头上写字**，其余用小色点，
 * 否则三十个「游客」会糊成一片（和 item-labels 的「密集时只留圆点」是同一条口径）。
 *
 * 标签是 Sprite，永远面向相机；挂在人形组内部，随人走。
 */

/** 与 item-labels 同一套像素→世界换算：24px 字 ≈ 0.225 m。 */
const M_PER_PX = 0.009375;
const LABEL_FONT_PX = 18;
const LABEL_TAG = 'plan-role-label';
/** 文字最长像素宽：超过就截断，避免一张贴图横穿半个场景。 */
const MAX_TEXT_PX = 132;

export interface PlanRoleLabels {
  /** 给一个人形组加岗位标签；同一组重复调用只保留一个。 */
  add(group: THREE.Group, role: string, color: string, height: number): void;
  dispose(): void;
  /** 当前纹理缓存条目数（测试用：同名岗位应复用同一张纹理）。 */
  textureCacheSize(): number;
}

interface RoleTexture {
  texture: THREE.Texture;
  aspect: number;
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
}

function textureOf(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

/** 岗位色：只接受 #rrggbb，别的一律退到中性灰（不猜用户想表达什么颜色）。 */
function safeColor(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#8a97a6';
}

/** 把「● 岗位名」画成透明底贴图。 */
function drawRoleTexture(role: string, color: string): RoleTexture | null {
  const font = `600 ${LABEL_FONT_PX}px -apple-system, BlinkMacSystemFont, sans-serif`;
  const probeCanvas = makeCanvas(8, 8);
  const probe = probeCanvas?.getContext('2d') ?? null;
  let text = role;
  let textWidth = role.length * LABEL_FONT_PX;
  if (probe) {
    probe.font = font;
    textWidth = Math.ceil(probe.measureText(role).width);
    if (textWidth > MAX_TEXT_PX) {
      text = `${role.slice(0, Math.max(1, role.length - 1))}…`;
      while (text.length > 1 && probe.measureText(text).width > MAX_TEXT_PX) {
        text = `${text.slice(0, -2)}…`;
      }
      textWidth = Math.ceil(probe.measureText(text).width);
    }
  }

  const dot = LABEL_FONT_PX * 0.42;
  const padding = 5;
  const gap = 4;
  const width = padding * 2 + dot * 2 + gap + textWidth;
  const height = LABEL_FONT_PX + padding * 2;
  const canvas = makeCanvas(width, height);
  const ctx = canvas?.getContext('2d') ?? null;
  if (!canvas || !ctx) return null;

  ctx.font = font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  ctx.beginPath();
  ctx.arc(padding + dot, height / 2, dot, 0, Math.PI * 2);
  ctx.fillStyle = safeColor(color);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.stroke();

  // 与 2D 标注同一套语言：墨色字 + 白色描边光晕。
  const textX = padding + dot * 2 + gap;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.lineWidth = 4;
  ctx.strokeText(text, textX, height / 2);
  ctx.fillStyle = '#333';
  ctx.fillText(text, textX, height / 2);

  return { texture: textureOf(canvas), aspect: width / height };
}

/** 密集时的降级标记：岗位色小圆点，不写字。 */
function drawDotTexture(color: string): RoleTexture | null {
  const size = 14;
  const canvas = makeCanvas(size, size);
  const ctx = canvas?.getContext('2d') ?? null;
  if (!canvas || !ctx) return null;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fillStyle = safeColor(color);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.stroke();
  return { texture: textureOf(canvas), aspect: 1 };
}

export function createPlanRoleLabels(): PlanRoleLabels {
  const sprites = new Set<Sprite>();
  const textureCache = new Map<string, RoleTexture>();
  const namedRoles = new Set<string>();
  let disposed = false;

  const cached = (key: string, build: () => RoleTexture | null): RoleTexture | null => {
    const hit = textureCache.get(key);
    if (hit) return hit;
    const made = build();
    if (!made) return null;
    textureCache.set(key, made);
    return made;
  };

  const add = (group: THREE.Group, role: string, color: string, height: number) => {
    if (disposed || !role) return;
    if (group.getObjectByName(LABEL_TAG)) return;
    // 同一岗位只在第一个人头顶写字，其余用小色点：场上三十个「游客」也不会糊成一片。
    const named = !namedRoles.has(role);
    const made = named
      ? cached(`role:${role}:${safeColor(color)}`, () => drawRoleTexture(role, color))
      : cached(`dot:${safeColor(color)}`, () => drawDotTexture(color));
    if (named) namedRoles.add(role);
    // 无 DOM（纯 node 测试 / SSR）时静默跳过，不影响 3D 场景本身。
    if (!made) return;

    const material = new THREE.SpriteMaterial({
      map: made.texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.name = LABEL_TAG;
    sprite.userData.type = LABEL_TAG;
    const worldHeight = named ? 0.24 : 0.12;
    sprite.scale.set(worldHeight * made.aspect, worldHeight, 1);
    // 头顶留一点空隙，别贴着头发；圆点更贴近头顶。
    sprite.position.set(0, height + (named ? 0.26 : 0.14), 0);
    sprite.renderOrder = 10;
    group.add(sprite);
    sprites.add(sprite);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const sprite of sprites) {
      sprite.removeFromParent();
      sprite.material.dispose();
    }
    sprites.clear();
    for (const { texture } of textureCache.values()) texture.dispose();
    textureCache.clear();
    namedRoles.clear();
  };

  return {
    add,
    dispose,
    textureCacheSize: () => textureCache.size,
  };
}

export { LABEL_TAG as PLAN_ROLE_LABEL_TAG, M_PER_PX as PLAN_ROLE_LABEL_M_PER_PX };
