/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PlanCard } from './plan-card';
import type { LayoutPlanDraft } from '../../../lib/plan-annotation';
import type { ScoredPlan } from '../../../lib/plan-scoring';
import { getCatalogByType } from '../../../lib/furniture-catalog';

/** 造一份最小草案（一个阶段、一个圆桌区标注）。 */
function draft(): LayoutPlanDraft {
  return {
    id: 'draft-1',
    createdAt: 0,
    stages: [{ stageNo: 1, title: '宴会摆位', rationale: '居中圆桌区', annotationIds: ['z1'] }],
    annotations: [{
      id: 'z1', kind: 'zone', label: '圆桌区', stageNo: 1,
      geometry: { kind: 'rect', x: -8, z: -5, width: 16, depth: 10 },
      zoneType: 'roundtable',
    }],
  };
}

/** 造一版打分结果；覆盖点由调用方改。 */
function plan(overrides: Partial<ScoredPlan> = {}): ScoredPlan {
  return {
    variantId: 'balanced',
    label: '适中',
    density: 0.5,
    placements: [{ zoneId: 'z1', zoneType: 'roundtable', x: 0, z: 0, rotation: 0, spec: getCatalogByType('dining-chair')! }],
    skipped: [],
    capacitySeats: 24,
    outOfBounds: 0,
    flow: { aisleWidthM: null, wheelChairPassable: null, normalPassable: null, checkinBlocked: null, status: 'unknown', violations: [] },
    score: 24,
    reasons: ['适中：平衡容量与通道；可坐 24 座'],
    violations: [],
    subScores: { capacity: 100, flow: 100, ergonomics: 100 },
    assurance: 'draft_unverified',
    feasible: true,
    feasibilityStatus: 'INSUFFICIENT_INPUT',
    ...overrides,
  };
}

const noop = (): void => undefined;

afterEach(() => {
  // jsdom 环境没有自动 cleanup，不清理会让上一个用例的卡片串进下一个。
  cleanup();
});

describe('PlanCard 版级可行性出口（SC-19/G1）', () => {
  it('feasible=false 的版本出「不可行」徽标，不假装是一张正常分数条', () => {
    const bad = plan({
      variantId: 'dense',
      label: '密',
      feasible: false,
      feasibilityStatus: 'INFEASIBLE',
      violations: [{ code: 'CHAIR_GAP', severity: 'hard', message: '餐椅间距仅 0.69m，小于 0.90m 过挤' }],
    });
    render(
      <PlanCard draft={draft()} plans={[plan(), bad]} recommendedId="balanced"
        onApprove={noop} onReplace={noop} onCancel={noop} onComment={noop} />,
    );
    expect(screen.getByTestId('plan-variant-badge-dense').textContent).toContain('不可行');
    // 无硬冲突也不能把未知检查标成通过。
    expect(screen.getByTestId('plan-variant-badge-balanced').textContent).toContain('待核验');
  });

  it('缺资料（INSUFFICIENT_INPUT）出「待核验」徽标', () => {
    const insufficient = plan({ feasible: false, feasibilityStatus: 'INSUFFICIENT_INPUT' });
    render(
      <PlanCard draft={draft()} plans={[insufficient]} recommendedId={undefined}
        onApprove={noop} onReplace={noop} onCancel={noop} onComment={noop} />,
    );
    expect(screen.getByTestId('plan-variant-badge-balanced').textContent).toContain('待核验');
  });

  it('推测门草案（draft_unverified）出「待核验草案」小字', () => {
    render(
      <PlanCard draft={draft()} plans={[plan({ assurance: 'draft_unverified' })]} recommendedId="balanced"
        onApprove={noop} onReplace={noop} onCancel={noop} onComment={noop} />,
    );
    expect(screen.getByTestId('plan-card-draft-unverified').textContent).toContain('待核验草案');
  });

  it('REC=null：先出「没有可推荐方案」横幅并列硬冲突清单，不出「推荐」标签', () => {
    const a = plan({
      variantId: 'sparse', label: '松', feasible: false, feasibilityStatus: 'INFEASIBLE',
      violations: [{ code: 'ZONE_UNREACHABLE', severity: 'hard', message: '「圆桌区」被桌椅围死，人走不过去' }],
    });
    const b = plan({
      variantId: 'balanced', feasible: false, feasibilityStatus: 'INFEASIBLE',
      violations: [{ code: 'BBOX_OVERLAP', severity: 'hard', message: '圆桌 与 餐椅 位置压住' }],
    });
    render(
      <PlanCard draft={draft()} plans={[a, b]} recommendedId={undefined}
        onApprove={noop} onReplace={noop} onCancel={noop} onComment={noop} />,
    );
    const banner = screen.getByTestId('plan-card-no-recommendation');
    expect(banner.textContent).toContain('没有可推荐方案');
    expect(banner.textContent).toContain('被桌椅围死');
    expect(banner.textContent).toContain('位置压住');
    expect(screen.queryByText('✅ 推荐 适中版')).toBeNull();
  });

  it('有推荐版时不横幅、照常出「✅ 推荐」标签', () => {
    render(
      <PlanCard draft={draft()} plans={[plan()]} recommendedId="balanced"
        onApprove={noop} onReplace={noop} onCancel={noop} onComment={noop} />,
    );
    expect(screen.queryByTestId('plan-card-no-recommendation')).toBeNull();
    expect(screen.getByText('✅ 推荐 适中版')).toBeDefined();
  });

  it('未生成完整物料或检查未知时，不误称所有候选存在硬冲突', () => {
    const incomplete = plan({ placements: [], violations: [{ code: 'DOOR_UNKNOWN', severity: 'soft', status: 'unknown', message: '门位置待核验' }] });
    render(
      <PlanCard draft={draft()} plans={[incomplete]} recommendedId={undefined}
        onApprove={noop} onReplace={noop} onCancel={noop} onComment={noop} />,
    );
    expect(screen.queryByTestId('plan-card-no-recommendation')).toBeNull();
    expect(screen.getByText(/本次没有找到可应用的完整候选/)).toBeDefined();
    expect(screen.getByText('门位置待核验')).toBeDefined();
  });
});

