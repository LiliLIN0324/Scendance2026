// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOperation } from '../lib/event-operations';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { ActivityTaskSuggestionView, type ActivityTaskSuggestionViewProps } from './activity-task-suggestion-view';
import type { ActivityTaskContext, ActivityTaskSuggestionProposal } from '../../../lib/activity-task-suggestions';
import type { RoomLayout } from '../lib/types';

afterEach(cleanup);

const originalId = '12345678-1234-4123-8123-123456789012';
const suggestedId = '12345678-1234-4123-8123-123456789013';
const secondSuggestedId = '12345678-1234-4123-8123-123456789014';
const activityId = 'local-rehearsal-activity';
const original = { ...createOperation('核对签到桌', 'setup'), id: originalId, ownerName: '不要披露的负责人', evidenceNote: '不要披露的核对证据' };
const item = { ...INITIAL_LAYOUT.floors[0].items[0], id: 'object-one', name: '签到桌', position: { x: 2, z: 3 } };
const layout: RoomLayout = { ...INITIAL_LAYOUT, id: activityId, floors: [
  { ...INITIAL_LAYOUT.floors[0], id: 'floor-one', name: '一层', items: [item] },
], eventOperations: { schemaVersion: 1, dataKind: 'rehearsal', tasks: [original] } };
const context: ActivityTaskContext = {
  summary: { projectId: activityId, dataKind: 'rehearsal', briefText: '只核对共创活动签到',
    tasks: [{ id: original.id, title: original.title, phase: 'setup', acceptance: '签到桌的位置与通道已逐项核对',
      plannedStartAt: '2026-10-10T09:00:00+08:00', plannedEndAt: null, status: 'needs_review', objectIds: [item.id] }],
    objects: [{ id: item.id, name: item.name, type: 'table', floorId: 'floor-one', floorName: '一层',
      size: { width: 1.2, depth: 0.6, height: 0.75 }, position: { x: 2, z: 3 }, rotation: Math.PI / 2, elevation: null, color: '#eeccaa' }],
  }, source: { projectId: activityId, dataKind: 'rehearsal', fingerprint: `sha256:${'a'.repeat(64)}` },
};
const suggestion = { ...createOperation('逐项核对签到桌', 'setup'), id: suggestedId, acceptance: '对照布置逐项核对签到桌与通道', objectIds: [item.id] };
const proposal: ActivityTaskSuggestionProposal = { id: '12345678-1234-4123-8123-123456789015', source: context.source, sourceLabel: '任务建议',
  tasks: [suggestion, { ...createOperation('收集体验反馈', 'event'), id: secondSuggestedId, acceptance: '整理反馈中的待处理事项' }],
};

function props(overrides: Partial<ActivityTaskSuggestionViewProps> = {}): ActivityTaskSuggestionViewProps {
  return { layout, selection: { briefText: '', taskIds: [], objectIds: [] }, instruction: '整理签到核对任务',
    onSelection: vi.fn(), onInstruction: vi.fn(), context: null, proposal: null, selectedSuggestionIds: [], onSelectedSuggestionIds: vi.fn(),
    approvedDisclosure: false, onApprovedDisclosure: vi.fn(), busy: false, availabilityReason: null, stale: false,
    phase: 'selection', error: null, notice: null, onPreview: vi.fn(), onSend: vi.fn(), onRecover: vi.fn(), onCancel: vi.fn(),
    onAccept: vi.fn(), onNewRequest: vi.fn(), onVerifySave: vi.fn(), ...overrides };
}
const disabled = (name: string) => (screen.getByRole('button', { name }) as HTMLButtonElement).disabled;

