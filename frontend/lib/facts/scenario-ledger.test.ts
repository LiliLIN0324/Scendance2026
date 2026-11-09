import { describe, expect, it } from 'vitest';
import {
  HALL_D5_OFFICIAL,
  accountChairs,
  buildDeliveryAudit,
  compareSeatCounts,
  freezeDeliveryAudit,
  hallD5SyntheticLecture,
  refreshFrozenAudit,
  reviewConclusions,
  reviewProtectedObjects,
  type FactSnapshot,
  type InventoryLine,
} from './scenario-ledger';

const desk = (quantity: number, source: InventoryLine['source'], identity = 'catalog:desk-chair-en'): InventoryLine => ({
  identity, name: '课桌椅', dimensions: { widthM: 0.49, depthM: 0.57, heightM: 0.9 }, quantity, evidence: '测试行', source,
});

describe('三本椅子账', () => {
  it('口述 80、两种场景模型和不足的核实库存分别解释', () => {
    const ledger = accountChairs({
      oral: [{ identity: 'oral:unspecified-chair', name: '椅子', dimensions: null, quantity: 80, evidence: '我们有80把椅子', source: 'user_statement' }],
      sceneModels: [
        desk(100, 'catalog_model'),
        desk(26, 'catalog_model', 'catalog:staff-chair'),
      ],
      verifiedStock: [desk(40, 'verified_stock')],
    });
    expect(ledger.oral[0]).toMatchObject({ quantity: 80, source: 'user_statement' });
    expect(ledger.sceneModels.map(line => line.quantity)).toEqual([100, 26]);
    expect(ledger.verifiedStock).toHaveLength(1);
    expect(ledger.stockStatus).toBe('unknown');
    expect(ledger.unmatchedSceneIdentities).toEqual(['catalog:staff-chair']);
    expect(ledger.shortages).toEqual([{ identity: 'catalog:desk-chair-en', name: '课桌椅', sceneQuantity: 100, verifiedQuantity: 40, missing: 60 }]);
    expect(ledger.explanations.join('\n')).toContain('不是参加人数');
    expect(ledger.explanations.join('\n')).toContain('还差 60');
    expect(ledger.explanations.join('\n')).not.toContain('缺 40');
  });

  it('同身份同规格且数量足够时只承认数量，不承认采购', () => {
    const ledger = accountChairs({ oral: [], sceneModels: [desk(4, 'catalog_model')], verifiedStock: [desk(4, 'verified_stock')] });
    expect(ledger.stockStatus).toBe('quantity_met');
    expect(ledger.explanations.join('\n')).toContain('不表示已经采购');
  });

  it('没有核实行时保持未知，不用口述数量补上', () => {
    const ledger = accountChairs({
      oral: [{ identity: 'oral:unspecified-chair', name: '椅子', dimensions: null, quantity: 80, evidence: '我们有80把椅子', source: 'user_statement' }],
      sceneModels: [desk(10, 'catalog_model')],
      verifiedStock: [],
    });
    expect(ledger.stockStatus).toBe('unknown');
    expect(ledger.shortages).toEqual([]);
  });

  it('规格不同即使身份相同也不轧差', () => {
    const other = desk(10, 'verified_stock');
    other.dimensions = { widthM: 0.538, depthM: 0.567, heightM: 0.9 };
    const ledger = accountChairs({ oral: [], sceneModels: [desk(10, 'catalog_model')], verifiedStock: [other] });
    expect(ledger.stockStatus).toBe('unknown');
    expect(ledger.shortages).toEqual([]);
  });

  it('来源放错列时整本账未知', () => {
    const ledger = accountChairs({ oral: [desk(80, 'verified_stock')], sceneModels: [], verifiedStock: [] });
    expect(ledger.stockStatus).toBe('unknown');
  });
});

describe('事实变化与保护属性', () => {
  const facts: FactSnapshot[] = [
    { key: 'door_width', revision: 2, status: 'confirmed', source: 'site_confirmed', value: '1.4m' },
    { key: 'area', revision: 1, status: 'pending', source: 'official_nominal', value: '285㎡' },
  ];

  it('未知、官网标称和过期版本都不能维持通过', () => {
    const reviewed = reviewConclusions(facts, [
      { id: 'old-door', status: 'pass', basedOn: [{ key: 'door_width', revision: 1 }] },
      { id: 'nominal', status: 'pass', basedOn: [{ key: 'area', revision: 1 }] },
      { id: 'missing', status: 'pass', basedOn: [{ key: 'fire', revision: 0 }] },
      { id: 'empty', status: 'pass', basedOn: [] },
      { id: 'site', status: 'pass', basedOn: [{ key: 'door_width', revision: 2 }] },
    ]);
    expect(reviewed.map(item => [item.id, item.effectiveStatus])).toEqual([
      ['old-door', 'stale'],
      ['nominal', 'unknown'],
      ['missing', 'stale'],
      ['empty', 'unknown'],
      ['site', 'pass'],
    ]);
  });

  it('换了 ID 的讲台即使数量仍是一件也不算保留', () => {
    const review = reviewProtectedObjects(
      [{ id: 'podium-1', floorId: 'hall', locked: true, keepPosition: true, position: { x: 0, z: -6 }, rotation: 0, elevation: 0 }],
      [{ id: 'podium-2', floorId: 'hall', locked: true, keepPosition: true, position: { x: 0, z: -6 }, rotation: 0, elevation: 0 }],
    );
    expect(review.status).toBe('violated');
    expect(review.missingIds).toEqual(['podium-1']);
  });

  it('同一 ID 解除锁定或移开原位都单独列出', () => {
    const required = [{ id: 'podium-1', floorId: 'hall', locked: true, keepPosition: true, position: { x: 0, z: -6 }, rotation: 0, elevation: 0 }];
    const unlocked = reviewProtectedObjects(required, [{ ...required[0]!, locked: false }]);
    const moved = reviewProtectedObjects(required, [{ ...required[0]!, position: { x: 1, z: -6 } }]);
    expect(unlocked.protectionChangedIds).toEqual(['podium-1']);
    expect(moved.movedIds).toEqual(['podium-1']);
    expect(unlocked.status).toBe('violated');
    expect(moved.status).toBe('violated');
  });
});

