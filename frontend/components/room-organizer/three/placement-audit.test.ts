// @vitest-environment node
/**
 * 布置实测：跑一遍目录里的物理模型，打印底面离地与尺寸偏差。
 * 数字是验收依据，阈值改在这里就等于改验收标准。
 */
import { describe, expect, it } from 'vitest';
import {
  ACCEPTANCE,
  auditFloor,
  measureModel,
  measureRawModel,
  modelBaseOffset,
  catalogToItem,
} from './placement-audit';
import { findFreePosition, hasCollisions, itemsOverlap } from '../lib/geometry';
import { FURNITURE_CATALOG, ROOM_TEMPLATES } from '../lib/constants';
import { INITIAL_LAYOUT } from '../lib/initial-layout';

describe('布置实测', () => {
  it('打印目录全量实测（改前 / 改后）', () => {
    const pairs = FURNITURE_CATALOG.map(catalog => {
      const item = catalogToItem(catalog);
      return { before: measureRawModel(item), after: measureModel(item) };
    });
    const beforeFloor = pairs.filter(pair => pair.before.floorItem);
    const beforeGroundWorst = beforeFloor.slice().sort((a, b) => b.before.groundError - a.before.groundError).slice(0, 5);
    const beforeScaleWorst = pairs.slice().sort((a, b) => b.before.scaleErrorPct - a.before.scaleErrorPct).slice(0, 5);
    console.log('\n[布置] 改前贴地最差 5 件：');
    for (const pair of beforeGroundWorst) console.log(`  ${pair.before.type.padEnd(18)} 底面 ${(pair.before.bottomY * 100).toFixed(1)} cm  → 改后 ${(pair.after.bottomY * 100).toFixed(1)} cm`);
    console.log('[布置] 改前尺寸最差 5 件：');
    for (const pair of beforeScaleWorst) console.log(`  ${pair.before.type.padEnd(18)} 偏差 ${pair.before.scaleErrorPct.toFixed(1)}% → 改后 ${pair.after.scaleErrorPct.toFixed(2)}%`);

    const groundViolations = pairs.filter(pair => pair.after.floorItem && pair.after.groundError > ACCEPTANCE.groundM);
    const scaleViolations = pairs.filter(pair => pair.after.scaleErrorPct > ACCEPTANCE.scalePct);
    const beforeGroundViolations = beforeFloor.filter(pair => pair.before.groundError > ACCEPTANCE.groundM);
    const beforeScaleViolations = pairs.filter(pair => pair.before.scaleErrorPct > ACCEPTANCE.scalePct);
    console.log(
      `[布置] 贴地超差 ${beforeGroundViolations.length}/${beforeFloor.length} → ${groundViolations.length}/${pairs.filter(p => p.after.floorItem).length}；` +
      `尺寸超差 ${beforeScaleViolations.length}/${pairs.length} → ${scaleViolations.length}/${pairs.length}`
    );
    console.log('[布置] 高度按板厚/水体的组合件（高度不计入比例判定）：');
    for (const pair of pairs.filter(p => p.after.heightSubDimension)) {
      console.log(`  ${pair.after.type.padEnd(18)} 高度 ${pair.after.heightY.toFixed(3)} / 标称 ${pair.after.declared.height}（宽深偏差 ${pair.after.scaleErrorPct.toFixed(2)}%）`);
    }
    expect(groundViolations, `贴地超差：${groundViolations.map(v => `${v.after.type} ${v.after.groundError * 100}cm`).join(', ')}`).toHaveLength(0);
    expect(scaleViolations, `尺寸超差：${scaleViolations.map(v => `${v.after.type} ${v.after.scaleErrorPct}%`).join(', ')}`).toHaveLength(0);
  });

  it('初始布置与模板不穿插、不出墙', () => {
    const reports = [auditFloor('初始布置', INITIAL_LAYOUT.floors[0]!, INITIAL_LAYOUT)];
    for (const [key, template] of Object.entries(ROOM_TEMPLATES)) {
      for (const floor of template.floors) {
        reports.push(auditFloor(`${key}/${floor.name}`, floor as never, template as never));
      }
    }
    console.log('\n[布置] 穿插 / 越界清单：');
    let totalOverlap = 0;
    let totalOut = 0;
    for (const report of reports) {
      totalOverlap += report.overlaps;
      totalOut += report.outOfBounds;
      console.log(`  ${report.name.padEnd(24)} ${report.itemCount} 件  穿插 ${report.overlaps}  越界 ${report.outOfBounds}`);
      for (const pair of report.pairs) console.log(`      · ${pair}`);
    }
    expect(totalOverlap).toBe(0);
    expect(totalOut).toBe(0);
  });

  it('落点避让：把椅子拖进沙发里，收手后 0 穿插', () => {
    const sofa = { ...catalogToItem(FURNITURE_CATALOG.find(item => item.type === 'sofa')!), id: 'sofa', position: { x: 0, z: 0 } };
    const chair = { ...catalogToItem(FURNITURE_CATALOG.find(item => item.type === 'chair')!), id: 'chair', position: { x: 0, z: 0 } };
    const before = hasCollisions(chair, [sofa, chair], 10, 8);
    const resolved = findFreePosition({ item: chair, others: [sofa, chair], roomWidth: 10, roomDepth: 8 });
    const after = resolved ? hasCollisions({ ...chair, position: resolved }, [sofa, chair], 10, 8) : null;
    const moved = resolved ? Math.hypot(resolved.x - chair.position.x, resolved.z - chair.position.z) : null;
    console.log(
      `[布置] 椅子落在沙发上：改前穿插 ${before ? '是' : '否'}，改后 ${after === null ? '找不到空位' : after ? '仍穿插' : '0 穿插'}` +
      `${moved === null ? '' : `（最近空位距原点 ${moved.toFixed(2)} m）`}`
    );
    expect(before).toBe(true);
    expect(after).toBe(false);
    expect(resolved && itemsOverlap({ ...chair, position: resolved }, sofa)).toBe(false);
  });

  it('模型原点与包围盒底面的偏移可量（用于落地清单）', () => {
    const offsets = FURNITURE_CATALOG.slice(0, 6).map(item => ({
      type: item.type,
      offset: modelBaseOffset(catalogToItem(item)),
    }));
    console.log('[布置] 模型底面偏移样本：', offsets.map(o => `${o.type}=${o.offset}m`).join(' '));
    expect(offsets.length).toBe(6);
  });
});