describe('ActivityTaskSuggestionView', () => {
  it('starts collapsed, explains empty sources and does not offer generation without a reviewed summary', () => {
    const view = render(<ActivityTaskSuggestionView {...props({ layout: { ...layout, floors: [], eventOperations: undefined } })}/>);
    expect(view.container.querySelector('details')?.open).toBe(false);
    expect(screen.getByText('当前没有活动任务，可以只选需求或物件。')).toBeTruthy();
    expect(screen.getByText('当前没有场景物件，可以只选需求或任务。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认发送' })).toBeNull();
    expect(screen.queryByRole('button', { name: /自动连接|生成演练/ })).toBeNull();
  });

  it('keeps selection controlled, preserves unclicked IDs and clears disclosure approval on an input change', () => {
    const current = props({ context, selection: { briefText: '选定需求', taskIds: ['prior-task'], objectIds: ['prior-object'] }, approvedDisclosure: true });
    render(<ActivityTaskSuggestionView {...current}/>);
    fireEvent.click(screen.getByLabelText(/核对签到桌.*布场/));
    expect(current.onSelection).toHaveBeenLastCalledWith({ briefText: '选定需求', taskIds: ['prior-task', originalId], objectIds: ['prior-object'] });
    expect(current.onApprovedDisclosure).toHaveBeenLastCalledWith(false);
    expect((screen.getByLabelText(/核对签到桌.*布场/) as HTMLInputElement).checked).toBe(false);
    fireEvent.change(screen.getByLabelText('选定需求'), { target: { value: '新的选定需求' } });
    expect(current.onSelection).toHaveBeenLastCalledWith({ briefText: '新的选定需求', taskIds: ['prior-task'], objectIds: ['prior-object'] });
    fireEvent.change(screen.getByLabelText('希望整理什么任务'), { target: { value: '整理撤场核对' } });
    expect(current.onInstruction).toHaveBeenCalledWith('整理撤场核对');
  });

  it('identifies same-name objects by their actual floor and location and passes only the toggled stable ID', () => {
    const current = props({ context, layout: { ...layout, floors: [...layout.floors,
      { ...layout.floors[0], id: 'floor-two', name: '二层', items: [{ ...item, id: 'object-two', position: { x: 4, z: 5 } }] }],
    }, selection: { briefText: '', taskIds: [], objectIds: [item.id] } });
    render(<ActivityTaskSuggestionView {...current}/>);
    const second = screen.getByLabelText('签到桌二层 · 位置 X 4 m / Z 5 m');
    fireEvent.click(second);
    expect(current.onSelection).toHaveBeenLastCalledWith({ briefText: '', taskIds: [], objectIds: [item.id, 'object-two'] });
    expect((second as HTMLInputElement).checked).toBe(false);
  });

  it('copies the saved brief only on an explicit action and preserves the chosen tasks and objects', () => {
    const current = props({ context, availableBriefText: '已保存的演练活动需求', approvedDisclosure: true,
      selection: { briefText: '手工选定需求', taskIds: [originalId], objectIds: [item.id] } });
    const view = render(<ActivityTaskSuggestionView {...current}/>);
    expect(current.onSelection).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '使用已保存需求' }));
    expect(current.onSelection).toHaveBeenCalledWith({ briefText: '已保存的演练活动需求', taskIds: [originalId], objectIds: [item.id] });
    expect(current.onApprovedDisclosure).toHaveBeenCalledWith(false);
    expect((screen.getByLabelText('选定需求') as HTMLTextAreaElement).value).toBe('手工选定需求');
    view.rerender(<ActivityTaskSuggestionView {...current} availableBriefText="  "/>);
    expect(screen.queryByRole('button', { name: '使用已保存需求' })).toBeNull();
    view.rerender(<ActivityTaskSuggestionView {...current} busy/>);
    expect(disabled('使用已保存需求')).toBe(true);
  });

  it('shows the captured summary including effective status, plan, size and position, without private fields or internal hashes', () => {
    render(<ActivityTaskSuggestionView {...props({ context })}/>);
    const summary = within(screen.getByRole('region', { name: '待发送摘要' }));
    expect(summary.getByText('只核对共创活动签到')).toBeTruthy();
    expect(summary.getByText('布场 · 需复核')).toBeTruthy();
    expect(summary.getByText('2026-10-10 09:00 · 北京时间')).toBeTruthy();
    expect(summary.getByText('桌子')).toBeTruthy();
    expect(summary.getByText('1.2 × 0.6 × 0.75 m')).toBeTruthy();
    expect(summary.getByText('位置 X 2 m / Z 3 m')).toBeTruthy();
    expect(summary.getByText('90°')).toBeTruthy();
    expect(summary.getByText(/文字不会自动脱敏/)).toBeTruthy();
    expect(summary.queryByText('不要披露的负责人')).toBeNull();
    expect(summary.queryByText('不要披露的核对证据')).toBeNull();
    expect(summary.queryByText(context.source.fingerprint)).toBeNull();
    expect(summary.queryByText(original.id)).toBeNull();
  });

  it('converts radians only for display and preserves the exact summary rotation, type and timestamp for sending', () => {
    const summaryBefore = structuredClone(context.summary);
    const current = props({ context, approvedDisclosure: true });
    render(<ActivityTaskSuggestionView {...current}/>);
    const summary = within(screen.getByRole('region', { name: '待发送摘要' }));
    expect(summary.getByText('90°')).toBeTruthy();
    expect(summary.queryByText(`${Math.PI / 2}°`)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '确认发送' }));
    expect(current.onSend).toHaveBeenCalledOnce();
    expect(context.summary).toEqual(summaryBefore);
    expect(context.summary.objects[0].rotation).toBe(Math.PI / 2);
    expect(context.summary.objects[0].type).toBe('table');
    expect(context.summary.tasks[0].plannedStartAt).toBe('2026-10-10T09:00:00+08:00');
  });

  it('shows finite measurements without floating point residue or negative zero while preserving exact model inputs', () => {
    const preciseContext: ActivityTaskContext = { ...context, summary: { ...context.summary, objects: [
      { ...context.summary.objects[0], position: { x: -1.7999999999999998, z: -0.00001 },
        size: { width: 1.2000000000000002, depth: 0.6, height: 0.7549999999999999 }, elevation: -0 },
    ] } };
    const before = structuredClone(preciseContext.summary);
    const current = props({ context: preciseContext, approvedDisclosure: true });
    render(<ActivityTaskSuggestionView {...current}/>);
    const summary = within(screen.getByRole('region', { name: '待发送摘要' }));
    expect(summary.getByText('位置 X -1.8 m / Z 0 m')).toBeTruthy();
    expect(summary.getByText('1.2 × 0.6 × 0.75 m')).toBeTruthy();
    expect(summary.getByText('0 m')).toBeTruthy();
    expect(summary.getByText('90°')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认发送' }));
    expect(current.onSend).toHaveBeenCalledOnce();
    expect(preciseContext.summary).toEqual(before);
    expect(preciseContext.summary.objects[0].position?.x).toBe(-1.7999999999999998);
    expect(Object.is(preciseContext.summary.objects[0].elevation, -0)).toBe(true);
  });

  it('keeps all 20 tasks and 39 objects in accessible choice groups without selecting or truncating their data', () => {
    const longLayout: RoomLayout = { ...layout, eventOperations: { schemaVersion: 1, dataKind: 'rehearsal',
      tasks: Array.from({ length: 20 }, (_, index) => ({ ...original, id: crypto.randomUUID(), title: `演练任务${index + 1}` })),
    }, floors: [{ ...layout.floors[0], items: Array.from({ length: 39 }, (_, index) => ({ ...item, id: `rehearsal-object-${index + 1}`, name: `演练物件${index + 1}` })) }] };
    const before = structuredClone(longLayout);
    const current = props({ layout: longLayout, context });
    const view = render(<ActivityTaskSuggestionView {...current}/>);
    const taskGroup = screen.getByRole('group', { name: '参考哪些原任务' });
    const objectGroup = screen.getByRole('group', { name: '参考哪些场景物件' });
    expect(within(taskGroup).getAllByRole('checkbox')).toHaveLength(20);
    expect(within(objectGroup).getAllByRole('checkbox')).toHaveLength(39);
    expect(within(taskGroup).getByLabelText('演练任务20布场')).toBeTruthy();
    expect(within(objectGroup).getByLabelText('演练物件39一层 · 位置 X 2 m / Z 3 m')).toBeTruthy();
    expect(view.container.querySelectorAll('.ats-choice-list')).toHaveLength(2);
    expect([...taskGroup.querySelectorAll('input'), ...objectGroup.querySelectorAll('input')].every(input => !input.checked)).toBe(true);
    expect(current.onSelection).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '查看待发送摘要' })).toBeTruthy();
    expect(longLayout).toEqual(before);
  });

  it('requires the explicit controlled disclosure approval before sending and disables unavailable, busy or changed inputs', () => {
    const current = props({ context });
    const view = render(<ActivityTaskSuggestionView {...current}/>);
    expect(disabled('确认发送')).toBe(true);
    fireEvent.click(screen.getByLabelText('我已核对，确认发送以上内容'));
    expect(current.onApprovedDisclosure).toHaveBeenCalledWith(true);
    expect(disabled('确认发送')).toBe(true);
    view.rerender(<ActivityTaskSuggestionView {...current} approvedDisclosure/>);
    expect(disabled('确认发送')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '确认发送' }));
    expect(current.onSend).toHaveBeenCalledOnce();
    for (const blocked of [{ busy: true }, { stale: true }, { availabilityReason: '请先登录并准备场景连接，再发送任务建议。' }]) {
      view.rerender(<ActivityTaskSuggestionView {...current} approvedDisclosure {...blocked}/>);
      expect(disabled('确认发送')).toBe(true);
    }
    expect(screen.getByText('请先登录并准备场景连接，再发送任务建议。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /立即连接|创建项目/ })).toBeNull();
  });

  it('queries the original request without a new-send option or a lease-dependent recovery gate', () => {
    const current = props({ context, phase: 'requested', availabilityReason: '连接租约已过期，请先核对连接。' });
    const view = render(<ActivityTaskSuggestionView {...current}/>);
    expect(disabled('查询原请求')).toBe(false);
    expect(screen.queryByRole('button', { name: '确认发送' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查询原请求' }));
    expect(current.onRecover).toHaveBeenCalledOnce();
    view.rerender(<ActivityTaskSuggestionView {...current} busy/>);
    expect(disabled('查询原请求')).toBe(true);
    expect(disabled('取消本次建议')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '取消本次建议' }));
    expect(current.onCancel).toHaveBeenCalledOnce();
  });

  it('keeps suggestion checkboxes and IDs controlled and exposes only the four allowed fields', () => {
    const current = props({ context, proposal: { ...proposal, tasks: [{ ...suggestion, ownerName: '秘密负责人', evidenceNote: '秘密证据', plannedStartAt: '2026-10-11T10:00:00+08:00' }, proposal.tasks[1]] }, phase: 'prepared', selectedSuggestionIds: [secondSuggestedId] });
    render(<ActivityTaskSuggestionView {...current}/>);
    const results = within(screen.getByRole('region', { name: '本次任务建议' }));
    fireEvent.click(results.getByLabelText('逐项核对签到桌布场'));
    expect(current.onSelectedSuggestionIds).toHaveBeenCalledWith([secondSuggestedId, suggestedId]);
    expect((results.getByLabelText('逐项核对签到桌布场') as HTMLInputElement).checked).toBe(false);
    expect(results.queryByText('秘密负责人')).toBeNull();
    expect(results.queryByText('秘密证据')).toBeNull();
    expect(results.queryByText('2026-10-11T10:00:00+08:00')).toBeNull();
    fireEvent.click(results.getByRole('button', { name: '保存勾选任务' }));
    expect(current.onAccept).toHaveBeenCalledOnce();
    expect(layout.eventOperations?.tasks).toEqual([original]);
  });

  it('does not save an empty, invalid, busy, unavailable or stale selection and retains the proposal', () => {
    const current = props({ context, proposal, phase: 'prepared' });
    const view = render(<ActivityTaskSuggestionView {...current}/>);
    expect(disabled('保存勾选任务')).toBe(true);
    for (const blocked of [{ selectedSuggestionIds: ['not-a-suggestion'] }, { selectedSuggestionIds: [suggestedId, 'not-a-suggestion'] },
      { selectedSuggestionIds: [suggestedId, suggestedId] }, { busy: true }, { availabilityReason: '请先登录' }, { stale: true }]) {
      view.rerender(<ActivityTaskSuggestionView {...current} selectedSuggestionIds={[suggestedId]} {...blocked}/>);
      expect(disabled('保存勾选任务')).toBe(true);
      expect(screen.getByText(suggestion.title)).toBeTruthy();
    }
    expect(screen.getByText(/活动资料已变化/)).toBeTruthy();
  });

  it('calls only verification during uncertain saving and does not claim persistence before a closed receipt', () => {
    const current = props({ context, proposal, phase: 'saving', selectedSuggestionIds: [suggestedId] });
    const view = render(<ActivityTaskSuggestionView {...current}/>);
    expect(screen.queryByRole('button', { name: '保存勾选任务' })).toBeNull();
    expect(screen.queryByText(/勾选任务已保存/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '核对原保存结果' }));
    expect(current.onVerifySave).toHaveBeenCalledOnce();
    expect(current.onAccept).not.toHaveBeenCalled();
    expect(current.onSend).not.toHaveBeenCalled();
    view.rerender(<ActivityTaskSuggestionView {...current} phase="closed"/>);
    expect(screen.getByText('勾选任务已保存，可在活动安排中继续编辑。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '核对原保存结果' })).toBeNull();
    expect(disabled('重新选择资料')).toBe(false);
  });

  it('keeps explicit cancellation and failure distinct from saved work', () => {
    const current = props({ phase: 'cancelled', notice: '当前活动任务保持原样。' });
    const view = render(<ActivityTaskSuggestionView {...current}/>);
    expect(screen.getByText('本次建议已取消。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重新选择资料' }));
    expect(current.onNewRequest).toHaveBeenCalledOnce();
    view.rerender(<ActivityTaskSuggestionView {...current} phase="failed" error="原请求未完成，请查询原请求。"/>);
    expect(screen.getByRole('alert').textContent).toBe('原请求未完成，请查询原请求。');
    expect(screen.getByRole('button', { name: '查询原请求' })).toBeTruthy();
    expect(screen.queryByText(/勾选任务已保存/)).toBeNull();
  });

  it('offers an explicit retry of the same pending save without querying, accepting again or sending a new request', () => {
    const current = props({ context, proposal, phase: 'saving', selectedSuggestionIds: [suggestedId], onRetrySave: vi.fn() });
    const view = render(<ActivityTaskSuggestionView {...current}/>);
    expect(disabled('重试原任务保存')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '重试原任务保存' }));
    expect(current.onRetrySave).toHaveBeenCalledOnce();
    expect(current.onVerifySave).not.toHaveBeenCalled();
    expect(current.onAccept).not.toHaveBeenCalled();
    expect(current.onSend).not.toHaveBeenCalled();
    expect(current.onSelectedSuggestionIds).not.toHaveBeenCalled();
    expect(current.selectedSuggestionIds).toEqual([suggestedId]);
    expect(screen.queryByText(/勾选任务已保存/)).toBeNull();
    view.rerender(<ActivityTaskSuggestionView {...current} busy/>);
    expect(disabled('重试原任务保存')).toBe(true);
    expect(disabled('核对原保存结果')).toBe(true);
    const { onRetrySave: _onRetrySave, ...withoutRetry } = current;
    view.rerender(<ActivityTaskSuggestionView {...withoutRetry}/>);
    expect(screen.queryByRole('button', { name: '重试原任务保存' })).toBeNull();
    expect(screen.getByRole('button', { name: '核对原保存结果' })).toBeTruthy();
  });
});
