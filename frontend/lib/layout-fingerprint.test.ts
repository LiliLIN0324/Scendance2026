import { describe, expect, it } from 'vitest';
import {
  fingerprintsEqual,
  itemFingerprint,
  layoutFingerprint,
} from './layout-fingerprint';
import type { FurnitureItem, RoomLayout } from '../components/room-organizer/lib/types';

/** 构造一个最小可用的 FurnitureItem，仅覆盖指纹关心的字段。 */
function makeItem(
  partial: Partial<FurnitureItem> & { id: string } & { x?: number; z?: number },
): FurnitureItem {
  const { x, z, ...rest } = partial;
  return {
    type: 'table',
    name: partial.id,
    width: 1,
    depth: 1,
    height: 1,
    color: '#000',
    icon: '',
    position: { x: x ?? 0, z: z ?? 0 },
    rotation: 0,
    assetId: '',
    ...rest,
  } as FurnitureItem;
}

/** 用给定 items 拼一份最小 RoomLayout（默认 10×8）。 */
function makeLayout(
  items: FurnitureItem[],
  opts: { width?: number; height?: number; floors?: FurnitureItem[][] } = {},
): Pick<RoomLayout, 'width' | 'height' | 'floors'> {
  const floors =
    opts.floors ?? [items];
  return {
    width: opts.width ?? 10,
    height: opts.height ?? 8,
    floors: floors.map((floorItems, idx) => ({
      id: `floor-${idx}`,
      items: floorItems,
    })) as RoomLayout['floors'],
  };
}

describe('layoutFingerprint', () => {
  it('同一布局两次生成指纹相同', () => {
    const layout = makeLayout([
      makeItem({ id: 'a', x: 1, z: 2, rotation: 90, assetId: 'asset-1' }),
      makeItem({ id: 'b', x: -3, z: 0.5, width: 2, depth: 1.5 }),
    ]);
    expect(layoutFingerprint(layout)).toBe(layoutFingerprint(layout));
  });

  it('items 在数组里顺序互换，指纹相同', () => {
    const a = makeItem({ id: 'a', x: 1, z: 2 });
    const b = makeItem({ id: 'b', x: -3, z: 0.5 });
    const layout1 = makeLayout([a, b]);
    const layout2 = makeLayout([b, a]);
    expect(layoutFingerprint(layout1)).toBe(layoutFingerprint(layout2));
  });

  it('位置动 1cm（>1e-3）指纹变', () => {
    const base = makeLayout([makeItem({ id: 'a', x: 1, z: 2 })]);
    const moved = makeLayout([makeItem({ id: 'a', x: 1.01, z: 2 })]);
    expect(layoutFingerprint(moved)).not.toBe(layoutFingerprint(base));
  });

  it('旋转动 1° 指纹变', () => {
    const base = makeLayout([makeItem({ id: 'a', rotation: 0 })]);
    const rotated = makeLayout([makeItem({ id: 'a', rotation: 1 })]);
    expect(layoutFingerprint(rotated)).not.toBe(layoutFingerprint(base));
  });

  it('尺寸变化指纹变', () => {
    const base = makeLayout([makeItem({ id: 'a', width: 1, depth: 1 })]);
    const resized = makeLayout([makeItem({ id: 'a', width: 1.2, depth: 1 })]);
    expect(layoutFingerprint(resized)).not.toBe(layoutFingerprint(base));
  });

  it('assetId 改变指纹变', () => {
    const base = makeLayout([makeItem({ id: 'a', assetId: 'x' })]);
    const swapped = makeLayout([makeItem({ id: 'a', assetId: 'y' })]);
    expect(layoutFingerprint(swapped)).not.toBe(layoutFingerprint(base));
  });

  it('删除一件物料指纹变', () => {
    const base = makeLayout([
      makeItem({ id: 'a' }),
      makeItem({ id: 'b' }),
    ]);
    const shorter = makeLayout([makeItem({ id: 'a' })]);
    expect(layoutFingerprint(shorter)).not.toBe(layoutFingerprint(base));
  });

  it('新增一件物料指纹变', () => {
    const base = makeLayout([makeItem({ id: 'a' })]);
    const added = makeLayout([
      makeItem({ id: 'a' }),
      makeItem({ id: 'b' }),
    ]);
    expect(layoutFingerprint(added)).not.toBe(layoutFingerprint(base));
  });

  it('浮点 1.0000001 与 1.0（1e-6 内）指纹相同', () => {
    const a = makeLayout([makeItem({ id: 'a', x: 1.0000001 })]);
    const b = makeLayout([makeItem({ id: 'a', x: 1.0 })]);
    expect(layoutFingerprint(a)).toBe(layoutFingerprint(b));
  });

  it('-0 与 0 指纹相同', () => {
    const a = makeLayout([makeItem({ id: 'a', x: -0, z: 0 })]);
    const b = makeLayout([makeItem({ id: 'a', x: 0, z: 0 })]);
    expect(layoutFingerprint(a)).toBe(layoutFingerprint(b));
  });

  it('floor 列表顺序换、items 集合相同，指纹相同', () => {
    const itemOnF0 = makeItem({ id: 'a', x: 1, z: 1 });
    const itemOnF1 = makeItem({ id: 'b', x: -1, z: -1 });
    const layout1 = makeLayout([], {
      floors: [[itemOnF0], [itemOnF1]],
    });
    const layout2 = makeLayout([], {
      floors: [[itemOnF1], [itemOnF0]],
    });
    expect(layoutFingerprint(layout1)).toBe(layoutFingerprint(layout2));
  });

  it('修改 layout.width 指纹变', () => {
    const base = makeLayout([makeItem({ id: 'a' })], { width: 10 });
    const wider = makeLayout([makeItem({ id: 'a' })], { width: 11 });
    expect(layoutFingerprint(wider)).not.toBe(layoutFingerprint(base));
  });

  it('修改 layout.height 指纹变', () => {
    const base = makeLayout([makeItem({ id: 'a' })], { height: 8 });
    const taller = makeLayout([makeItem({ id: 'a' })], { height: 9 });
    expect(layoutFingerprint(taller)).not.toBe(layoutFingerprint(base));
  });

  it('空布局 floors: [] 稳定出指纹、不抛错', () => {
    const empty: Pick<RoomLayout, 'width' | 'height' | 'floors'> = {
      width: 10,
      height: 8,
      floors: [],
    };
    const h1 = layoutFingerprint(empty);
    const h2 = layoutFingerprint({ ...empty });
    expect(h1).toBe(h2);
    expect(typeof h1).toBe('string');
    expect(h1.length).toBeGreaterThan(0);
  });

  it('空布局 floors[0].items: [] 稳定出指纹、不抛错', () => {
    const floor = (items: FurnitureItem[]): RoomLayout['floors'][number] =>
      ({ id: 'f', name: 'f', floorColor: '#fff', items }) as RoomLayout['floors'][number];
    const empty: Pick<RoomLayout, 'width' | 'height' | 'floors'> = {
      width: 10,
      height: 8,
      floors: [floor([])],
    };
    const h1 = layoutFingerprint(empty);
    const h2 = layoutFingerprint({
      width: 10,
      height: 8,
      floors: [floor([])],
    });
    // floor id / name 不进指纹，空 items 时两份空布局应一致。
    expect(h1).toBe(h2);
  });
});

