import { describe, expect, it } from 'vitest';
import {
  countOpenPins,
  createReviewPin,
  flyDestination,
  lerpReviewCamera,
  markPinResolved,
  normalizePinText,
  pinAnchor,
  pinSubject,
  pinsForFilter,
  placeComposer,
  planPointToCanvas,
  type ReviewPinDraft,
} from './review-pins';

const draft: ReviewPinDraft = {
  itemId: 'desk',
  x: 1,
  y: 0.4,
  z: 2,
  offset: [0.2, 0.4, 0],
  camera: { position: [4, 3, 5], target: [1, 0.4, 2] },
};

describe('review pins', () => {
  it('keeps a short note and drops an empty one', () => {
    expect(normalizePinText('  桌子  挡了通道  ')).toBe('桌子 挡了通道');
    expect(normalizePinText('   ')).toBeNull();
    expect(normalizePinText('钉'.repeat(90))?.length).toBe(80);
    expect(createReviewPin({ id: '', text: '有字', draft })).toBeNull();
    expect(createReviewPin({ id: 'p1', text: '   ', draft })).toBeNull();
    const pin = createReviewPin({ id: 'p1', text: '桌子挡了通道', draft });
    expect(pin).toMatchObject({ id: 'p1', text: '桌子挡了通道', itemId: 'desk', status: 'open' });
  });

  it('follows a moved object and flies the saved viewpoint onto it', () => {
    const pin = createReviewPin({ id: 'p1', text: '偏了', draft })!;
    expect(pinAnchor(pin, null)).toEqual({ x: 1, y: 0.4, z: 2 });
    expect(pinAnchor(pin, { x: 3, y: 0, z: 1 })).toEqual({ x: 3.2, y: 0.4, z: 1 });
    const dest = flyDestination(pin, { x: 3, y: 0, z: 1 });
    expect(dest.target).toEqual([3.2, 0.4, 1]);
    expect(dest.position[0]).toBeCloseTo(3.2 + 3);
    expect(dest.position[1]).toBeCloseTo(0.4 + 2.6);
    expect(dest.position[2]).toBeCloseTo(1 + 3);
    const mid = lerpReviewCamera(pin.camera, dest, 0.5);
    expect(mid.position[0]).toBeGreaterThan(pin.camera.position[0]);
    expect(mid.position[0]).toBeLessThan(dest.position[0]);
    expect(lerpReviewCamera(pin.camera, dest, 1).target).toEqual(dest.target);
  });

  it('splits open and resolved without a pass or reject mark', () => {
    const open = createReviewPin({ id: 'a', text: '通道窄', draft })!;
    const ground = createReviewPin({ id: 'b', text: '这里空', draft: { ...draft, itemId: null, offset: null } })!;
    const resolved = markPinResolved([open, ground], 'a');
    expect(resolved[0]?.status).toBe('resolved');
    expect(resolved[1]?.status).toBe('open');
    expect(markPinResolved(resolved, 'a')[0]).toBe(resolved[0]);
    expect(pinsForFilter(resolved, 'open').map(pin => pin.id)).toEqual(['b']);
    expect(pinsForFilter(resolved, 'resolved').map(pin => pin.id)).toEqual(['a']);
    expect(countOpenPins(resolved)).toBe(1);
    expect(pinSubject('desk', [{ id: 'desk', name: '签到桌' }])).toBe('签到桌');
    expect(pinSubject(null, [])).toBe('地面');
    expect(pinSubject('gone', [])).toBe('物件已不在');
  });

  it('places the composer inside the canvas and maps a plan point', () => {
    expect(planPointToCanvas({ x: 0, z: 0 }, { width: 10, height: 8 }, { scale: 10, offsetX: 20, offsetY: 30 })).toEqual({ x: 70, y: 70 });
    expect(placeComposer({ x: 400, y: 400 }, { width: 300, height: 200 })).toEqual({ left: 72, top: 74 });
    expect(placeComposer({ x: 4, y: 4 }, { width: 800, height: 600 })).toEqual({ left: 20, top: 20 });
  });
});
