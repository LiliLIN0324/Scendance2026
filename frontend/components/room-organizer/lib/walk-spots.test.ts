import { describe, expect, it } from 'vitest';
import {
  WALK_SPOT_PREFIX,
  decodeWalkSpot,
  encodeWalkSpot,
  readWalkSpotFromHash,
  removeWalkSpot,
  upsertWalkSpot,
  walkSpotUrl,
  MAX_WALK_SPOTS,
  type WalkSpot,
} from './walk-spots';

const spot: WalkSpot = { name: '入口看舞台', x: 3.25, z: -7.5, yaw: 1.234, view: 'third' };

describe('walk spots', () => {
  it('round-trips a viewpoint through a shareable token', () => {
    const token = encodeWalkSpot(spot);
    expect(token.startsWith(WALK_SPOT_PREFIX)).toBe(true);
    expect(decodeWalkSpot(token)).toEqual({ ...spot, x: 3.25, z: -7.5, yaw: 1.234 });
  });

  it('returns null for anything that is not a spot token', () => {
    expect(decodeWalkSpot('')).toBeNull();
    expect(decodeWalkSpot('#share=abc')).toBeNull();
    expect(decodeWalkSpot(`${WALK_SPOT_PREFIX}not-base64!!`)).toBeNull();
  });

  it('rejects a payload without finite coordinates', () => {
    const broken = WALK_SPOT_PREFIX + Buffer.from(JSON.stringify({ n: 'x', x: 'a', z: 0, y: 0 })).toString('base64url');
    expect(decodeWalkSpot(broken)).toBeNull();
  });

  it('reads the spot out of a full share hash', () => {
    const token = encodeWalkSpot(spot);
    expect(readWalkSpotFromHash(`#${token}`)?.name).toBe('入口看舞台');
    expect(readWalkSpotFromHash(`https://example.com/view/#${token}`)?.x).toBe(3.25);
    expect(readWalkSpotFromHash('#nothing')).toBeNull();
  });

  it('builds a link without dropping the existing path', () => {
    const url = walkSpotUrl('https://example.com/view/?p=abc#old', spot);
    expect(url.startsWith('https://example.com/view/?p=abc#wspot1.')).toBe(true);
    expect(decodeWalkSpot(url.split('#')[1]!)).toEqual({ ...spot, x: 3.25, z: -7.5, yaw: 1.234 });
  });

  it('replaces same-name spots and keeps the newest when full', () => {
    const one = upsertWalkSpot([], spot);
    const replaced = upsertWalkSpot(one, { ...spot, x: 9 });
    expect(replaced).toHaveLength(1);
    expect(replaced[0]!.x).toBe(9);

    let many: WalkSpot[] = [];
    for (let i = 0; i < MAX_WALK_SPOTS + 3; i++) {
      many = upsertWalkSpot(many, { name: `位 ${i}`, x: i, z: 0, yaw: 0 });
    }
    expect(many).toHaveLength(MAX_WALK_SPOTS);
    expect(many[many.length - 1]!.name).toBe(`位 ${MAX_WALK_SPOTS + 2}`);
  });

  it('removes by name without touching others', () => {
    const list = [spot, { name: '侧门', x: 0, z: 0, yaw: 0 }];
    expect(removeWalkSpot(list, '入口看舞台')).toEqual([{ name: '侧门', x: 0, z: 0, yaw: 0 }]);
  });
});
