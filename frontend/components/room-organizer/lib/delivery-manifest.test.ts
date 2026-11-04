// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { deliveryManifestCsv } from './scene-delivery';
import type { RoomLayout } from './types';

const base: RoomLayout = {
  name: '西湖共创',
  width: 8,
  height: 3,
  floors: [{ id: 'f1', name: '1F', items: [], floorColor: '' }],
};

describe('delivery manifest', () => {
  it('lists every export with the same package names, counts and missing reasons', async () => {
    const csv = await deliveryManifestCsv(base, { id: 'delivery-1', generatedAt: '2026-11-04T10:00:00.000Z' });
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('\r\n');
    expect(csv.split('\r\n')[0]).toContain('"类别","建议文件名","状态","件数","说明","交付编号","生成时间"');
    expect(csv).toContain('西湖共创_交付清单_delivery-1.csv');
    expect(csv).toContain('西湖共创_平面_1F.dxf');
    expect(csv).toContain('西湖共创_平面_1F.pdf');
    expect(csv).toContain('西湖共创_物料清单_delivery-1.csv');
    expect(csv).toContain('西湖共创_执行清单_delivery-1.csv');
    expect(csv).toContain('西湖共创_场景_delivery-1.json');
    expect(csv).toContain('西湖共创_delivery-1.glb');
    // 没有活动任务时，三项内部资料明确写「需先补资料」，而不是空白。
    expect(csv.match(/需先补资料/g)?.length).toBe(3);
    expect(csv).toContain('delivery-1');
  });

  it('keeps unsupported scene types in the list and explains why', async () => {
    const preset = { ...base, scenePreset: 'loft' } as unknown as RoomLayout;
    const csv = await deliveryManifestCsv(preset);
    const line = csv.split('\r\n').find(row => row.includes('场景 GLB')) ?? '';
    expect(line).toContain('不支持');
    expect(line).toContain('完整场景预设暂不支持交付导出');
    expect(csv.split('\r\n').find(row => row.includes('平面图 DXF'))).toContain('可导出');
  });
});