describe('itemFingerprint', () => {
  it('缺 position 时按 {x:0, z:0} 兜底', () => {
    const it = makeItem({ id: 'x' });
    delete it.position;
    const fp = itemFingerprint(it);
    expect(fp.x).toBe(0);
    expect(fp.z).toBe(0);
  });

  it('缺 rotation / assetId 时按 0 / "" 兜底', () => {
    const it = makeItem({ id: 'x' });
    delete it.rotation;
    delete it.assetId;
    const fp = itemFingerprint(it);
    expect(fp.rotation).toBe(0);
    expect(fp.assetId).toBe('');
  });

  it('数字规范化到 1e-6', () => {
    const fp = itemFingerprint(
      makeItem({ id: 'x', position: { x: 1.23456789, z: 0 }, rotation: 0.0000001 }),
    );
    expect(fp.x).toBe(1.234568);
    expect(fp.rotation).toBe(0);
  });
});

describe('fingerprintsEqual', () => {
  it('同一指纹自身相等', () => {
    const layout = makeLayout([
      makeItem({ id: 'a', x: 1, z: 2 }),
    ]);
    const h = layoutFingerprint(layout);
    expect(fingerprintsEqual(h, h)).toBe(true);
  });

  it('改一件物料后两份指纹不相等', () => {
    const h1 = layoutFingerprint(makeLayout([makeItem({ id: 'a', x: 1 })]));
    const h2 = layoutFingerprint(makeLayout([makeItem({ id: 'a', x: 1.5 })]));
    expect(fingerprintsEqual(h1, h2)).toBe(false);
  });

  it('顺序无关的两份布局仍判相等', () => {
    const a = makeItem({ id: 'a', x: 1 });
    const b = makeItem({ id: 'b', x: 2 });
    const h1 = layoutFingerprint(makeLayout([a, b]));
    const h2 = layoutFingerprint(makeLayout([b, a]));
    expect(fingerprintsEqual(h1, h2)).toBe(true);
  });
});