describe('PlanCard 推荐理由露出（B4 降容话术）', () => {
  it('推荐版行下渲染「推荐理由」块，降容建议行带琥珀色 testid', () => {
    render(
      <PlanCard
        draft={draft()}
        plans={[plan({
          reasons: [
            '适中：平衡容量与通道；可坐 24 座（6 件家具）',
            '实际通行条件仍需核验',
            '当前这些区域估算 24 座，距目标 250 座还差约 226 座；可调整区域、摆法或目标人数。',
          ],
        })]}
        recommendedId="balanced"
        onApprove={noop} onReplace={noop} onCancel={noop} onComment={noop} />,
    );
    const block = screen.getByTestId('plan-card-recommended-reasons');
    expect(block.textContent).toContain('推荐理由');
    expect(block.textContent).toContain('可坐 24 座（6 件家具）');
    // B4 核心：降容建议出方案时就可见，不再埋在批准 toast 的 slice(0,2) 之后。
    const advice = screen.getByTestId('plan-card-capacity-advice');
    expect(advice.textContent).toContain('距目标 250 座还差约 226 座');
    expect(advice.textContent).not.toContain('场地最多');
  });

  it('非推荐版不渲染理由块（只在推荐版露出，避免三版理由刷屏）', () => {
    render(
      <PlanCard
        draft={draft()}
        plans={[plan(), plan({ variantId: 'dense', label: '密', reasons: ['密：多摆但通道紧'] })]}
        recommendedId="balanced"
        onApprove={noop} onReplace={noop} onCancel={noop} onComment={noop} />,
    );
    expect(screen.getByTestId('plan-card-recommended-reasons').textContent).toContain('平衡容量与通道');
    // dense 版的理由不出现在页面上。
    expect(screen.queryByText('密：多摆但通道紧')).toBeNull();
  });

  it('与 violations 逐字相同的理由去重，不与违规清单重复列一遍', () => {
    const dupMessage = '圆桌 与 餐椅 位置压住';
    render(
      <PlanCard
        draft={draft()}
        plans={[plan({
          reasons: ['适中：平衡容量与通道；可坐 24 座', dupMessage],
          violations: [{ code: 'BBOX_OVERLAP', severity: 'soft', message: dupMessage }],
        })]}
        recommendedId="balanced"
        onApprove={noop} onReplace={noop} onCancel={noop} onComment={noop} />,
    );
    const block = screen.getByTestId('plan-card-recommended-reasons');
    // 违规清单区与理由块各自存在……
    expect(block.textContent).toContain('平衡容量与通道');
    // ……但同一句话不在理由块重复。
    expect(block.textContent).not.toContain(dupMessage);
    // 违规清单里仍有一份。
    expect(screen.getByText(dupMessage)).toBeDefined();
  });
});