describe('Hall D5 合成讲座', () => {
  const scenario = hallD5SyntheticLecture();

  it('官网标称、估算矩形和座位数差同时留下，且不算校准', () => {
    expect(scenario.execution).toBe('simulated');
    expect(scenario.event.statedHeadcount).toBe(30);
    expect(scenario.delivery.planDimensions).toMatchObject({ widthM: 19, depthM: 15, source: 'estimate' });
    expect(scenario.delivery.nominalDimensions).toMatchObject({ widthM: 16.5, depthM: 17.2, areaM2: 285, source: 'official_nominal' });
    expect(HALL_D5_OFFICIAL.widthM * HALL_D5_OFFICIAL.depthM).not.toBe(HALL_D5_OFFICIAL.areaM2);
    expect(scenario.seatComparison).toMatchObject({ referenceSeats: 120, syntheticSeats: 126, delta: 6, calibration: false });
    expect(scenario.seatComparison.reason).toContain('不能当作测量误差');
    expect(scenario.humanBaseline.referenceSeats).toBe(120);
  });

  it('安全检查和生成清单都不因调用方写了通过而变成验收', () => {
    expect(scenario.chairs.stockStatus).toBe('unknown');
    expect(scenario.conclusions.every(item => item.effectiveStatus !== 'pass')).toBe(true);
    expect(scenario.protection.status).toBe('violated');
    const safety = scenario.delivery.checks.filter(check => ['door_width', 'fire', 'accessibility', 'approved_capacity', 'inventory_on_site'].includes(check.id));
    expect(safety.every(check => check.status === 'unknown')).toBe(true);
    expect(scenario.delivery.listMeans).toBe('generated_not_procured_or_placed');
    expect(scenario.delivery.tasks.every(task => task.executed === false)).toBe(true);
    expect(scenario.delivery.unverified.join('\n')).toContain('生成清单不等于已采购或已布置');
    expect(scenario.delivery.materials.map(item => [item.identity, item.quantity])).toEqual([
      ['catalog:desk-chair-en', 100],
      ['catalog:staff-chair', 26],
    ]);
  });

  it('冻结后的事实版本一旦变化，刷新结果就是过期', () => {
    expect(refreshFrozenAudit(scenario.frozen, scenario.facts).status).toBe('current');
    const changed = scenario.facts.map(fact => fact.key === 'door_width' ? { ...fact, revision: 1, status: 'pending' as const, source: 'drawing_observation' as const, value: '图上无数字' } : fact);
    const refreshed = refreshFrozenAudit(scenario.frozen, changed);
    expect(refreshed).toEqual({ status: 'stale', staleKeys: ['door_width'] });
    expect(reviewConclusions(changed, [{ id: 'door', status: 'pass', basedOn: [{ key: 'door_width', revision: 0 }] }])[0]!.effectiveStatus).toBe('stale');
  });

  it('相同座位数在不同边界上仍然不是校准', () => {
    expect(compareSeatCounts({ referenceSeats: 120, referenceBoundary: 'diagram', syntheticSeats: 120, syntheticBoundary: 'estimate' }).calibration).toBe(false);
  });

  it('交付审核会改写没有现场确认的通过项', () => {
    const audit = buildDeliveryAudit({
      planDimensions: scenario.delivery.planDimensions,
      nominalDimensions: null,
      materials: [],
      assumptions: [],
      checks: [{ id: 'fire', status: 'pass', detail: '论文里写过' }],
      unverified: [],
      tasks: [{ id: 'task', title: '摆椅子' }],
      facts: scenario.facts,
    });
    expect(audit.checks[0]!.status).toBe('unknown');
    expect(audit.execution).toBe('simulated');
    expect(audit.tasks[0]!.executed).toBe(false);
  });

  it('冻结拒绝无效版本号', () => {
    expect(() => freezeDeliveryAudit(scenario.delivery, scenario.facts, 0)).toThrow('冻结版本号无效');
  });
});
