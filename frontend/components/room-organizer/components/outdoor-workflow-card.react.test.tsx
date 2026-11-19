// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { OutdoorWorkflowCard } from './outdoor-workflow-card';

/**
 * T1-d（2026-11-19）：卡片上幅不再用自绘示意地图冒充真实进度，
 * 改为一句简洁状态；真实候选/轮廓才上图。
 */
function makeFlow(stage = 'place') {
  const noop = vi.fn();
  return {
    state: { stage, brief: { zones: [] as unknown[] } },
    theme: undefined,
    proposal: null,
    pendingPlan: null,
    drawingMode: false,
    boundaryReady: false,
    proposalBusy: false,
    busy: false,
    loginRequired: false,
    loginSatisfied: true,
    notice: null,
    noticeKind: null,
    noticeView: null,
    noticeFix: null,
    noticeSticky: false,
    applyNoticeFix: noop,
    dismissNotice: noop,
    cardRecords: [] as unknown[],
    designSteps: [] as string[],
    drawnZones: [] as unknown[],
    boundaryRing: null as readonly { x: number; y: number }[] | null,
    unverifiedEntrances: [] as unknown[],
    libraryChoices: [] as unknown[],
    selectedLibraryId: null,
    models: null,
    thought: null,
    thoughtRequest: null,
    thoughtDraft: '',
    thoughtMs: null,
    awaitingThought: false,
    canvasNote: null,
    mapGap: false,
    scopeConfirmed: false,
    selectedFacility: null,
    approvePlan: noop,
    cancel: noop,
    handle: noop,
    action: noop,
    confirmProposal: noop,
    chooseLibrary: noop,
    importLibraryGlb: noop,
    cycleObjectsLayout: noop,
    startLux3dGeneration: noop,
    zoneEdits: {},
    manualBoundary: noop,
  };
}

describe('OutdoorWorkflowCard 上幅（T1-d）', () => {
  it('place 阶段只给一句状态，不再渲染示意地图', () => {
    const { container } = render(<OutdoorWorkflowCard flow={makeFlow() as never} />);

    expect(container.textContent).toContain('请核对活动实际范围');
    expect(container.querySelector('.ap-task-map')).toBeNull();
    expect(container.querySelector('[aria-label="地图缩略示意"]')).toBeNull();
  });

  it('zones 阶段同样没有示意地图', () => {
    const { container } = render(<OutdoorWorkflowCard flow={makeFlow('zones') as never} />);

    expect(container.querySelector('.ap-task-map')).toBeNull();
  });

  it('有真实红线时画真实轮廓，尺寸/面积/点数都从环算', () => {
    const flow = makeFlow();
    flow.boundaryRing = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 20 },
      { x: 0, y: 20 },
    ];
    const { container } = render(<OutdoorWorkflowCard flow={flow as never} />);

    expect(container.querySelector('.ap-boundary-thumb polygon')).not.toBeNull();
    expect(container.textContent).toContain('按画布真实用地红线：4 个点 · 30.0 × 20.0 m · 600 ㎡');
  });

  it('没有真实红线时不出轮廓、也不造示意图形', () => {
    const { container } = render(<OutdoorWorkflowCard flow={makeFlow() as never} />);

    expect(container.querySelector('.ap-boundary-thumb')).toBeNull();
    expect(container.querySelector('polygon')).toBeNull();
  });

  it('当前执行轨迹存在时不重复阶段图注，但真实红线轮廓仍保留', () => {
    const noCaption = render(<OutdoorWorkflowCard flow={makeFlow() as never} showCaption={false} />);
    expect(noCaption.container.querySelector('.ap-stage-caption')).toBeNull();
    noCaption.unmount();

    const flow = makeFlow();
    flow.boundaryRing = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 0, y: 20 }];
    const withRing = render(<OutdoorWorkflowCard flow={flow as never} showCaption={false} />);
    expect(withRing.container.querySelector('.ap-boundary-thumb polygon')).not.toBeNull();
    expect(withRing.container.textContent).toContain('按画布真实用地红线');
  });
});
