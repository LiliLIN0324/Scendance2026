import { describe, expect, it } from 'vitest';
import { makeFloor, makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { buildVenueShell } from '../components/room-organizer/lib/venue-shell';
import type { RoomLayout } from '../components/room-organizer/lib/types';
import { HALL_D5 } from './fixtures/hall-d5';
import { extractPlanSizeFacts } from './plan-size-facts';

function layoutWithScene(width = 12, depth = 9): RoomLayout {
  const scene = buildVenueShell({ widthM: width, depthM: depth, indoorOutdoor: 'indoor', scaleOrigin: 'stated' });
  return makeLayout({ width, height: depth, floors: [makeFloor()], backendSceneV2: scene });
}

describe('场地宽深事实', () => {
  it('默认画布数字不是确认或现场实测', () => {
    const facts = extractPlanSizeFacts(makeLayout({ width: 12, height: 9 }), 0);
    expect(facts.width).toMatchObject({ valueMeters: 12, source: 'canvas', status: 'unknown', reason: 'no_scene_record' });
    expect(facts.depth).toMatchObject({ valueMeters: 9, source: 'canvas', status: 'unknown', reason: 'no_scene_record' });
    expect(facts.width.records).toEqual([]);
  });

  it('Hall D5 面积折算的 19×15 是推测，不得标为用户确认', () => {
    const { width, height } = HALL_D5.roomSize;
    const scene = buildVenueShell({ widthM: width, depthM: height, indoorOutdoor: 'indoor', scaleOrigin: 'area' });
    const facts = extractPlanSizeFacts(makeLayout({ width, height, backendSceneV2: scene }), 0);
    expect(facts.width).toMatchObject({ valueMeters: 19, status: 'inferred', reason: 'inferred_record' });
    expect(facts.depth).toMatchObject({ valueMeters: 15, status: 'inferred', reason: 'inferred_record' });
    expect(facts.width.records[0]!.record.status).toBe('inferred');
  });

  it('只认同维度、数值一致的用户确认记录，并保留真实来源', () => {
    const layout = layoutWithScene();
    const scene = layout.backendSceneV2!;
    const assetId = crypto.randomUUID();
    scene.sources = [{ assetId, kind: 'floorplan', name: '场地原图', width: 800, height: 600 }];
    scene.dimensions = scene.dimensions.map(d => ({ ...d, status: 'confirmed', ...(d.kind === 'width' ? { sourceAssetId: assetId } : {}) }));
    const facts = extractPlanSizeFacts(layout, 0);
    expect(facts.width.status).toBe('confirmed');
    expect(facts.depth.status).toBe('confirmed');
    expect(facts.width.records[0]).toMatchObject({ record: { sourceAssetId: assetId }, source: { assetId, name: '场地原图' }, matchesCurrent: true });
    expect(facts.depth.records[0]!.source).toBeNull();
    // 当前契约没有误差字段；不能把数值匹配容差当作测量误差。
    expect(facts.width.records[0]!.record).not.toHaveProperty('uncertaintyMeters');
  });

  it('修改画布尺寸后旧确认失效，另一维仍按自身事实判断', () => {
    const layout = layoutWithScene();
    layout.backendSceneV2!.dimensions = layout.backendSceneV2!.dimensions.map(d => ({ ...d, status: 'confirmed' }));
    const facts = extractPlanSizeFacts({ ...layout, width: 13 }, 0);
    expect(facts.width).toMatchObject({ valueMeters: 13, status: 'unknown', reason: 'stale_scene' });
    expect(facts.width.records[0]).toMatchObject({ record: { valueMeters: 12, status: 'confirmed' }, matchesCurrent: false });
    expect(facts.depth.status).toBe('confirmed');
  });

  it('同维度确认记录有冲突时不能只挑与画布一致的一条', () => {
    const layout = layoutWithScene();
    const scene = layout.backendSceneV2!;
    scene.dimensions = [
      { id: crypto.randomUUID(), kind: 'width', label: '记录一', valueMeters: 12, status: 'confirmed' },
      { id: crypto.randomUUID(), kind: 'width', label: '记录二', valueMeters: 11, status: 'confirmed' },
    ];
    const facts = extractPlanSizeFacts(layout, 0);
    expect(facts.width).toMatchObject({ status: 'unknown', reason: 'conflicting_records' });
    expect(facts.width.records).toHaveLength(2);
    expect(facts.depth.status).toBe('unknown');
  });

  it('识别尺寸只能算推测，独立的错值记录不能确认当前尺寸', () => {
    const layout = layoutWithScene();
    const scene = layout.backendSceneV2!;
    scene.dimensions = [
      { id: crypto.randomUUID(), kind: 'width', label: '自动识别', valueMeters: 12, status: 'detected' },
      { id: crypto.randomUUID(), kind: 'depth', label: '旧推测', valueMeters: 8, status: 'inferred' },
    ];
    const before = structuredClone(layout);
    const facts = extractPlanSizeFacts(layout, 0);
    expect(facts.width).toMatchObject({ status: 'inferred', reason: 'inferred_record' });
    expect(facts.depth).toMatchObject({ status: 'unknown', reason: 'no_matching_record' });
    expect(layout).toEqual(before);
  });

  it('若输入记录实际带有额外测量误差，也原样保留，不以匹配容差替代', () => {
    const layout = layoutWithScene();
    const widthRecord = layout.backendSceneV2!.dimensions.find(d => d.kind === 'width')!;
    Object.assign(widthRecord, { uncertaintyMeters: 0.02 });
    const record = extractPlanSizeFacts(layout, 0).width.records[0]!.record;
    expect(record).toHaveProperty('uncertaintyMeters', 0.02);
  });

  it('缺来源时保留来源 ID，不把墙长或其他楼层的记录当全场尺寸', () => {
    const layout = layoutWithScene();
    const sourceAssetId = crypto.randomUUID();
    layout.backendSceneV2!.dimensions = [
      { id: crypto.randomUUID(), kind: 'width', label: '用户口述', valueMeters: 12, status: 'confirmed', sourceAssetId },
      { id: crypto.randomUUID(), kind: 'wall', label: '局部墙长', valueMeters: 9, status: 'confirmed', measure: 'depth' },
      { id: crypto.randomUUID(), kind: 'depth', label: '物件深度', valueMeters: 9, status: 'confirmed', targetId: crypto.randomUUID() },
    ];
    const facts = extractPlanSizeFacts(layout, 0);
    expect(facts.width.status).toBe('confirmed');
    expect(facts.width.records[0]).toMatchObject({ record: { sourceAssetId }, source: null });
    expect(facts.depth).toMatchObject({ status: 'unknown', reason: 'no_scene_record', records: [] });
    const multiFloor = { ...layout, floors: [layout.floors[0]!, makeFloor({ id: 'upper' })] };
    expect(extractPlanSizeFacts(multiFloor, 1).width).toMatchObject({ status: 'unknown', reason: 'unsupported_floor' });
    expect(extractPlanSizeFacts(multiFloor, 0).width.status).toBe('unknown');
  });

  it('无效尺寸不能被当成有记录的事实', () => {
    const facts = extractPlanSizeFacts(makeLayout({ width: NaN, height: 0 }), 0);
    expect(facts.width).toMatchObject({ valueMeters: null, status: 'unknown', reason: 'missing_value' });
    expect(facts.depth).toMatchObject({ valueMeters: null, status: 'unknown', reason: 'missing_value' });
  });

  it('损坏的旧记录不会造成界面崩溃，也不会被认作确认', () => {
    const layout = layoutWithScene();
    const corrupted = { ...layout.backendSceneV2!, dimensions: [null], sources: undefined, venue: undefined } as unknown as NonNullable<RoomLayout['backendSceneV2']>;
    const facts = extractPlanSizeFacts({ ...layout, backendSceneV2: corrupted }, 0);
    expect(facts.width.status).toBe('unknown');
    expect(facts.depth.status).toBe('unknown');
  });
});
