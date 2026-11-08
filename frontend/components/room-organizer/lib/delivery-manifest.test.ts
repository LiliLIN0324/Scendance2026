// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { deliveryManifestCsv } from './scene-delivery';
import { eventOperationsSchema } from '../../../../supabase/functions/_shared/event-operations-contract';
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
    const rows=csv.split('\r\n');
    const draft=rows.find(row=>row.includes('活动执行资料草案 HTML')) ?? '';
    const operations=rows.find(row=>row.includes('活动安排 CSV')) ?? '';
    const schedule=rows.find(row=>row.includes('执行时间表 HTML')) ?? '';
    // 草案可以进入导出前检查；未保存的活动安排和时间表必须先补资料。
    expect(draft).toContain('待导出时检查');expect(draft).toContain('未完整包含助手对话需求');
    expect(operations).toContain('需先补资料');expect(operations).toContain('先保存活动安排');
    expect(schedule).toContain('需先补资料');expect(schedule).toContain('先在活动安排中保存任务');
    expect([draft,operations,schedule].every(row=>!row.includes('可导出'))).toBe(true);
    const withTask:RoomLayout={...base,eventOperations:eventOperationsSchema.parse({tasks:[{id:'a0000000-0000-4000-8000-000000000001',title:'搭建',phase:'setup'}]})};
    const prepared=(await deliveryManifestCsv(withTask)).split('\r\n');
    for(const label of ['活动执行资料草案 HTML','活动安排 CSV','执行时间表 HTML']){
      const row=prepared.find(value=>value.includes(label)) ?? '';
      expect(row,label).toContain('待导出时检查');expect(row,label).not.toContain('可导出');
    }
    expect(csv).toContain('delivery-1');
  });

  it('keeps unsupported scene types in the list and explains why', async () => {
    const preset = { ...base, scenePreset: 'loft' } as unknown as RoomLayout;
    const csv = await deliveryManifestCsv(preset);
    const line = csv.split('\r\n').find(row => row.includes('场景 GLB')) ?? '';
    expect(line).toContain('不支持');
    expect(line).toContain('完整场景预设暂不支持交付导出');
    const dxf=csv.split('\r\n').find(row => row.includes('平面图 DXF')) ?? '';
    expect(dxf).toContain('待导出时检查');expect(dxf).not.toContain('可导出');
    expect(dxf).toContain('墙线未按门洞切断');expect(dxf).toContain('门洞标记、比例及现场尺寸仍需核对');
  });
});
