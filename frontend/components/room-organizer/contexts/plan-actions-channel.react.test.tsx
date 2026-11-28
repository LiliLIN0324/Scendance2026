// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStarterOutdoorPlan } from '../lib/outdoor-project-store';
import {
  applyFacilityAction,
  type PlanActions,
} from '../lib/plan-facility-actions';
import {
  RoomEditorProvider,
  useRoomEditor,
  type RoomEditorContextValue,
} from './room-editor-context';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

function Probe({ capture }: { capture: (ctx: RoomEditorContextValue) => void }) {
  const ctx = useRoomEditor();
  capture(ctx);
  return (
    <div>
      <span data-testid="has-actions">{ctx.planActions ? 'yes' : 'no'}</span>
      <span data-testid="revision">{ctx.planRevision}</span>
      <span data-testid="facilities">{ctx.outdoorPlan?.facilities.length ?? 0}</span>
    </div>
  );
}

/**
 * 壳内私有编排（applyPlanPatch 写 ref/state、revision useState 计数）不可直达，
 * 这里用本地闭包模拟同一通道语义：纯层算出下一份 plan → 回写本地 plan 与 revision，
 * 再经 Provider 透传，验证 context 通道把 planActions / planRevision / outdoorPlan 带得到。
 */
function useBoundChannel() {
  let plan: SitePlanData = createStarterOutdoorPlan();
  let revision = 0;
  const actions: PlanActions = {
    applyFacility: (action) => {
      const result = applyFacilityAction(plan, action);
      if (result.ok) {
        plan = result.value;
        revision += 1;
      }
      return result;
    },
    applyZone: () => ({
      ok: false,
      issue: { code: 'not-found' as const, message: 'zone 通道未在本夹具绑定。' },
    }),
  };
  return {
    snapshot: () => ({ plan, revision, actions }),
  };
}

describe('planActions / planRevision context 通道（B-1）', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('绑定 plan：planActions 可达，patch 成功后 revision +1、plan 设施更新并经 context 透出', () => {
    const channel = useBoundChannel();
    let captured: RoomEditorContextValue | null = null;

    const first = channel.snapshot();
    render(
      <RoomEditorProvider
        value={{ outdoorPlan: first.plan, planActions: first.actions, planRevision: first.revision } as unknown as RoomEditorContextValue}
      >
        <Probe capture={(ctx) => { captured = ctx; }} />
      </RoomEditorProvider>,
    );
    expect(screen.getByTestId('has-actions').textContent).toBe('yes');
    expect(screen.getByTestId('revision').textContent).toBe('0');

    const result = captured!.planActions!.applyFacility({
      kind: 'add',
      input: { templateId: 'booth-2x2', position: { x: 2, y: 2 } },
    });
    expect(result.ok).toBe(true);

    // 模拟壳内 setState 回写后重渲：新 plan 与 revision 经 Provider 透出。
    const next = channel.snapshot();
    cleanup();
    render(
      <RoomEditorProvider
        value={{ outdoorPlan: next.plan, planActions: next.actions, planRevision: next.revision } as unknown as RoomEditorContextValue}
      >
        <Probe capture={() => undefined} />
      </RoomEditorProvider>,
    );
    expect(screen.getByTestId('revision').textContent).toBe('1');
    expect(screen.getByTestId('facilities').textContent).toBe('1');
  });

  it('legacy 草稿（无 outdoorPlan）：planActions 为 null，revision 透传为 0', () => {
    render(
      <RoomEditorProvider
        value={{ outdoorPlan: null, planActions: null, planRevision: 0 } as unknown as RoomEditorContextValue}
      >
        <Probe capture={() => undefined} />
      </RoomEditorProvider>,
    );
    expect(screen.getByTestId('has-actions').textContent).toBe('no');
    expect(screen.getByTestId('revision').textContent).toBe('0');
    expect(screen.getByTestId('facilities').textContent).toBe('0');
  });
});
