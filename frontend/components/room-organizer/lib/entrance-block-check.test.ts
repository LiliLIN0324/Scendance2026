import { describe, expect, it } from 'vitest';
import { checkEntranceBlocks } from './entrance-block-check';
import type { FurnitureItem, RoomLayout } from './types';

function item(partial: Partial<FurnitureItem> & Pick<FurnitureItem, 'id' | 'name' | 'type'>): FurnitureItem {
  return { width: 1, depth: 1, height: 0.7, color: '#888', icon: '📦', ...partial } as FurnitureItem;
}

function layout(items: FurnitureItem[], size = { width: 12.9, height: 7.1 }): RoomLayout {
  return { name: '测试', width: size.width, height: size.height, floors: [{ id: 'f1', name: '1F', height: 2.8, items }] } as unknown as RoomLayout;
}

const southDoor = item({ id: 'door-1', name: '门洞', type: 'door', width: 1.2, depth: 0.12, position: { x: 0, z: 3.54 }, structuralOpeningId: 'open-1' });

describe('checkEntranceBlocks — 门口净区被家具压住', () => {
  it('桌子压在南门净区上：报 blockedEntrances 与人话警告', () => {
    const desk = item({ id: 'desk-1', name: '课桌', type: 'desk', width: 1.8, depth: 0.6, position: { x: 0.3, z: 3.0 } });
    const report = checkEntranceBlocks(layout([southDoor, desk]));
    expect(report.blockedEntrances).toBe(1);
    expect(report.offenders).toContain('课桌');
    expect(report.message).toContain('门口被挡');
    expect(report.message).toContain('课桌');
    expect(report.message).toContain('推测');
  });

  it('家具离门口净区远：不警告', () => {
    const desk = item({ id: 'desk-1', name: '课桌', type: 'desk', width: 1.8, depth: 0.6, position: { x: 0, z: 0 } });
    const report = checkEntranceBlocks(layout([southDoor, desk]));
    expect(report.blockedEntrances).toBe(0);
    expect(report.message).toBeNull();
  });

  it('斜放的家具按旋转后 AABB 计算，也能抓到压门', () => {
    const rotated = item({ id: 'desk-2', name: '斜放课桌', type: 'desk', width: 2.4, depth: 0.6, position: { x: 0.2, z: 3.2 }, rotation: Math.PI / 4 });
    const report = checkEntranceBlocks(layout([southDoor, rotated]));
    expect(report.blockedEntrances).toBe(1);
    expect(report.offenders).toContain('斜放课桌');
  });

  it('没有门标记时不虚构门位，返回 null 警告', () => {
    const desk = item({ id: 'desk-1', name: '课桌', type: 'desk', width: 1.8, depth: 0.6, position: { x: 0, z: 3.0 } });
    const report = checkEntranceBlocks(layout([desk]));
    expect(report.blockedEntrances).toBe(0);
    expect(report.message).toBeNull();
  });

  it('门标记与窗不作为家具参与压门判定', () => {
    const window = item({ id: 'win-1', name: '窗', type: 'window', width: 1.2, depth: 0.12, position: { x: 2, z: 3.54 } });
    const anotherDoor = item({ id: 'door-2', name: '侧门', type: 'door', width: 0.9, depth: 0.12, position: { x: -5, z: 3.54 }, structuralOpeningId: 'open-2' });
    const report = checkEntranceBlocks(layout([southDoor, window, anotherDoor]));
    expect(report.blockedEntrances).toBe(0);
    expect(report.message).toBeNull();
  });

  it('多件家具压同一扇门只计一次门，家具名都列出', () => {
    const deskA = item({ id: 'a', name: '签到台', type: 'reception-desk', width: 1.8, depth: 0.6, position: { x: -0.4, z: 3.1 } });
    const deskB = item({ id: 'b', name: '课桌', type: 'desk', width: 1.2, depth: 0.6, position: { x: 0.8, z: 3.2 } });
    const report = checkEntranceBlocks(layout([southDoor, deskA, deskB]));
    expect(report.blockedEntrances).toBe(1);
    expect(report.offenders).toEqual(expect.arrayContaining(['签到台', '课桌']));
  });
});
