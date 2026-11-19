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
});
