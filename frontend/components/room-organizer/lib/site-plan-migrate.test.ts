import { describe, expect, it } from 'vitest';
import {
  materializeLegacyDraft,
  previewLegacyMigration,
  type LegacyPlanInput,
} from './site-plan-migrate';
import { sitePlanDataSchema, sitePlanSnapshotSchema } from '../../../../supabase/functions/_shared/site-plan';

/** 确定性 UUID 生成器（测试断言用）。 */
function uuidSeq(): () => string {
  let n = 0;
  return () => {
    const tail = (n++).toString(16).padStart(12, '0').slice(0, 12);
    return `00000000-0000-4000-8000-${tail}`;
  };
}

function validRect(): LegacyPlanInput {
  return {
    boundary: [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 100, z: 80 },
      { x: 0, z: 80 },
    ],
    items: [
      { id: 'item-a', name: '帐篷 A', x: 10, z: 10, rotationDeg: 0, width: 3, depth: 3 },
      { id: 'item-b', name: '护栏 B', x: 90, z: 70, rotationDeg: 0, width: 2, depth: 1 },
    ],
    metersPerUnit: 1,
    latSign: -1,
    orientationDeg: 0,
    anchor: { lng: 120.1443, lat: 30.2459, source: 'picker' },
  };
}

describe('site plan legacy migration (H1-c)', () => {
  it('converts legacy shell geometry to ENU meters with scale and north sign', () => {
    const { data, report } = previewLegacyMigration(validRect());
    expect(report.scaleOk).toBe(true);
    expect(report.boundaryOk).toBe(true);
    // latSign=-1：+z 向南，北在 +y → (10,10) 壳体 → ENU (10, -10)。
    expect(data.facilities[0]!.position).toEqual({ x: 10, y: -10 });
    expect(data.facilities[1]!.position).toEqual({ x: 90, y: -70 });
    expect(data.boundary).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: -80 },
      { x: 0, y: -80 },
    ]);
    expect(data.anchor).toEqual({ lng: 120.1443, lat: 30.2459, crs: 'gcj-02', source: 'picker' });
  });

  it('falls back to frameScale when metersPerUnit is absent', () => {
    const input = validRect();
    delete input.metersPerUnit;
    input.frameScale = 2; // 壳体米 / 真实米 = 2 → 1 壳体单位 = 0.5 m
    const { data, report } = previewLegacyMigration(input);
    expect(report.scaleOk).toBe(true);
    expect(data.facilities[0]!.position).toEqual({ x: 5, y: -5 });
    expect(data.facilities[0]!.size).toEqual({ width: 3, depth: 3 }); // 尺寸仍为壳体宽深
  });

  it('marks scale pending when neither metersPerUnit nor frameScale is known, but keeps ratio', () => {
    const input = validRect();
    delete input.metersPerUnit;
    const { data, report } = previewLegacyMigration(input);
    expect(report.scaleOk).toBe(false);
    expect(report.pendingCalibration.some(p => p.label === '尺度')).toBe(true);
    // 尺度未知时保留原比例（mpp=1），可先看结构，不作交付断言。
    expect(data.facilities[0]!.position).toEqual({ x: 10, y: -10 });
    expect(report.keptItems).toBe(2);
  });

  it('flags missing orientation and anchor as pending calibration', () => {
    const input = validRect();
    delete input.orientationDeg;
    delete input.anchor;
    const { data, report } = previewLegacyMigration(input);
    expect(report.orientationOk).toBe(false);
    expect(report.anchorOk).toBe(false);
    expect(report.pendingCalibration.some(p => p.label === '朝向')).toBe(true);
    expect(report.pendingCalibration.some(p => p.label === '锚点')).toBe(true);
    expect(data.anchor).toBeUndefined();
  });

  it('drops items missing footprint size', () => {
    const input = validRect();
    // 缺宽深：省略 width/depth（exactOptional 下显式 undefined 是类型错误）。
    input.items = [
      { id: 'item-a', name: '帐篷 A', x: 10, z: 10, rotationDeg: 0, width: 3, depth: 3 },
      { id: 'item-b', name: '护栏 B', x: 90, z: 70, rotationDeg: 0 },
    ];
    const { data, report } = previewLegacyMigration(input);
    expect(report.droppedItems).toHaveLength(1);
    expect(report.droppedItems[0]!.itemId).toBe('item-b');
    expect(report.droppedItems[0]!.reason).toContain('缺宽深');
    expect(data.facilities).toHaveLength(1); // item-a 保留
  });

  it('drops items outside the boundary', () => {
    const input = validRect();
    input.items = [{ id: 'far', name: '越界', x: 200, z: 20, rotationDeg: 0, width: 2, depth: 2 }];
    const { data, report } = previewLegacyMigration(input);
    expect(report.droppedItems[0]!.reason).toContain('越出场地边界');
    expect(data.facilities).toHaveLength(0);
  });

  it('rejects degenerate boundary and emits a calibration note', () => {
    const input = validRect();
    input.boundary = [{ x: 0, z: 0 }, { x: 1, z: 0 }];
    const { data, report } = previewLegacyMigration(input);
    expect(report.boundaryOk).toBe(false);
    expect(report.pendingCalibration.some(p => p.label === '边界')).toBe(true);
    expect(data.boundary).toEqual([]);
  });

  it('is read-only: preview never mutates the legacy input', () => {
    const input = validRect();
    const snapshot = structuredClone(input);
    previewLegacyMigration(input);
    previewLegacyMigration(input);
    expect(input).toEqual(snapshot);
  });

  it('materializes a copy that passes the SitePlan contract without touching the old project', () => {
    const preview = previewLegacyMigration(validRect());
    const projectId = '88888888-8888-4888-8888-888888888888';
    const now = () => new Date('2026-11-10T05:00:00.000Z');
    const snapshot = materializeLegacyDraft(preview, projectId, now, uuidSeq());
    expect(snapshot.revision).toBe(1);
    expect(snapshot.projectId).toBe(projectId);
    expect(snapshot.data.schemaVersion).toBe(1);
    // 复制产物可被契约层直接读写。
    expect(sitePlanSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(sitePlanDataSchema.safeParse(snapshot.data).success).toBe(true);
  });
});