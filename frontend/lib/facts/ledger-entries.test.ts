import { describe, expect, it } from 'vitest';
import { assertGeneratedListNotProcured, deliveryListViolations } from './delivery-list-guard';
import {
  assembleThreeLedgers,
  deliveryChecklistText,
  guangzhouHealthLecture,
  ledgerChecklistLines,
  oralLinesFromReports,
  sceneLinesFromCounts,
  withholdCandidateInventory,
} from './ledger-entries';
import { hallD5SyntheticLecture } from './scenario-ledger';

const desk = {
  identity: 'catalog:desk-chair-en',
  name: '课桌椅（英文页目录尺寸）',
  widthM: 0.49,
  depthM: 0.57,
  heightM: 0.9,
  evidence: '合成场景中的目录模型，尺寸取官网英文页，不是现场家具。',
};

describe('三本账入口', () => {
  it('从原话、场景计数和显式核实列重现 Hall D5 的分账', () => {
    const ledger = assembleThreeLedgers({
      reports: [{ evidence: '我们有80把椅子', status: 'reported' }],
      scene: [
        { ...desk, quantity: 100 },
        { identity: 'catalog:staff-chair', name: '工作人员椅', widthM: 0.45, depthM: 0.45, heightM: 0.9, quantity: 26, evidence: '合成场景中的另一椅型，用来说明不能按总数轧差。' },
      ],
      verified: [{ identity: 'catalog:desk-chair-en', name: '课桌椅（英文页目录尺寸）', dimensions: { widthM: 0.49, depthM: 0.57, heightM: 0.9 }, quantity: 40, evidence: '合成假定：同规格 40 把。这不是场地方盘点。', source: 'verified_stock' }],
    });
    const original = hallD5SyntheticLecture().chairs;
    expect(ledger.oral[0]).toMatchObject({ name: '椅子', quantity: 80, evidence: '我们有80把椅子', source: 'user_statement', dimensions: null });
    expect(ledger.sceneModels).toEqual(original.sceneModels);
    expect(ledger.verifiedStock).toEqual(original.verifiedStock);
    expect(ledger.stockStatus).toBe('unknown');
    expect(ledger.shortages).toEqual(original.shortages);
  });

  it('采购句、人数句和需复核句不会变成核实库存', () => {
    const parsed = oralLinesFromReports([
      { evidence: '需要采购80把椅子', status: 'reported' },
      { evidence: '预计30人', status: 'reported' },
      { evidence: '我们有80把椅子', status: 'needs_review' },
    ]);
    expect(parsed.unread).toEqual(['需要采购80把椅子', '预计30人']);
    expect(parsed.lines).toEqual([expect.objectContaining({ quantity: 80, source: 'user_statement', evidence: '我们有80把椅子（需复核）' })]);
  });

  it('用户填写的 80 把留在候选说明里，不进入核实列', () => {
    const held = withholdCandidateInventory({
      origin: 'user_reported',
      entries: [{ identity: { kind: 'type', value: 'chair' }, name: '椅子', available: 80, dimensions: { width: 0.49, depth: 0.57, height: 0.9 } }],
    });
    expect(held.verifiedStock).toEqual([]);
    expect(held.note).toContain('不是核实库存');
    const ledger = assembleThreeLedgers({
      reports: [{ evidence: '我们有80把椅子', status: 'reported' }],
      scene: [{ ...desk, quantity: 4 }],
      candidate: { origin: 'assumption', entries: [{ identity: { kind: 'type', value: 'chair' }, name: '椅子', available: 80, dimensions: { width: 0.49, depth: 0.57, height: 0.9 } }] },
      verified: [{ ...desk, dimensions: { widthM: 0.49, depthM: 0.57, heightM: 0.9 }, quantity: 4, source: 'catalog_model' }],
    });
    expect(ledger.verifiedStock).toEqual([]);
    expect(ledger.stockStatus).toBe('unknown');
    expect(ledger.withheldCandidateNote).toContain('假设');
  });

  it('场景行缺规格时不并进已有椅型', () => {
    const scene = sceneLinesFromCounts([
      { ...desk, quantity: 4 },
      { ...desk, identity: 'catalog:staff-chair', quantity: 2, widthM: 0 },
    ]);
    expect(scene.lines).toHaveLength(1);
    expect(scene.rejected).toEqual(['catalog:staff-chair']);
  });
});

describe('广州会议室 6 合成讲座', () => {
  const scenario = guangzhouHealthLecture();

  it('45 人课桌任务、口述 80 和剧院参考 80 各留各的账', () => {
    expect(scenario.execution).toBe('simulated');
    expect(scenario.event.statedHeadcount).toBe(45);
    expect(scenario.chairs.oral[0]).toMatchObject({ quantity: 80, identity: 'oral:椅子' });
    expect(scenario.chairs.sceneModels[0]).toMatchObject({ quantity: 45, identity: 'catalog:desk-chair-en' });
    expect(scenario.chairs.verifiedStock).toEqual([]);
    expect(scenario.chairs.stockStatus).toBe('unknown');
    expect(scenario.chairs.explanations.join('\n')).toContain('剧院参考 80');
    expect(scenario.seatComparison).toMatchObject({ referenceSeats: 45, syntheticSeats: 45, delta: 0, calibration: false });
    expect(scenario.delivery.planDimensions).toMatchObject({ widthM: 12.9, depthM: 7.1, source: 'official_nominal' });
    expect(12.9 * 7.1).not.toBe(93);
  });

  it('清单文本保持生成说明，签到台换 ID 后不算保留', () => {
    assertGeneratedListNotProcured(scenario.checklist);
    expect(deliveryListViolations(scenario.checklist)).toEqual([]);
    expect(scenario.checklist).toContain('口述');
    expect(scenario.checklist).toContain('场景模型');
    expect(scenario.conclusions[0]!.effectiveStatus).not.toBe('pass');
    expect(scenario.protection).toMatchObject({ status: 'violated', missingIds: ['checkin-1'] });
    expect(scenario.delivery.checks.every(check => check.status !== 'pass')).toBe(true);
    expect(scenario.delivery.tasks.every(task => task.executed === false)).toBe(true);
  });
});

describe('生成清单护栏', () => {
  it('数量足够的清单仍然写着未采购', () => {
    const ledger = assembleThreeLedgers({
      scene: [{ ...desk, quantity: 4 }],
      verified: [{ identity: desk.identity, name: desk.name, dimensions: { widthM: 0.49, depthM: 0.57, heightM: 0.9 }, quantity: 4, evidence: '合成核实', source: 'verified_stock' }],
    });
    expect(ledger.stockStatus).toBe('quantity_met');
    const text = deliveryChecklistText(hallD5SyntheticLecture().delivery, ledger);
    assertGeneratedListNotProcured(text);
    expect(text).toContain('规格与采购待确认');
    expect(ledgerChecklistLines(ledger).map(line => line.column)).toEqual(['场景模型', '核实库存']);
  });

  it('认出已采购和已布置的完成态措辞', () => {
    expect(deliveryListViolations('物料已采购并且已布置')).toEqual(['已采购', '已布置']);
    expect(deliveryListViolations(`数量已列出。${'生成清单不等于已采购或已布置。'}`)).toEqual([]);
    expect(() => assertGeneratedListNotProcured('已生成清单')).toThrow('缺少生成说明');
    expect(() => assertGeneratedListNotProcured('生成清单不等于已采购或已布置。另外物料已采购。')).toThrow('已采购');
  });
});
