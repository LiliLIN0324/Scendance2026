// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts';
import { DeliveryChecklistShell, dossierStatus, WorkbenchModeCard } from './mode-shell';
import type { PlanFacility, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type { ReviewPin } from '../lib/review-pins';
import type { FloorLayout, FurnitureItem } from '../lib/types';

const agentMock = vi.hoisted(() => ({
  value: {
    callbacks: { workbenchMode: 'layout' as 'layout' | 'review' | 'delivery' },
    recap: { event: null, guests: null, dims: '', note: null },
    previewExport: vi.fn(),
  },
}));
vi.mock('./agent-panel', () => ({ useAgent: () => agentMock.value }));

const LEGACY_ITEM_ID = 'legacy-desk-1';
const PLAN_FACILITY_ID = 'facility-1';

function legacyFloor(): FloorLayout {
  const item: FurnitureItem = {
    id: LEGACY_ITEM_ID, type: 'reception', name: 'legacy 签到桌',
    width: 1.4, depth: 0.6, height: 0.75, color: '#ffffff', icon: '',
  };
  return { id: 'floor-1', name: '本层', items: [item], floorColor: '' };
}

function planFacility(overrides: Partial<PlanFacility> = {}): PlanFacility {
  return {
    id: PLAN_FACILITY_ID,
    templateId: 'dining-table',
    name: '签到台',
    position: { x: 1, y: 2 },
    rotationDeg: 0,
    size: { width: 1.8, depth: 1.8 },
    ...overrides,
  } as PlanFacility;
}

function planWith(facilities: readonly PlanFacility[]): SitePlanData {
  return { facilities: [...facilities] } as unknown as SitePlanData;
}

function editorValue(overrides: { activeFloor?: FloorLayout; outdoorPlan?: SitePlanData | null }): RoomEditorContextValue {
  return {
    activeFloor: overrides.activeFloor ?? legacyFloor(),
    outdoorPlan: overrides.outdoorPlan ?? null,
  } as unknown as RoomEditorContextValue;
}

const cardProps = {
  pinFilter: 'open' as const,
  activePinId: null as string | null,
  reviewCleared: false,
  onPinFilter: vi.fn(),
  onFocusPin: vi.fn(),
  onResolvePin: vi.fn(),
  onReturnPin: vi.fn(),
  onConfirmDelivery: vi.fn(),
  onExport: vi.fn(),
};

function reviewPin(itemId: string | null): ReviewPin {
  return {
    id: 'pin-1', text: '挡住通道', itemId,
    x: 0, y: 0, z: 0, offset: null,
    camera: { position: [0, 0, 0] as const, target: [0, 0, 0] as const },
    status: 'open',
  };
}

afterEach(cleanup);

describe('delivery checklist shell', () => {
  it('shows the arrival list, an export entry, and complete-or-missing status without the layout brief', () => {
    const onExport = vi.fn();
    const signIn = { id: 'desk-1', type: 'reception', name: '签到桌', width: 1.4, depth: 0.6, height: 0.75, color: '#ffffff', icon: '' };
    const { rerender } = render(<DeliveryChecklistShell items={[signIn, { ...signIn, id: 'desk-2' }]} onExport={onExport} />);
    const shell = screen.getByRole('region', { name: '执行清单' });
    expect(shell.textContent).toContain('到场清单');
    expect(shell.textContent).toContain('签到桌');
    expect(shell.textContent).toContain('2 件');
    expect(shell.textContent).toContain('资料状态 · 齐');
    expect(shell.textContent).not.toContain('这块场地从哪来');
    expect(shell.textContent).not.toContain('场地简报');
    expect(shell.textContent).not.toContain('活动还没说');
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    expect(onExport).toHaveBeenCalledOnce();

    rerender(<DeliveryChecklistShell items={[]} onExport={onExport} />);
    expect(screen.getByRole('region', { name: '执行清单' }).textContent).toContain('资料状态 · 缺');
    expect(dossierStatus(0)).toBe('缺');
    expect(dossierStatus(2)).toBe('齐');
  });
});

describe('WorkbenchModeCard 双读回落（S4 C-1）', () => {
  it('绑定 plan 态：执行清单渲染 plan facility 名称与件数，不带 legacy 物料名', () => {
    agentMock.value.callbacks.workbenchMode = 'delivery';
    const plan = planWith([
      planFacility({ id: PLAN_FACILITY_ID, name: '签到台' }),
      planFacility({ id: 'facility-2', name: '签到台' }),
    ]);
    render(<RoomEditorProvider value={editorValue({ outdoorPlan: plan })}>
      <WorkbenchModeCard pins={[]} {...cardProps} />
    </RoomEditorProvider>);
    const shell = screen.getByRole('region', { name: '执行清单' });
    expect(shell.textContent).toContain('签到台');
    expect(shell.textContent).toContain('2 件');
    expect(shell.textContent).not.toContain('legacy 签到桌');
  });

  it('legacy 草稿态（outdoorPlan 为 null）：执行清单沿用 activeFloor.items 折叠口径', () => {
    agentMock.value.callbacks.workbenchMode = 'delivery';
    render(<RoomEditorProvider value={editorValue({ outdoorPlan: null })}>
      <WorkbenchModeCard pins={[]} {...cardProps} />
    </RoomEditorProvider>);
    const shell = screen.getByRole('region', { name: '执行清单' });
    expect(shell.textContent).toContain('legacy 签到桌');
    expect(shell.textContent).toContain('1 件');
    expect(shell.textContent).not.toContain('签到台');
  });

  it('绑定 plan 态：评审卡主体名取 plan facility', () => {
    agentMock.value.callbacks.workbenchMode = 'review';
    const plan = planWith([planFacility({ id: PLAN_FACILITY_ID, name: '签到台' })]);
    render(<RoomEditorProvider value={editorValue({ outdoorPlan: plan })}>
      <WorkbenchModeCard pins={[reviewPin(PLAN_FACILITY_ID)]} {...cardProps} />
    </RoomEditorProvider>);
    const card = screen.getByRole('region', { name: '议题' });
    expect(card.textContent).toContain('签到台');
    expect(card.textContent).not.toContain('legacy 签到桌');
  });

  it('legacy 草稿态：评审卡主体名取 activeFloor.items', () => {
    agentMock.value.callbacks.workbenchMode = 'review';
    render(<RoomEditorProvider value={editorValue({ outdoorPlan: null })}>
      <WorkbenchModeCard pins={[reviewPin(LEGACY_ITEM_ID)]} {...cardProps} />
    </RoomEditorProvider>);
    const card = screen.getByRole('region', { name: '议题' });
    expect(card.textContent).toContain('legacy 签到桌');
    expect(card.textContent).not.toContain('签到台');
  });
});
