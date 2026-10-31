/**
 * 评审议题：画布上的一颗钉。短文案、可选物件、钉下时的镜头。
 * 不含 @人、线程和实时协作。
 */

export const REVIEW_PIN_TEXT_MAX = 80;

export type ReviewPinStatus = 'open' | 'resolved';
export type ReviewPinFilter = 'open' | 'resolved';

export interface ReviewCamera {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
}

export interface ReviewPin {
  id: string;
  text: string;
  /** 钉在物件上时记下 id；钉在地面则为 null。 */
  itemId: string | null;
  /** 钉下时的世界坐标。物件后来被挪走时，用 offset 跟着走。 */
  x: number;
  y: number;
  z: number;
  offset: readonly [number, number, number] | null;
  camera: ReviewCamera;
  status: ReviewPinStatus;
}

export interface ReviewPinDraft {
  itemId: string | null;
  x: number;
  y: number;
  z: number;
  offset: readonly [number, number, number] | null;
  camera: ReviewCamera;
}

export function normalizePinText(text: string): string | null {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.slice(0, REVIEW_PIN_TEXT_MAX);
}

function finitePoint(x: number, y: number, z: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
}

export function createReviewPin(input: {
  id: string;
  text: string;
  draft: ReviewPinDraft;
}): ReviewPin | null {
  const text = normalizePinText(input.text);
  const { draft } = input;
  if (!text || !input.id || !finitePoint(draft.x, draft.y, draft.z)) return null;
  if (!finitePoint(draft.camera.position[0], draft.camera.position[1], draft.camera.position[2])) return null;
  if (!finitePoint(draft.camera.target[0], draft.camera.target[1], draft.camera.target[2])) return null;
  return {
    id: input.id,
    text,
    itemId: draft.itemId,
    x: draft.x,
    y: draft.y,
    z: draft.z,
    offset: draft.offset,
    camera: draft.camera,
    status: 'open',
  };
}

/** 物件还在就用钉下时相对它的偏移；否则停在原来的世界点。 */
export function pinAnchor(
  pin: Pick<ReviewPin, 'itemId' | 'x' | 'y' | 'z' | 'offset'>,
  item: { x: number; y: number; z: number } | null,
): { x: number; y: number; z: number } {
  if (pin.itemId && item && pin.offset) {
    return {
      x: item.x + pin.offset[0],
      y: item.y + pin.offset[1],
      z: item.z + pin.offset[2],
    };
  }
  return { x: pin.x, y: pin.y, z: pin.z };
}

/** 飞回钉下时的机位，并对准钉（物件挪过就跟着新位置）。 */
export function flyDestination(
  pin: ReviewPin,
  item: { x: number; y: number; z: number } | null,
): ReviewCamera {
  const aim = pinAnchor(pin, item);
  const dx = pin.camera.position[0] - pin.camera.target[0];
  const dy = pin.camera.position[1] - pin.camera.target[1];
  const dz = pin.camera.position[2] - pin.camera.target[2];
  return {
    position: [aim.x + dx, aim.y + dy, aim.z + dz],
    target: [aim.x, aim.y, aim.z],
  };
}

function ease(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

export function lerpReviewCamera(from: ReviewCamera, to: ReviewCamera, t: number): ReviewCamera {
  const e = ease(t);
  const mix = (a: readonly [number, number, number], b: readonly [number, number, number]): [number, number, number] => [
    a[0] + (b[0] - a[0]) * e,
    a[1] + (b[1] - a[1]) * e,
    a[2] + (b[2] - a[2]) * e,
  ];
  return { position: mix(from.position, to.position), target: mix(from.target, to.target) };
}

export function markPinResolved(pins: readonly ReviewPin[], id: string): ReviewPin[] {
  return pins.map(pin => (pin.id === id && pin.status === 'open' ? { ...pin, status: 'resolved' } : pin));
}

export function pinsForFilter(pins: readonly ReviewPin[], filter: ReviewPinFilter): ReviewPin[] {
  return pins.filter(pin => pin.status === filter);
}

export function countOpenPins(pins: readonly ReviewPin[]): number {
  return pins.reduce((count, pin) => count + (pin.status === 'open' ? 1 : 0), 0);
}

export function pinSubject(itemId: string | null, items: readonly { id: string; name: string }[]): string {
  if (!itemId) return '地面';
  return items.find(item => item.id === itemId)?.name ?? '物件已不在';
}

/** 2D 平面：世界 x/z → 画布 CSS 像素。与 canvasToWorld 互逆。 */
export function planPointToCanvas(
  point: { x: number; z: number },
  layout: { width: number; height: number },
  transform: { scale: number; offsetX: number; offsetY: number },
): { x: number; y: number } {
  return {
    x: transform.offsetX + (point.x + layout.width / 2) * transform.scale,
    y: transform.offsetY + (point.z + layout.height / 2) * transform.scale,
  };
}

/** 钉旁边的短输入，别画出画布。 */
export function placeComposer(
  anchor: { x: number; y: number },
  bounds: { width: number; height: number },
  size: { width: number; height: number } = { width: 220, height: 118 },
): { left: number; top: number } {
  const margin = 8;
  const left = Math.max(margin, Math.min(bounds.width - size.width - margin, anchor.x + 16));
  const top = Math.max(margin, Math.min(bounds.height - size.height - margin, anchor.y + 16));
  return { left, top };
}
