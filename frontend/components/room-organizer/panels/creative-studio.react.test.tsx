// @vitest-environment jsdom

import { act, cleanup, fireEvent, render as renderUI, screen, waitFor } from '@testing-library/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSession, getBackendConfig, type BackendSnapshot, type Scene, type SceneProposal, type AgentRun, type AgentRunInput } from '@/lib/backend-session';
import { copySourceScope, deleteSourceForm, flushSourceScope, listStoredSources, readSourceForm, storeSourceForm } from '@/lib/source-storage';
import { parseLocalProjectBackupJson, serializeLocalProjectBackup } from '@/lib/local-project-backup';
import { backendSceneToLayout, createMeasuredRoomLayout, layoutToBackendScene } from '../lib/backend-adapter';
import { LOCAL_HANDOFF_CLOUD_MESSAGE } from '../lib/handoff-cloud-guard';
import { ensureGlbAsset } from '../three/glb-assets';
import { loadScenePreset } from '../three/scene-presets';
import { CreativeAssistant, CreativeBriefPanel, CreativeStudioProvider, useCreativeBrief, useCreativeBriefState, useLocalProjectBackup, type LocalProjectBackupActions } from './creative-studio';
import { GeneratedModelLibrary } from './generated-model-library';
import type { MaterialCustomizationSeed } from './material-customization';
import type { RoomLayout } from '../lib/types';
import { productionPlanSchema } from '../../../../supabase/functions/_shared/production-plan-contract';

vi.mock('../three/glb-assets', async original => ({ ...(await original<typeof import('../three/glb-assets')>()), ensureGlbAsset: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../three/scene-presets', () => ({ loadScenePreset: vi.fn() }));
vi.mock('../contexts', () => ({ useSelection: () => ({ allSelectedIds: new Set<string>(), selectedItem: null }) }));
vi.mock('@/lib/source-storage', async original => ({ ...(await original<typeof import('@/lib/source-storage')>()), readSourceForm: vi.fn(), storeSourceForm: vi.fn(), deleteSourceForm: vi.fn(), copySourceScope: vi.fn(), listStoredSources: vi.fn() }));
let materialProps: { seed?: MaterialCustomizationSeed; layout: RoomLayout; onApply(next:RoomLayout):void };
vi.mock('./material-customization', () => ({ MaterialCustomization: (props: typeof materialProps) => { materialProps=props;return <output data-testid="material-seed">{JSON.stringify(props.seed ?? null)}</output>; } }));

const projectId = '10000000-0000-4000-8000-000000000001';
const scene: Scene = {
  schemaVersion: 1,
  venue: { width: 12, depth: 10, height: 3, shape: 'rectangle', entrances: [] },
  objects: [], camera: 'overview', lighting: 'warm',
};
const candidate: Scene = {
  ...scene,
  objects: [{ id: '20000000-0000-4000-8000-000000000001', materialId: 'chair', position: { x: 3, z: 4 }, rotation: 0, size: { width: 0.5, depth: 0.5, height: 0.9 }, color: '#ddc8a2', locked: false, notes: '' }],
};
const proposal: SceneProposal = {
  id: '30000000-0000-4000-8000-000000000001', project_id: projectId, session_id: '40000000-0000-4000-8000-000000000001', user_id: 'test-user',
  generation: 1, base_revision: 1, local_revision: 0, base_hash: 'a'.repeat(64), base_scene: scene, candidate,
  expires_at: '2099-01-01T00:00:00Z', applied_at: null, explanation: '增加一把椅子，保留中心通道。', warnings: [],
};
let controller: BackendSession;
let snapshot: BackendSnapshot;
let layout: RoomLayout;
const prepareProposal=vi.fn<(input:AgentRunInput)=>Promise<SceneProposal>>();
function runFrom(value:SceneProposal,input?:AgentRunInput):AgentRun {return {id:'60000000-0000-4000-8000-000000000001',projectId,requestId:input?.requestId??'70000000-0000-4000-8000-000000000001',state:'complete',progress:'完成',callCount:1,candidates:[{label:'A',title:'交流区',proposal:value}],evaluation:null,executionMode:input?.executionMode??'preview',jevEnabled:input?.jevEnabled??false,expiresAt:value.expires_at};}
const onApply = vi.fn<(next: RoomLayout) => void>();
const onPreview = vi.fn<(next: RoomLayout | null) => void>();
const createBitmap = vi.fn();
const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();
const forbiddenFetch = vi.fn(() => { throw new Error('This UI test must never access the network.'); });
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');

function restoreProperty(object: object, key: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(object, key, descriptor);
  else Reflect.deleteProperty(object, key);
}

function ui(current = layout) {
  return <CreativeStudioProvider controller={controller} layout={current} onApply={onApply} onPreview={onPreview}>
    <CreativeAssistant/>
  </CreativeStudioProvider>;
}

function DeliveryShortcutTrial({ current = layout, operations = false }: { current?: RoomLayout; operations?: boolean }) {
  const [request, setRequest] = useState(0);
  const entry = useRef<HTMLButtonElement>(null);
  return <CreativeStudioProvider controller={controller} layout={current} onApply={onApply} onUpdateEventOperations={operations?()=>{}:undefined}>
    <button ref={entry} type="button" onClick={() => setRequest(value => value + 1)}>打开执行工作单</button>
    <CreativeAssistant deliveryOpenRequest={request} deliveryEntryRef={entry}/>
  </CreativeStudioProvider>;
}

function DockedTrial({ current = layout, generator, onWorkspace, onConversation }: {
  current?: RoomLayout; generator?: ReactNode; onWorkspace?: (visible: boolean) => void; onConversation?: (visible: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null), referenceEntry = useRef<HTMLButtonElement>(null);
  const [workspaceVisible, setWorkspaceVisible] = useState(false), [referenceRequest, setReferenceRequest] = useState(0);
  const [conversationCloseRequest, setConversationCloseRequest] = useState(0);
  const workspaceChanged = useCallback((visible: boolean) => { setWorkspaceVisible(visible); onWorkspace?.(visible); }, [onWorkspace]);
  const conversationChanged = useCallback((visible: boolean) => { onConversation?.(visible); }, [onConversation]);
  return <CreativeStudioProvider controller={controller} layout={current} onApply={onApply} onPreview={onPreview}>
    <button ref={referenceEntry} onClick={() => setReferenceRequest(value => value + 1)}>外部图纸核对</button>
    <button onClick={() => setConversationCloseRequest(value => value + 1)}>外部收起聊天</button>
    <div data-testid="docked-business-host" ref={host} hidden={!workspaceVisible}/>
    <CreativeAssistant docked businessHostRef={host} generationPanel={generator}
      referenceOpenRequest={referenceRequest} referenceEntryRef={referenceEntry}
      conversationCloseRequest={conversationCloseRequest}
      onWorkspaceVisibilityChange={workspaceChanged} onConversationVisibilityChange={conversationChanged}/>
  </CreativeStudioProvider>;
}

describe('docked workspace integration', () => {
  beforeEach(() => { vi.stubGlobal('innerWidth', 1440); });
  it('[chat independence] keeps model scope and its sendable draft through every business destination', async () => {
    connected(); vi.mocked(controller.startAgentRun).mockResolvedValueOnce(runFrom(proposal));
    renderUI(<DockedTrial/>); await act(async () => {});
    const composer = screen.getByRole('textbox', { name: '告诉助手你的想法' }) as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '原策划草稿' } });
    selectMode('model');
    const instruction = '生成一把宽0.5米的椅子，保留其他物件';
    fireEvent.change(composer, { target: { value: instruction } });
    for (const name of ['活动需求', '图纸与尺寸', '物料工具', '执行资料', '场景模板']) {
      fireEvent.click(screen.getByRole('button', { name }));
      expect((screen.getByRole('combobox', { name: '工作模式' }) as HTMLSelectElement).value).toBe('model');
      expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer);
      expect(composer.value).toBe(instruction);
      expect((screen.getByRole('button', { name: '发送消息' }) as HTMLButtonElement).disabled).toBe(false);
    }
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await screen.findByText('方案提案 · 尚未应用');
    const request = vi.mocked(controller.startAgentRun).mock.calls[0]![0];
    expect(request.instruction).toContain('仅创建或调整本次请求指定的物料');
    expect(request.executionMode).toBe('preview'); expect(controller.startAgentRun).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '返回当前工作区' }));
    selectMode('plan'); expect(composer.value).toBe('原策划草稿');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('[composer settings] keeps one associated form, real settings and IME protection through two Escape presses', async () => {
    connected(); let finish!: (run: AgentRun) => void;
    vi.mocked(controller.startAgentRun).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderUI(<DockedTrial/>); await act(async () => {});
    const composer = screen.getByRole('textbox', { name: '告诉助手你的想法' }) as HTMLTextAreaElement;
    const mode = screen.getByRole('combobox', { name: '工作模式' }) as HTMLSelectElement;
    const submit = screen.getByRole('button', { name: '发送消息' }) as HTMLButtonElement;
    const launcher = screen.getByRole('button', { name: '关闭 Binggo Agent' });
    expect(document.querySelectorAll('#creative-message')).toHaveLength(1);
    expect(document.querySelectorAll('#creative-work-mode')).toHaveLength(1);
    expect(document.querySelectorAll('.cr-assistant-launcher')).toHaveLength(1);
    expect(composer.form).not.toBeNull(); expect(mode.form).toBe(composer.form); expect(submit.form).toBe(composer.form);
    const settings = screen.getByLabelText('助手设置'); fireEvent.click(settings);
    const details = settings.closest('details')!;
    const direct = screen.getByRole('checkbox', { name: '明确指令直接应用' }) as HTMLInputElement;
    const jev = screen.getByRole('checkbox', { name: 'JEV 决策模式' }) as HTMLInputElement;
    expect(direct.form).toBe(composer.form); expect(jev.form).toBe(composer.form);
    expect(direct.checked).toBe(true); expect(jev.checked).toBe(false);
    fireEvent.click(jev); expect(jev.checked).toBe(true); expect(direct.disabled).toBe(true);
    fireEvent.click(jev); expect(jev.checked).toBe(false); expect(direct.disabled).toBe(false);
    fireEvent.click(direct); expect(direct.checked).toBe(false);
    fireEvent.change(composer, { target: { value: '仍在输入法组合中' } });
    fireEvent.keyDown(composer, { key: 'Enter', isComposing: true });
    expect(controller.startAgentRun).not.toHaveBeenCalled(); expect(composer.value).toBe('仍在输入法组合中');
    jev.focus(); fireEvent.keyDown(jev, { key: 'Escape' });
    expect(details.open).toBe(false); expect(document.activeElement).toBe(settings);
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer);
    fireEvent.keyDown(settings, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: '告诉助手你的想法' })).toBeNull();
    expect(screen.getByRole('button', { name: '打开 Binggo Agent' })).toBe(launcher);
    fireEvent.click(launcher);
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer); expect(composer.value).toBe('仍在输入法组合中');
    fireEvent.click(submit); await waitFor(() => expect(controller.startAgentRun).toHaveBeenCalledOnce());
    fireEvent.click(settings);
    expect(direct.checked).toBe(false); expect(jev.checked).toBe(false);
    expect(direct.disabled).toBe(true); expect(jev.disabled).toBe(true);
    expect(vi.mocked(controller.startAgentRun).mock.calls[0]![0]).toMatchObject({ executionMode: 'preview', jevEnabled: false });
    await act(async () => finish(runFrom(proposal))); await screen.findByText('方案提案 · 尚未应用');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('[business Escape] closes each focused Portal destination without closing chat or consuming a nested handled Escape', async () => {
    renderUI(<DockedTrial/>); await act(async () => {});
    selectMode('model');
    const host = screen.getByTestId('docked-business-host');
    const composer = screen.getByRole('textbox', { name: '告诉助手你的想法' });
    for (const name of ['活动需求', '图纸与尺寸', '物料工具', '执行资料', '场景模板']) {
      const entry = screen.getByRole('button', { name }); fireEvent.click(entry);
      const target = name === '活动需求' ? screen.getByRole('textbox', { name: '客户需求' })
        : name === '执行资料' ? screen.getByRole('group', { name: '执行工作单' })
          : name === '物料工具' ? screen.getByRole('button', { name: '椅' })
            : name === '场景模板' ? screen.getByRole('button', { name: '返回当前工作区' })
          : host.querySelector<HTMLElement>('[aria-label="图纸与场地对应核对"]')!;
      target.focus(); fireEvent.keyDown(target, { key: 'Escape', cancelable: true });
      await waitFor(() => expect(host.hidden).toBe(true));
      await waitFor(() => expect(document.activeElement).toBe(entry));
      expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer);
    }
    const entry = screen.getByRole('button', { name: '活动需求' }); fireEvent.click(entry);
    const demand = screen.getByRole('textbox', { name: '客户需求' });
    const consume = (event: Event) => event.preventDefault(); demand.addEventListener('keydown', consume);
    fireEvent.keyDown(demand, { key: 'Escape', cancelable: true });
    expect(host.hidden).toBe(false); expect(screen.getByRole('textbox', { name: '客户需求' })).toBe(demand);
    demand.removeEventListener('keydown', consume);
    fireEvent.keyDown(demand, { key: 'Escape', cancelable: true });
    await waitFor(() => expect(host.hidden).toBe(true));
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer);
  });

  it('keeps business and generator nodes in a stable host while changing tools, templates and chat visibility', async () => {
    const mounted = vi.fn(), reconstructionMounted = vi.fn();
    const reconstruction = await import('./reconstruction-panel'), Original = reconstruction.ReconstructionPanel;
    vi.spyOn(reconstruction, 'ReconstructionPanel').mockImplementation(props => {
      useEffect(() => { reconstructionMounted(); }, []); return <Original {...props}/>;
    });
    function Generator() {
      const [value, setValue] = useState(''); useEffect(() => { mounted(); }, []);
      return <input aria-label="停靠测试模型描述" value={value} onChange={event => setValue(event.target.value)}/>;
    }
    renderUI(<DockedTrial generator={<Generator/>}/>); await act(async () => {});
    const host = screen.getByTestId('docked-business-host');
    expect(host.querySelector('[aria-label="客户需求"]')).toBeNull();
    expect(reconstructionMounted).not.toHaveBeenCalled(); expect(mounted).not.toHaveBeenCalled();
    const composer = screen.getByRole('textbox', { name: '告诉助手你的想法' }) as HTMLTextAreaElement;
    expect(screen.queryByRole('textbox', { name: '客户需求' })).toBeNull();
    expect(host.hidden).toBe(true);
    fireEvent.change(composer, { target: { value: '停靠策划草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '活动需求' }));
    const demand = screen.getByRole('textbox', { name: '客户需求' }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(demand);
    expect(host.contains(demand)).toBe(true); expect(host.contains(composer)).toBe(false);
    fireEvent.change(demand, { target: { value: '保留原需求文字' } });
    selectMode('model');
    fireEvent.click(screen.getByRole('button', { name: '物料工具' }));
    const model = screen.getByRole('textbox', { name: '停靠测试模型描述' });
    fireEvent.change(model, { target: { value: '模型字段保留' } });
    fireEvent.click(screen.getByRole('button', { name: '椅' }));
    expect((screen.getByRole('combobox', { name: '工作模式' }) as HTMLSelectElement).value).toBe('model');
    expect(composer.value).toContain('座面宽 0.5 米');
    fireEvent.click(screen.getByRole('button', { name: '收起聊天' }));
    expect(screen.queryByRole('textbox', { name: '告诉助手你的想法' })).toBeNull();
    expect(screen.getByRole('textbox', { name: '停靠测试模型描述' })).toBe(model);
    fireEvent.click(screen.getByRole('button', { name: '打开 Binggo Agent' }));
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer);
    fireEvent.click(screen.getByRole('button', { name: '场景模板' }));
    expect(host.contains(screen.getAllByRole('button', { name: /载入工作台/ })[0])).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '返回当前工作区' }));
    expect(screen.getByRole('textbox', { name: '停靠测试模型描述' })).toBe(model);
    expect((model as HTMLInputElement).value).toBe('模型字段保留'); expect(mounted).toHaveBeenCalledOnce();
    expect(reconstructionMounted).toHaveBeenCalledOnce();
    selectMode('plan'); expect(composer.value).toBe('停靠策划草稿');
    fireEvent.click(screen.getByRole('button', { name: '活动需求' }));
    expect(screen.getByRole('textbox', { name: '客户需求' })).toBe(demand); expect(demand.value).toBe('保留原需求文字');
    expect(document.querySelectorAll('#creative-message')).toHaveLength(1);
    expect(controller.startAgentRun).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
  });

  it('clears both chat drafts when the project scope changes without remounting the host composer', async () => {
    const value = renderUI(<DockedTrial/>); await act(async () => {});
    const composer = screen.getByRole('textbox', { name: '告诉助手你的想法' }) as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '项目A策划草稿' } });
    selectMode('model'); fireEvent.change(composer, { target: { value: '项目A建模草稿' } });
    value.rerender(<DockedTrial current={{ ...layout, id: 'docked-project-B', name: '项目B' }}/>);
    expect((screen.getByRole('combobox', { name: '工作模式' }) as HTMLSelectElement).value).toBe('plan');
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer); expect(composer.value).toBe('');
    selectMode('model'); expect(composer.value).toBe(''); expect(controller.startAgentRun).not.toHaveBeenCalled();
  });

  it.each([390, 768])('[narrow chat scopes] retains visible chat and both drafts when only the range changes at %s px', async width => {
    vi.stubGlobal('innerWidth', width);
    renderUI(<DockedTrial/>); await act(async () => {});
    if (!screen.queryByRole('textbox', { name: '告诉助手你的想法' })) fireEvent.click(screen.getByRole('button', { name: '打开 Binggo Agent' }));
    const composer = screen.getByRole('textbox', { name: '告诉助手你的想法' }) as HTMLTextAreaElement;
    const host = screen.getByTestId('docked-business-host');
    fireEvent.change(composer, { target: { value: '窄屏策划草稿' } });
    selectMode('model');
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer); expect(host.hidden).toBe(true);
    fireEvent.change(composer, { target: { value: '窄屏建模草稿' } });
    selectMode('plan'); expect(composer.value).toBe('窄屏策划草稿');
    selectMode('model'); expect(composer.value).toBe('窄屏建模草稿');
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer); expect(host.hidden).toBe(true);
    expect(controller.startAgentRun).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
  });

  it('keeps a pending proposal discoverable and reopens the same confirmation without dispatching a second task', async () => {
    connected(); vi.mocked(controller.startAgentRun).mockResolvedValueOnce(runFrom(proposal));
    renderUI(<DockedTrial/>); await act(async () => {});
    fireEvent.change(screen.getByRole('textbox', { name: '告诉助手你的想法' }), { target: { value: '先给候选，再确认应用' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' })); await screen.findByText('方案提案 · 尚未应用');
    const confirm = screen.getByRole('button', { name: '确认应用' });
    fireEvent.click(screen.getByRole('button', { name: '外部收起聊天' }));
    expect(screen.queryByRole('button', { name: '确认应用' })).toBeNull();
    expect(screen.getAllByText(/有方案待确认/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '打开 Binggo Agent' }));
    expect(screen.getByRole('button', { name: '确认应用' })).toBe(confirm);
    expect(controller.startAgentRun).toHaveBeenCalledOnce(); expect(onApply).not.toHaveBeenCalled();
  });

  it('opens reference and completed backup destinations in the left host and focuses their existing content', async () => {
    const delivery = await import('./scene-delivery-panel'); let restored: (() => void) | undefined;
    const Original = delivery.SceneDeliveryPanel;
    vi.spyOn(delivery, 'SceneDeliveryPanel').mockImplementation(props => { restored = props.onBackupRestored; return <Original {...props}/>; });
    renderUI(<DockedTrial/>); await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: '外部图纸核对' }));
    const host = screen.getByTestId('docked-business-host');
    const reference = host.querySelector<HTMLElement>('[aria-label="图纸与场地对应核对"]')!;
    expect(document.activeElement).toBe(reference); expect(host.hidden).toBe(false);
    expect(host.querySelector<HTMLDetailsElement>('.rc-inputs')?.open).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '执行资料' }));
    expect(host.contains(screen.getByRole('group', { name: '执行工作单' }))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '活动需求' }));
    act(() => restored?.());
    const destination = screen.getByRole('group', { name: '执行工作单' });
    expect(host.contains(destination)).toBe(true); expect(document.activeElement).toBe(destination);
    expect((screen.getByRole('combobox', { name: '工作模式' }) as HTMLSelectElement).value).toBe('plan');
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled(); expect(controller.startAgentRun).not.toHaveBeenCalled();
  });

  it('starts mobile with chat closed and keeps reference fields and conversation mutually exclusive', async () => {
    vi.stubGlobal('innerWidth', 390);
    const conversation = vi.fn(), workspace = vi.fn();
    renderUI(<DockedTrial onWorkspace={workspace} onConversation={conversation}/>); await act(async () => {});
    expect(screen.queryByRole('textbox', { name: '告诉助手你的想法' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: '客户需求' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '外部图纸核对' }));
    const reference = screen.getByTestId('docked-business-host').querySelector<HTMLElement>('[aria-label="图纸与场地对应核对"]')!;
    expect(reference.closest('[hidden]')).toBeNull(); expect(document.activeElement).toBe(reference);
    expect(screen.queryByRole('textbox', { name: '告诉助手你的想法' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '打开 Binggo Agent' }));
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: '客户需求' })).toBeNull();
    expect(workspace).toHaveBeenLastCalledWith(false); expect(conversation).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: '收起聊天' }));
    expect(screen.queryByRole('textbox', { name: '告诉助手你的想法' })).toBeNull();
    expect(conversation).toHaveBeenLastCalledWith(false);
    const referenceEntry = screen.getByRole('button', { name: '外部图纸核对' });
    fireEvent.click(referenceEntry);
    fireEvent.click(screen.getByRole('button', { name: '返回素材' }));
    expect(screen.queryByRole('textbox', { name: '客户需求' })).toBeNull();
    expect(workspace).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(document.activeElement).toBe(referenceEntry));
    expect(controller.startAgentRun).not.toHaveBeenCalled();
  });
});

describe('direct local delivery shortcut', () => {
  it('[reference integration] opens the original planning review panel and returns focus without remounting or losing drafts', async () => {
    const reconstruction = await import('./reconstruction-panel'), Original = reconstruction.ReconstructionPanel;
    const mounted = vi.fn();
    vi.spyOn(reconstruction, 'ReconstructionPanel').mockImplementation(props => {
      useEffect(() => { mounted(); }, []);
      return <Original {...props}/>;
    });
    function Trial() {
      const [request, setRequest] = useState(0), entry = useRef<HTMLButtonElement>(null);
      return <CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}>
        <button ref={entry} onClick={() => setRequest(value => value + 1)}>核对参考底图</button>
        <CreativeAssistant referenceOpenRequest={request} referenceEntryRef={entry}/>
      </CreativeStudioProvider>;
    }
    const rendered = renderUI(<Trial/>);
    fireEvent.click(screen.getByRole('button', { name: '打开 Binggo Agent' }));
    await act(async () => {});
    fireEvent.change(screen.getByRole('textbox', { name: '告诉助手你的想法' }), { target: { value: '未发送策划草稿' } });
    const originalPanel = rendered.container.querySelector('.rc-panel'), originalComposer = screen.getByRole('textbox', { name: '告诉助手你的想法' });
    selectMode('model');
    fireEvent.change(originalComposer, { target: { value: '未发送建模草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '收起 Agent' }));
    const entry = screen.getByRole('button', { name: '核对参考底图' }); fireEvent.click(entry);
    const review = rendered.container.querySelector<HTMLElement>('[aria-label="图纸与场地对应核对"]')!;
    expect((screen.getByRole('combobox', { name: '工作模式' }) as HTMLSelectElement).value).toBe('model');
    expect(document.activeElement).toBe(review);
    expect(rendered.container.querySelector<HTMLDetailsElement>('.rc-inputs')?.open).toBe(true);
    expect(rendered.container.querySelector('.rc-panel')).toBe(originalPanel); expect(mounted).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(originalComposer);
    expect((originalComposer as HTMLTextAreaElement).value).toBe('未发送建模草稿');
    expect(rendered.container.querySelectorAll('#creative-message')).toHaveLength(1);
    selectMode('plan'); expect((originalComposer as HTMLTextAreaElement).value).toBe('未发送策划草稿');
    selectMode('model'); expect((originalComposer as HTMLTextAreaElement).value).toBe('未发送建模草稿');
    fireEvent.click(screen.getByRole('button', { name: '收起 Agent' })); expect(document.activeElement).toBe(entry);
    expect(onApply).not.toHaveBeenCalled(); expect(controller.startAgentRun).not.toHaveBeenCalled();
  });

  it('preserves the explicit restore destination when its completion runs before the scope reset effect',async()=>{
    const delivery=await import('./scene-delivery-panel');const Original=delivery.SceneDeliveryPanel;
    const restoredId='restored-before-scope-effect';const completed=vi.fn();
    vi.spyOn(delivery,'SceneDeliveryPanel').mockImplementation(props=>{
      const handled=useRef(false);
      useLayoutEffect(()=>{
        if(props.layout.id===restoredId&&!handled.current){handled.current=true;completed();props.onBackupRestored?.();}
      },[props.layout.id,props.onBackupRestored]);
      return <Original {...props}/>;
    });
    const view=renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'旧项目策划输入'}});
    selectMode('model');fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'旧项目建模输入'}});openExecution();
    const mode=screen.getByRole('combobox',{name:'工作模式'}) as HTMLSelectElement;
    mode.focus();view.rerender(ui({...layout,id:restoredId,name:'恢复完成项目'}));
    expect(completed).toHaveBeenCalledOnce();expect(mode.value).toBe('plan');
    expect(document.activeElement).toBe(mode);
    expect(screen.getByRole('group',{name:'执行工作单'})).toBeTruthy();
    selectMode('plan');expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('');
    selectMode('model');expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('');
    view.rerender(ui({...layout,id:'ordinary-new-project',name:'普通新项目'}));expect(mode.value).toBe('plan');
    expect(onApply).not.toHaveBeenCalled();expect(controller.startAgentRun).not.toHaveBeenCalled();
  });

  it('returns to the completion page after a restored project scope resets the workspace',async()=>{
    const delivery=await import('./scene-delivery-panel');const Original=delivery.SceneDeliveryPanel;
    let restored:(()=>void)|undefined;
    vi.spyOn(delivery,'SceneDeliveryPanel').mockImplementation(props=>{restored=props.onBackupRestored;return <Original {...props}/>;});
    const view=renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    selectMode('model');fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'旧项目的未发送建模输入'}});openExecution();
    const changed={...layout,id:'restored-local-project',name:'恢复后的项目'};view.rerender(ui(changed));
    const mode=screen.getByRole('combobox',{name:'工作模式'}) as HTMLSelectElement;
    expect(mode.value).toBe('plan');expect(restored).toBeTypeOf('function');
    act(()=>{restored!();});expect(mode.value).toBe('plan');
    expect(screen.getByRole('group',{name:'执行工作单'})).toBeTruthy();
    selectMode('model');expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('');
    expect(onApply).not.toHaveBeenCalled();expect(controller.startAgentRun).not.toHaveBeenCalled();
  });

  it('opens the generic workspace at planning first and retains drafts and the selected tool when reopened', async () => {
    function Trial(){
      const [request,setRequest]=useState(0);const entry=useRef<HTMLButtonElement>(null);
      return <CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><button ref={entry} onClick={()=>setRequest(value=>value+1)}>打开活动工作区</button><CreativeAssistant workspaceOpenRequest={request} workspaceEntryRef={entry}/></CreativeStudioProvider>;
    }
    renderUI(<Trial/>);await act(async()=>{});const entry=screen.getByRole('button',{name:'打开活动工作区'});fireEvent.click(entry);
    const mode=screen.getByRole('combobox',{name:'工作模式'}) as HTMLSelectElement;
    expect(mode.value).toBe('plan');expect(screen.queryByRole('group',{name:'执行工作单'})).toBeNull();
    expect(screen.getByRole('region',{name:'Agent'}).classList.contains('is-expanded')).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('textbox',{name:'客户需求'}));
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'原活动简报文字'}});
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'策划未发送文字'}});
    selectMode('model');fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'建模未发送文字'}});
    fireEvent.click(screen.getByRole('button',{name:'材质调整'}));fireEvent.keyDown(screen.getByRole('region',{name:'Agent'}),{key:'Escape'});
    expect(document.activeElement).toBe(entry);fireEvent.click(entry);
    expect(mode.value).toBe('model');selectMode('model');expect(screen.getByRole('button',{name:'材质调整'}).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('region',{name:'Agent'}).classList.contains('is-expanded')).toBe(true);
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('建模未发送文字');
    selectMode('plan');expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('策划未发送文字');
    expect((screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement).value).toBe('原活动简报文字');
    expect(controller.startAgentRun).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('opens the existing execution list in one click without preparing cloud or Agent work', async () => {
    const current = backendSceneToLayout(candidate, { name: '演练 · 执行入口' });
    const prepare = vi.spyOn(controller, 'ensureWorkbenchReady');
    renderUI(<DeliveryShortcutTrial current={current}/>);
    expect(screen.queryByRole('region', { name: '场景交付' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '打开执行工作单' }));
    const work = await screen.findByRole('group', { name: '执行工作单' });
    expect(document.activeElement).toBe(work);
    expect(screen.getByText('采购汇总 · 1 类')).toBeDefined();
    expect(screen.getByRole('button', { name: '导出执行清单 CSV' })).toBeDefined();
    expect(prepare).not.toHaveBeenCalled(); expect(controller.startAgentRun).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('returns keyboard focus to the shortcut after Escape and opens the same list again', async () => {
    renderUI(<DeliveryShortcutTrial/>);
    const entry = screen.getByRole('button', { name: '打开执行工作单' });
    fireEvent.click(entry);
    fireEvent.keyDown(await screen.findByRole('group', { name: '执行工作单' }), { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(entry));
    fireEvent.click(entry);
    expect(await screen.findByRole('group', { name: '执行工作单' })).toBe(document.activeElement);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('opens execution directly while preserving the modeling draft and material tool', async () => {
    renderUI(<DeliveryShortcutTrial/>);fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    selectMode('model');
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'一把绿色椅子，尚未发送'}});
    fireEvent.click(screen.getByRole('button',{name:'材质调整'}));
    fireEvent.click(screen.getByRole('button',{name:'打开执行工作单'}));
    const work=await screen.findByRole('group',{name:'执行工作单'});
    expect(document.activeElement).toBe(work);
    expect((screen.getByRole('combobox',{name:'工作模式'}) as HTMLSelectElement).value).toBe('model');
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('一把绿色椅子，尚未发送');
    selectMode('model');
    expect(screen.getByRole('button',{name:'材质调整'}).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('一把绿色椅子，尚未发送');
    expect(controller.startAgentRun).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it.each([false,true])('opens and focuses the original demand form from activity operations (saved=%s)', async saved => {
    if(saved)vi.mocked(readSourceForm).mockImplementation(async key => key.endsWith(':brief') ? {event:'工作坊',guests:30,description:'已保存的活动需求',mustHave:'',allowIdeas:false} : undefined);
    const prepare=vi.spyOn(controller,'ensureWorkbenchReady');
    const view=renderUI(<DeliveryShortcutTrial operations/>);
    const entry=screen.getByRole('button',{name:'打开执行工作单'});
    fireEvent.click(entry);
    await screen.findByRole('group',{name:'执行工作单'});
    const details=view.container.querySelector<HTMLDetailsElement>('.cr-agent-brief')!;
    expect(details.open).toBe(true);
    fireEvent.click(await screen.findByRole('button',{name:saved?'查看活动需求':'打开活动需求表单'}));
    const input=screen.getByRole('textbox',{name:'客户需求'});
    await waitFor(()=>expect(document.activeElement).toBe(input));
    expect(details.open).toBe(true);
    expect((screen.getByRole('combobox',{name:'工作模式'}) as HTMLSelectElement).value).toBe('plan');
    expect(screen.getAllByRole('textbox',{name:'客户需求'})).toHaveLength(1);
    expect((input as HTMLTextAreaElement).value).toBe(saved?'已保存的活动需求':'');
    expect(prepare).not.toHaveBeenCalled(); expect(controller.startAgentRun).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
    fireEvent.keyDown(input,{key:'Escape'});
    await waitFor(()=>expect(document.activeElement).toBe(entry));
    fireEvent.click(entry);
    expect(await screen.findByRole('group',{name:'执行工作单'})).toBe(document.activeElement);
  });
});

function render(element: React.ReactElement) {
  const view=renderUI(element);
  fireEvent.click(screen.getByRole('button', {name:'打开 Binggo Agent'}));
  const brief=view.container.querySelector<HTMLDetailsElement>('.cr-agent-brief')!;
  if(!brief.open)fireEvent.click(screen.getByText('活动需求与场地资料'));
  fireEvent.click(screen.getByText('风格、配色与氛围（可选）'));
  fireEvent.click(screen.getByText('图纸、照片与现场条件（可选）'));
  fireEvent.click(screen.getByText('图纸与照片重建'));
  fireEvent.click(screen.getByLabelText('助手设置'));
  fireEvent.click(screen.getByRole('checkbox', {name:'明确指令直接应用'}));
  return view;
}
function selectMode(value:'plan'|'model'):void {
  fireEvent.change(screen.getByRole('combobox',{name:'工作模式'}),{target:{value}});
}
function openExecution():void {
  fireEvent.click(screen.getByRole('button',{name:'执行资料'}));
}

function connected(): void {
  Object.assign(snapshot, {
    configured: true, user: { id: 'test-user' }, sessionId:proposal.session_id,localRevision:0,lease:{projectId,sessionId:proposal.session_id,generation:1,revision:1,expiresAt:'2099-01-01T00:00:00Z'}, writeBlocked: false, status: 'editing', revision: 1,
    project: { id: projectId, studio_id: 'studio-test', name: '客户方案', revision: 1, scene },
  });
}

function enterBrief(): void {
  fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '给 24 位来宾布置一个交流会，保留中心通道。' } });
}

async function generatePreview(): Promise<void> {
  enterBrief();
  fireEvent.click(screen.getByRole('button', { name: '生成布置预览' }));
  await screen.findByText('方案提案 · 尚未应用');
}

function upload(container: HTMLElement, files: File[]): void {
  const input = container.querySelector('input[type="file"]')!;
  fireEvent.change(input, { target: { files } });
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  onApply.mockReset();
  onPreview.mockReset();
  forbiddenFetch.mockClear();
  vi.mocked(readSourceForm).mockReset().mockResolvedValue(undefined);
  vi.mocked(storeSourceForm).mockReset().mockResolvedValue(undefined);
  vi.mocked(deleteSourceForm).mockReset().mockResolvedValue(undefined);
  vi.mocked(copySourceScope).mockReset().mockResolvedValue(undefined);
  vi.mocked(listStoredSources).mockReset().mockResolvedValue([]);
  vi.stubGlobal('fetch', forbiddenFetch);
  createBitmap.mockReset().mockImplementation(async () => ({ width: 1024, height: 768, close: vi.fn() }));
  createObjectURL.mockReset().mockReturnValue('blob:local-reference');
  revokeObjectURL.mockReset();
  vi.stubGlobal('createImageBitmap', createBitmap);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  controller = new BackendSession(getBackendConfig({ url: '', anonKey: '' }));
  snapshot = { ...controller.getSnapshot() };
  vi.spyOn(controller, 'getSnapshot').mockImplementation(() => snapshot);
  vi.spyOn(controller, 'listSources').mockResolvedValue([]);
  prepareProposal.mockReset().mockResolvedValue(proposal);
  vi.spyOn(controller,'startAgentRun').mockImplementation(async input=>runFrom(await prepareProposal(input),input));
  vi.spyOn(controller,'getAgentRun');
  vi.spyOn(controller,'getAgentRunByRequest');
  vi.spyOn(controller,'cancelAgentRun');
  vi.spyOn(controller, 'authorizeAssets').mockResolvedValue({ assetUrls: {}, assetNames: {} });
  vi.spyOn(controller, 'applySceneProposal').mockResolvedValue({ id: projectId, revision: 2, scene: candidate, previousScene: scene, updatedAt: '2026-10-02T10:00:00Z', undoGroup: 'undo-test', acceptedLocally: true });
  layout = backendSceneToLayout(scene, { projectId, name: '客户方案' });
});

afterEach(() => {
  cleanup();
  controller.dispose();
  vi.useRealTimers();
  expect(forbiddenFetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  restoreProperty(URL, 'createObjectURL', originalCreateObjectURL);
  restoreProperty(URL, 'revokeObjectURL', originalRevokeObjectURL);
  restoreProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
});

describe('creative brief and assistant interaction', () => {
  it('blocks whole-scene generation for an untouched manual scaffold while preserving actual text and modeling',async()=>{
    connected();renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    const add=screen.getByRole('button',{name:'添加活动简报提纲'});await waitFor(()=>expect(add.hasAttribute('disabled')).toBe(false));fireEvent.click(add);
    const generate=screen.getByRole('button',{name:'生成布置方案'});expect(generate.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('先补充活动目标和参与观众，再生成整场布置方案。')).toBeTruthy();
    fireEvent.click(generate);expect(controller.startAgentRun).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    const demand=screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement;
    const scaffold=demand.value;fireEvent.change(demand,{target:{value:`客户原话，保留入口。\n\n${scaffold}`}});
    expect(generate.hasAttribute('disabled')).toBe(false);
    fireEvent.change(demand,{target:{value:scaffold}});selectMode('model');fireEvent.click(screen.getByRole('button',{name:'椅'}));
    const send=screen.getByRole('button',{name:'发送消息'});expect(send.hasAttribute('disabled')).toBe(false);
    fireEvent.click(send);await screen.findByText('方案提案 · 尚未应用');
    expect(controller.startAgentRun).toHaveBeenCalledOnce();expect(vi.mocked(controller.startAgentRun).mock.calls[0]![0].executionMode).toBe('preview');expect(onApply).not.toHaveBeenCalled();
  });

  it('appends the manual brief scaffold to the original text and does not dirty it again',async()=>{
    const {MANUAL_BRIEF_TEMPLATE}=await import('../lib/creative-brief');
    renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    const button=screen.getByRole('button',{name:'添加活动简报提纲'});
    await waitFor(()=>expect(button.hasAttribute('disabled')).toBe(false));
    const input=screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement;
    fireEvent.change(input,{target:{value:'客户原话，请保留入口。'}});fireEvent.click(button);
    expect(input.value).toBe(`客户原话，请保留入口。\n\n${MANUAL_BRIEF_TEMPLATE}`);
    expect(screen.getByText('提纲已加入当前输入，请逐项填写并核对。')).toBeTruthy();
    await act(async()=>{await flushSourceScope(projectId);});vi.mocked(storeSourceForm).mockClear();
    fireEvent.click(button);await act(async()=>{await flushSourceScope(projectId);});
    expect(input.value).toBe(`客户原话，请保留入口。\n\n${MANUAL_BRIEF_TEMPLATE}`);
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([key])=>key.endsWith(':brief'))).toHaveLength(0);
    expect(screen.getByText('当前文字已含提纲，未重复添加。')).toBeTruthy();
  });

  it('leaves an oversized manual brief unchanged and reports the limit without truncating',async()=>{
    renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    const button=screen.getByRole('button',{name:'添加活动简报提纲'});await waitFor(()=>expect(button.hasAttribute('disabled')).toBe(false));
    const input=screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement;const original='原'.repeat(1800);
    fireEvent.change(input,{target:{value:original}});fireEvent.click(button);
    expect(input.value).toBe(original);expect(screen.getByRole('alert').textContent).toContain('原文字保持不变');
  });

  it.each(['pending','failed'] as const)('does not append a template before the brief is safely readable (%s)',async state=>{
    vi.mocked(readSourceForm).mockImplementation(key=>key.endsWith(':brief')?state==='pending'?new Promise(()=>{}):Promise.reject(new Error('简报读取拒绝')):Promise.resolve(undefined));
    renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    const input=screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement;fireEvent.change(input,{target:{value:'读取期间保留的原输入'}});
    if(state==='failed')await screen.findByRole('alert');
    const button=screen.getByRole('button',{name:'添加活动简报提纲'});expect(button.hasAttribute('disabled')).toBe(true);fireEvent.click(button);
    expect(input.value).toBe('读取期间保留的原输入');expect(vi.mocked(storeSourceForm).mock.calls.filter(([key])=>key.endsWith(':brief'))).toHaveLength(0);
  });

  it('keeps manual template edits disabled while a backup operation is pending',async()=>{
    let actions!:LocalProjectBackupActions;
    function Probe(){actions=useLocalProjectBackup()!;return null;}
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><CreativeBriefPanel/><Probe/></CreativeStudioProvider>);
    const button=screen.getByRole('button',{name:'添加活动简报提纲'});await waitFor(()=>expect(button.hasAttribute('disabled')).toBe(false));
    let finish!:(value:undefined)=>void;vi.mocked(readSourceForm).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    let preparation!:Promise<string>;act(()=>{preparation=actions.prepareBackup();});
    await waitFor(()=>expect(button.hasAttribute('disabled')).toBe(true));fireEvent.click(button);
    expect((screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement).value).toBe('');
    await waitFor(()=>expect(finish).toBeTypeOf('function'));await act(async()=>{finish(undefined);await preparation;});
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it.each(['activity', 'nested activity'] as const)('preserves a local %s without preparing cloud or starting Agent work', async kind => {
    snapshot = { ...snapshot, configured: true };
    const operations = { schemaVersion: 1 as const, dataKind: 'unspecified' as const, tasks: [] };
    const local = { ...layout, eventOperations: operations };
    const current = kind === 'activity' ? local : { ...layout, designBook: { activeId: 'parent', variants: [{ id: 'parent', name: '方案', layout: { ...layout, designBook: { activeId: 'leaf', variants: [{ id: 'leaf', name: '活动方案', layout: local }] } } }] } };
    const ready = vi.spyOn(controller, 'ensureWorkbenchReady');
    render(ui(current));
    fireEvent.change(screen.getByRole('textbox', { name: '告诉助手你的想法' }), { target: { value: '增加一张桌子' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(screen.getAllByText(LOCAL_HANDOFF_CLOUD_MESSAGE).length).toBeGreaterThan(0));
    expect(ready).not.toHaveBeenCalled(); expect(controller.startAgentRun).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
    expect(local.eventOperations).toBe(operations);
  });

  it('preserves a local execution worksheet without preparing a cloud workbench or starting an Agent run', async () => {
    snapshot = { ...snapshot, configured: true };
    const local = backendSceneToLayout(candidate, { name: '本地执行场景' });
    local.floors[0]!.items[0]!.handoff = { ownerName: '布展负责人', dueDate: '2026-10-08', acceptance: '摆放完成并核对通道', status: 'todo', evidenceUrls: [], evidenceNote: '' };
    const ready = vi.spyOn(controller, 'ensureWorkbenchReady');
    const bind = vi.fn();
    render(<CreativeStudioProvider controller={controller} layout={local} onApply={onApply} onBindProject={bind}><CreativeAssistant/></CreativeStudioProvider>);
    fireEvent.change(screen.getByRole('textbox', { name: '告诉助手你的想法' }), { target: { value: '增加一张桌子' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(screen.getAllByText(LOCAL_HANDOFF_CLOUD_MESSAGE).length).toBeGreaterThan(0));
    expect(ready).not.toHaveBeenCalled();
    expect(controller.startAgentRun).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    expect(local.floors[0]!.items[0]!.handoff?.ownerName).toBe('布展负责人');
  });

  it('prepares an isolated workbench automatically for the first local Agent request and preserves its scene and prompt', async () => {
    snapshot={...snapshot,configured:true};
    const local={...backendSceneToLayout(candidate,{name:'本地活动场地'})};
    let finish!:()=>void;
    const ensureWorkbenchReady=vi.fn(()=>new Promise(resolve=>{finish=()=>{connected();resolve(snapshot.project);};}));
    Object.assign(controller,{ensureWorkbenchReady});
    prepareProposal.mockResolvedValueOnce({...proposal,base_scene:candidate,candidate:scene});
    vi.mocked(controller.startAgentRun).mockImplementationOnce(async input=>({...runFrom(await prepareProposal(input),input),executionMode:'preview'}));
    function Harness(){
      const [value,setValue]=useState(local);
      return <CreativeStudioProvider controller={controller} layout={value} onApply={onApply} onBindProject={id=>setValue(current=>({...current,id}))}><CreativeAssistant/></CreativeStudioProvider>;
    }
    renderUI(<Harness/>);
    fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    enterBrief();
    const instruction='生成一张长 1.6 米、宽 0.8 米、高 0.75 米的矩形桌，先给预览';
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:instruction}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await waitFor(()=>expect(ensureWorkbenchReady).toHaveBeenCalledOnce());
    expect(prepareProposal).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'下一条还没发送的需求'}});
    await act(async()=>finish());
    await screen.findByText('方案提案 · 尚未应用');
    expect(prepareProposal).toHaveBeenCalledWith(expect.objectContaining({instruction,scene:candidate}));
    expect(screen.getByText(instruction)).toBeTruthy();
    expect((screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement).value).toContain('24 位来宾');
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('下一条还没发送的需求');
    expect(screen.queryByText(/请在“账户与项目”中打开/)).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it.each(['scene','brief','cancel'] as const)('does not start a paid Agent run if %s changes during automatic workbench preparation', async change=>{
    snapshot={...snapshot,configured:true};
    const local=backendSceneToLayout(candidate,{name:'本地活动场地'});
    let finish!:()=>void;
    const ready=vi.fn(()=>new Promise(resolve=>{finish=()=>{connected();resolve(snapshot.project);};}));
    Object.assign(controller,{ensureWorkbenchReady:ready});
    const rendered=render(ui(local));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'生成一张桌子，先预览'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await waitFor(()=>expect(ready).toHaveBeenCalledOnce());
    if(change==='scene')rendered.rerender(ui({...local,name:'正在编辑的新场地'}));
    else if(change==='brief')enterBrief();
    else fireEvent.click(screen.getByRole('button',{name:'取消任务'}));
    await act(async()=>finish());
    expect(prepareProposal).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('opens complete templates separately without losing the planning draft or invoking generation', async () => {
    connected();
    const preset:RoomLayout={...layout,name:'办公室 · 留白',scenePreset:'office'};
    vi.mocked(loadScenePreset).mockResolvedValueOnce(preset);
    vi.spyOn(window,'confirm').mockReturnValue(true);
    const create=vi.spyOn(controller,'createGenerationJob');
    renderUI(ui());
    fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'保留这条未发送的需求'}});
    fireEvent.click(screen.getByRole('button',{name:'场景模板'}));
    expect(screen.getAllByRole('button',{name:/载入工作台/})).toHaveLength(10);
    fireEvent.click(screen.getByRole('button',{name:'返回当前工作区'}));
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('保留这条未发送的需求');
    fireEvent.click(screen.getByRole('button',{name:'场景模板'}));
    fireEvent.click(screen.getByRole('button',{name:/办公室 · 留白/}));
    await waitFor(()=>expect(onApply).toHaveBeenCalledWith({...preset,id:layout.id,name:layout.name}));
    expect(loadScenePreset).toHaveBeenCalledWith('office');
    expect(prepareProposal).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole('option',{name:'物料建模'})).toBeTruthy();
  });

  it('ignores a pending template download after returning to the current workspace', async () => {
    let finish!:(value:RoomLayout)=>void;
    vi.mocked(loadScenePreset).mockReset().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    vi.spyOn(window,'confirm').mockReturnValue(true);
    renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));selectMode('model');
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'仍在建模的未发送输入'}});
    fireEvent.click(screen.getByRole('button',{name:'场景模板'}));
    fireEvent.click(screen.getByRole('button',{name:/办公室 · 留白/}));
    expect(loadScenePreset).toHaveBeenCalledOnce();expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'返回当前工作区'}));
    await act(async()=>{finish({...layout,name:'迟到的办公室模板',scenePreset:'office'});});
    expect(onApply).not.toHaveBeenCalled();expect(controller.startAgentRun).not.toHaveBeenCalled();
    expect((screen.getByRole('combobox',{name:'工作模式'}) as HTMLSelectElement).value).toBe('model');
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('仍在建模的未发送输入');
  });

  it('keeps text planning available alongside reconstruction for an existing v2 scene',async()=>{
    render(ui(createMeasuredRoomLayout(layout,{width:12,depth:10,height:3})));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Generate 重建并设计方案'}).hasAttribute('disabled')).toBe(false));
    expect(screen.getByRole('button',{name:'生成布置预览'})).toBeTruthy();
    expect(screen.getByText('生成布置预览')).toBeTruthy();
  });

  it('sends full resource requirements to the Agent without a built-in catalogue rejection', async () => {
    connected();render(ui());
    fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '需要圆桌和帐篷，安排24人交流会' } });
    fireEvent.click(screen.getByRole('button', { name: '生成布置预览' }));
    await screen.findByText('方案提案 · 尚未应用');
    expect(prepareProposal).toHaveBeenCalledWith(expect.objectContaining({ context:expect.objectContaining({brief: expect.stringContaining('需要圆桌和帐篷')}) }));
    expect(screen.queryByText('圆桌的处理方式')).toBeNull();
  });

  it('lets the Agent select a library tent and loads the authorized GLB before applying', async () => {
    connected();
    const assetId='50000000-0000-4000-8000-000000000001';
    const assetCandidate:Scene={...candidate,objects:[{...candidate.objects[0],materialId:'asset',assetId}]};
    const assetProposal={...proposal,candidate:assetCandidate};
    vi.mocked(prepareProposal).mockResolvedValueOnce(assetProposal);
    vi.mocked(controller.authorizeAssets).mockResolvedValueOnce({assetUrls:{[assetId]:'https://storage.example/tent.glb'},assetNames:{[assetId]:'资源库帐篷'}});
    vi.mocked(controller.applySceneProposal).mockResolvedValueOnce({id:projectId,revision:2,scene:assetCandidate,previousScene:scene,updatedAt:'2026-10-03T10:00:00Z',undoGroup:'undo-test',acceptedLocally:true});
    renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'从资源库加入一顶帐篷'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
    expect(prepareProposal).toHaveBeenCalledWith(expect.objectContaining({instruction:expect.stringContaining('从资源库加入一顶帐篷')}));
    expect(ensureGlbAsset).toHaveBeenCalledWith(assetId,'https://storage.example/tent.glb');
    expect(controller.applySceneProposal).toHaveBeenCalledWith(assetProposal,layoutToBackendScene(layout));
    expect(onApply.mock.calls[0]![0].floors[0].items[0]).toMatchObject({assetId,name:'资源库帐篷'});
  });

  it('shows an unsupported shape without exposing HY3 creation', async () => {
    connected();
    prepareProposal.mockResolvedValueOnce({...proposal,candidate:scene,explanation:'资源库和参数族暂不支持花形拱门。'});
    vi.spyOn(controller,'listGenerationJobs').mockResolvedValue([]);
    const create=vi.spyOn(controller,'createGenerationJob');
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><CreativeAssistant generationPanel={<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>}/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'添加花形拱门'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await screen.findByText('资源库和参数族暂不支持花形拱门。');
    selectMode('model');
    expect(screen.queryByRole('button',{name:/HY3|生成 3D 模型/})).toBeNull();
    expect(screen.getByRole('button',{name:'桌'})).toBeTruthy();
    expect(controller.authorizeAssets).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('hands exact material targets to a preview without applying the scene or calling HY3', async () => {
    connected();
    const suggestion={name:'椅面换色',reason:'保留原模型，调整选中椅子的基础色',objectIds:['20000000-0000-4000-8000-000000000001'],sourceAssetId:'50000000-0000-4000-8000-000000000001',scope:'choose_materials' as const,changes:{baseColor:'#aabbcc'}};
    vi.mocked(prepareProposal).mockResolvedValueOnce({...proposal,candidate:scene,materialSuggestions:[suggestion]});
    const create=vi.spyOn(controller,'createGenerationJob');
    renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'把选中椅子的椅面改为灰蓝色'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    fireEvent.click(await screen.findByRole('button',{name:'预览材质调整'}));
    expect(JSON.parse(screen.getByTestId('material-seed').textContent!)).toMatchObject({sourceAssetId:suggestion.sourceAssetId,objectIds:suggestion.objectIds,changes:suggestion.changes,materialScope:'choose_materials',projectId,userId:'test-user'});
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole('button',{name:'材质调整'}).getAttribute('aria-pressed')).toBe('true');
    openExecution();
    expect(screen.getByRole('button',{name:'导出场景 GLB'})).toBeTruthy();
    selectMode('model');
    expect(screen.getByRole('button',{name:'材质调整'}).getAttribute('aria-pressed')).toBe('true');
  });
  it('tracks the newly applied version so the same instances can restore their parent', async () => {
    connected();
    const sourceAssetId='50000000-0000-4000-8000-000000000001',variantAssetId='50000000-0000-4000-8000-000000000002';
    const base:Scene={...candidate,objects:[{...candidate.objects[0]!,materialId:'asset',assetId:sourceAssetId}]};
    const current=backendSceneToLayout(base,{projectId,name:'材质测试'});
    const suggestion={objectIds:[base.objects[0]!.id],sourceAssetId,name:'蓝色椅子',reason:'仅选中实例',scope:'all_materials' as const,changes:{baseColor:'#285fad'}};
    vi.mocked(prepareProposal).mockResolvedValueOnce({...proposal,base_scene:base,candidate:base,materialSuggestions:[suggestion]});
    function Harness(){const [value,setValue]=useState(current);return <CreativeStudioProvider controller={controller} layout={value} onApply={setValue}><CreativeAssistant/></CreativeStudioProvider>;}
    renderUI(<Harness/>);fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'给椅子换色'}});fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    fireEvent.click(await screen.findByRole('button',{name:'预览材质调整'}));
    act(()=>materialProps.onApply({...current,floors:current.floors.map(floor=>({...floor,items:floor.items.map(item=>({...item,assetId:variantAssetId}))}))}));
    expect(materialProps.seed).toMatchObject({sourceAssetId:variantAssetId,objectIds:suggestion.objectIds});
    expect(materialProps.seed!.changes).toBeUndefined();
    fireEvent.click(screen.getByRole('button',{name:'使用当前选中物件'}));expect(materialProps.seed).toBeUndefined();
  });

  it('ignores a late suggestion after the signed-in account changes', async () => {
    connected();let finish!:(value:SceneProposal)=>void;
    vi.mocked(prepareProposal).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const view=renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'添加花形拱门'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await waitFor(()=>expect(finish).toBeTypeOf('function'));
    snapshot={...snapshot,user:{id:'another-user'}};view.rerender(ui());
    await act(async()=>{finish({...proposal,candidate:scene,modelSuggestions:[{name:'花形拱门',reason:'缺少该资源',prompt:'单件花形拱门'}]});});
    expect(screen.queryByRole('button',{name:'前往 HY3 生成'})).toBeNull();
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('moves keyboard focus into the assistant and returns it on Escape', () => {
    renderUI(ui());
    const launch = screen.getByRole('button', { name: '打开 Binggo Agent' });
    expect(screen.getByRole('img',{name:'Binggo 小狗'}).getAttribute('src')).toBe('/assets/assistant/puppy.png');
    fireEvent.click(launch);
    const input = screen.getByRole('textbox', { name: '告诉助手你的想法' });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Agent' })).toBeNull();
    expect(document.activeElement).toBe(launch);
  });

  it('explains the missing AI connection offline without fabricating a proposal or changing the scene', async () => {
    render(ui());
    expect(screen.getByRole('button', { name: '生成布置预览' }).hasAttribute('disabled')).toBe(true);
    enterBrief();
    fireEvent.click(screen.getByRole('button', { name: '生成布置预览' }));
    expect(await screen.findByRole('region', { name: 'Agent' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('当前尚未连接 AI 服务');
    expect(screen.queryByText('方案提案 · 尚未应用')).toBeNull();
    expect(screen.queryByRole('button', { name: '确认应用' })).toBeNull();
    expect(prepareProposal).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('shows local reference images, tells users they are not sent to the model, and releases their URLs', async () => {
    const rendered = render(ui());
    const file = new File(['image fixture'], 'venue.png', { type: 'image/png' });
    upload(rendered.container, [file]);
    const image = await screen.findByRole('img', { name: '现场照片：venue.png' });
    expect(screen.getByRole('button',{name:'生成布置预览'})).toBeTruthy();
    expect(screen.getByText('生成布置预览')).toBeTruthy();
    expect(image.getAttribute('src')).toBe('blob:local-reference');
    expect(screen.getByText(/图片保存在本机；连接项目并生成时会上传至私有存储/)).toBeTruthy();
    expect(prepareProposal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '移除 venue.png' }));
    expect(screen.queryByRole('img', { name: '现场照片：venue.png' })).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-reference');
    upload(rendered.container, [file]);
    await screen.findByRole('img', { name: '现场照片：venue.png' });
    rendered.unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['unsupported format', () => new File(['vector'], 'venue.svg', { type: 'image/svg+xml' }), '请选择 PNG、JPEG 或 WebP 图片。'],
    ['oversized file', () => new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'venue.png', { type: 'image/png' }), '每张图片不能超过 5 MB。'],
  ])('rejects %s before creating a preview or decoding', async (_case, file, message) => {
    const rendered = render(ui());
    upload(rendered.container, [file()]);
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByRole('img', { name: '现场照片：venue.png' })).toBeNull();
    expect(createBitmap).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('closes an oversized decoded bitmap and does not create a preview URL', async () => {
    const close = vi.fn();
    createBitmap.mockResolvedValueOnce({ width: 5000, height: 768, close });
    const rendered = render(ui());
    upload(rendered.container, [new File(['image'], 'wide.png', { type: 'image/png' })]);
    expect(await screen.findByText('图片长宽请控制在 4096 像素以内。')).toBeTruthy();
    expect(close).toHaveBeenCalledOnce();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('presents the actual proposal for confirmation and applies only after the confirmation request succeeds', async () => {
    connected();
    render(ui());
    await generatePreview();
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ id: projectId }));
    expect(prepareProposal).toHaveBeenCalledWith(expect.objectContaining({ scene: layoutToBackendScene(layout), context: expect.objectContaining({brief:expect.stringContaining('给 24 位来宾')}) }));
    expect(onApply).not.toHaveBeenCalled();
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认应用' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    expect(onApply.mock.calls[0]![0].designBook?.variants.map(v => v.name)).toEqual(['原始方案', 'AI 方案 A']);
    expect(controller.applySceneProposal).toHaveBeenCalledWith(proposal, layoutToBackendScene(layout));
    expect(layoutToBackendScene(onApply.mock.calls[0][0])).toEqual(candidate);
    expect(onApply.mock.calls[0][0].designBook?.variants.map(variant=>variant.name)).toEqual(['原始方案','AI 方案 A']);
    expect(screen.queryByText('方案提案 · 尚未应用')).toBeNull();
  });

  it.each(['scene', 'brief', 'lease'] as const)('removes the apply action when the %s changes after a preview', async change => {
    connected();
    const rendered = render(ui());
    await generatePreview();
    if (change === 'scene') rendered.rerender(ui({ ...layout, width: 13 }));
    if (change === 'brief') fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '改成 12 人工作坊。' } });
    if (change === 'lease') {
      snapshot = { ...snapshot, writeBlocked: true };
      rendered.rerender(ui());
    }
    expect(await screen.findByText('场景、需求或编辑权已变化，请重新生成。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认应用' })).toBeNull();
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('preserves the canvas when the controller reports acceptedLocally false', async () => {
    connected();
    vi.mocked(controller.applySceneProposal).mockResolvedValueOnce({ id: projectId, revision: 2, scene: candidate, previousScene: scene, updatedAt: '2026-10-02T10:00:00Z', undoGroup: 'undo-test', acceptedLocally: false });
    render(ui());
    await generatePreview();
    fireEvent.click(screen.getByRole('button', { name: '确认应用' }));
    expect(await screen.findByText(/应用期间本地有新修改，已保留本地草稿/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByText('提案已应用。你可以继续调整，或用撤销返回应用前的本地方案。')).toBeNull();
  });

  it('discards a pending generation result if the scene changes before its response arrives', async () => {
    connected();
    let finish!: (value: SceneProposal) => void;
    vi.mocked(prepareProposal).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const rendered = render(ui());
    enterBrief();
    fireEvent.click(screen.getByRole('button', { name: '生成布置预览' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    rendered.rerender(ui({ ...layout, width: 13 }));
    await act(async () => { finish(proposal); });
    expect(screen.getByRole('status').textContent).toContain('生成期间方案或需求已变化');
    expect(screen.queryByText('方案提案 · 尚未应用')).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('automatically clears the canvas preview at expiration without waiting for a confirm click', async () => {
    connected();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T10:00:00Z'));
    vi.mocked(prepareProposal).mockResolvedValueOnce({ ...proposal, expires_at: '2026-10-02T10:00:02Z' });
    render(ui());
    enterBrief();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '生成布置预览' })); });
    expect(screen.getByRole('button', { name: '确认应用' })).toBeTruthy();
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ id: projectId }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText('提案已过期，请重新生成。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认应用' })).toBeNull();
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('clears the render-only preview when discarded or when its provider unmounts', async () => {
    connected();
    const rendered = render(ui());
    await generatePreview();
    expect(onPreview.mock.calls.at(-1)?.[0]).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '放弃' }));
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(onApply).not.toHaveBeenCalled();
    await generatePreview();
    expect(onPreview.mock.calls.at(-1)?.[0]).not.toBeNull();
    rendered.unmount();
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });

  it('lists individual overlap and boundary warnings against named objects', async () => {
    connected();
    vi.mocked(prepareProposal).mockResolvedValueOnce({ ...proposal, warnings: [
      { code: 'OVERLAP', ids: [candidate.objects[0].id] },
      { code: 'OUT_OF_BOUNDS', ids: [candidate.objects[0].id] },
    ] });
    render(ui());
    await generatePreview();
    expect(screen.getByText('物件重叠：椅子')).toBeTruthy();
    expect(screen.getByText('超出场地边界：椅子')).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });
});

function BriefStateProbe() {
  return <output data-testid="brief-state">{JSON.stringify({state:useCreativeBriefState(),legacy:useCreativeBrief()})}</output>;
}
function briefForm(current = layout) {
  return <CreativeStudioProvider controller={controller} layout={current} onApply={onApply}><CreativeBriefPanel/><BriefStateProbe/></CreativeStudioProvider>;
}
function briefState() { return JSON.parse(screen.getByTestId('brief-state').textContent!).state; }

function installBackupLocks(): void {
  const locks = new Map<string, { shared: number; exclusive: boolean; waiting: (() => boolean)[] }>();
  const request = (name: string, options: LockOptions, callback: (lock: Lock | null) => unknown): Promise<unknown> => new Promise((resolve, reject) => {
    const entry = locks.get(name) ?? { shared: 0, exclusive: false, waiting: [] }; locks.set(name, entry);
    let started = false, aborted = false;
    const available = () => !entry.exclusive && (options.mode === 'shared' || !entry.shared);
    const start = () => {
      if (aborted) return true;
      if (!available()) return false;
      started = true;
      if (options.mode === 'shared') entry.shared++; else entry.exclusive = true;
      Promise.resolve().then(() => callback({ name, mode: options.mode ?? 'exclusive' } as Lock)).then(resolve, reject).finally(() => {
        if (options.mode === 'shared') entry.shared--; else entry.exclusive = false;
        const waiting=entry.waiting.splice(0);
        for(let index=0;index<waiting.length;index++)if(!waiting[index]!()){entry.waiting.push(...waiting.slice(index));break;}
      });
      return true;
    };
    if (options.ifAvailable && !available()) { Promise.resolve(callback(null)).then(resolve, reject); return; }
    options.signal?.addEventListener('abort', () => { if (!started) { aborted = true; reject(new DOMException('Aborted', 'AbortError')); } }, { once: true });
    if (available()) start(); else entry.waiting.push(start);
  });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
}

describe('complete local backup transactions', () => {
  const oldBrief = { event: '工作坊', guests: 0, description: '恢复前需求', mustHave: '', allowIdeas: false };
  const fileBrief = { ...oldBrief, description: '文件需求', guests: 3.5 };
  let actions: LocalProjectBackupActions;
  let changeLayout: (next: RoomLayout) => void;
  let forms: Map<string, unknown>;
  const commit = vi.fn<(next: RoomLayout) => void>();
  const prepare = vi.fn<(next:RoomLayout)=>RoomLayout>();
  function Probe() { actions = useLocalProjectBackup()!; return <BriefStateProbe/>; }
  function Trial() {
    const [current, setCurrent] = useState(layout); changeLayout = setCurrent;
    return <CreativeStudioProvider controller={controller} layout={current} onApply={onApply} prepareRestoreLayout={prepare} commitRestoredLayout={next => { commit(next); setCurrent(next); }}>
      <CreativeBriefPanel/><Probe/><output data-testid="backup-layout">{JSON.stringify(current)}</output>
    </CreativeStudioProvider>;
  }
  const file = (id = projectId, brief: 'present'|'absent'|'legacy' = 'present') => {
    const next = { ...layout, id, name: '文件布局', width: 14 };
    return parseLocalProjectBackupJson(brief === 'legacy' ? JSON.stringify(next) : serializeLocalProjectBackup(next, { state: 'ready', scope: id, brief: brief === 'present' ? { status: 'present', value: fileBrief } : { status: 'absent' } }));
  };
  async function mount() { renderUI(<Trial/>); await waitFor(() => expect(briefState().ready).toBe(true)); }
  beforeEach(() => {
    installBackupLocks(); commit.mockReset();prepare.mockReset().mockImplementation(next=>next);
    forms = new Map([[`${projectId}:brief`, oldBrief]]);
    vi.mocked(readSourceForm).mockImplementation(async key => forms.get(key));
    vi.mocked(storeSourceForm).mockImplementation(async (key, value) => { forms.set(key, value); });
    vi.mocked(deleteSourceForm).mockImplementation(async key => { forms.delete(key); });
  });
  afterEach(() => { Reflect.deleteProperty(navigator, 'locks'); });

  it('restores and undoes the complete production plan, but cannot undo over a newer plan edit',async()=>{
    const rowId='70000000-0000-4000-8000-000000000001';
    const original=productionPlanSchema.parse({dataKind:'rehearsal',staffing:[{id:rowId,roleName:'签到岗位',headcount:2}]});
    layout={...layout,productionPlan:original};await mount();
    const candidate=file();const updated=productionPlanSchema.parse({...original,staffing:[{...original.staffing[0]!,headcount:3}]});
    candidate.layout.productionPlan=updated;
    await act(async()=>{await actions.restoreBackup(candidate);});
    expect(JSON.parse(screen.getByTestId('backup-layout').textContent!).productionPlan).toEqual(updated);
    await act(async()=>{await actions.undoRestore();});
    expect(JSON.parse(screen.getByTestId('backup-layout').textContent!).productionPlan).toEqual(original);
    await act(async()=>{await actions.restoreBackup(candidate);});
    act(()=>changeLayout({...candidate.layout,productionPlan:{...updated,staffing:[{...updated.staffing[0]!,headcount:4}]}}));
    expect(actions.canUndoRestore).toBe(false);
    await expect(actions.undoRestore()).rejects.toThrow('新编辑');
    expect(JSON.parse(screen.getByTestId('backup-layout').textContent!).productionPlan.staffing[0].headcount).toBe(4);
  });
  it('rejects an in-memory V1 candidate augmented with new production data before writing either source',async()=>{
    await mount();const candidate=file();candidate.backupVersion=1;candidate.layout.productionPlan=productionPlanSchema.parse({});
    const writes=vi.mocked(storeSourceForm).mock.calls.length;
    await expect(actions.restoreBackup(candidate)).rejects.toThrow();
    expect(commit).not.toHaveBeenCalled();expect(vi.mocked(storeSourceForm).mock.calls).toHaveLength(writes);
    expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief);
  });

  it('flushes the currently dirty provider and exports the real readback with empty/fractional facts preserved', async () => {
    await mount(); fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '刚输入的真实需求' } });
    let text = ''; await act(async () => { text = await actions.prepareBackup(); });
    expect(parseLocalProjectBackupJson(text).brief).toMatchObject({ status: 'present', value: { guests: 0, description: '刚输入的真实需求', allowIdeas: false } });
    expect(forms.get(`${projectId}:brief`)).toMatchObject({ description: '刚输入的真实需求' });
    expect(commit).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
  });
  it.each(['read', 'save'] as const)('refuses export after a %s failure and keeps the input', async failure => {
    await mount(); fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '未丢的草稿' } });
    if (failure === 'read') vi.mocked(readSourceForm).mockRejectedValueOnce(new Error('读取拒绝'));
    else vi.mocked(storeSourceForm).mockRejectedValueOnce(new Error('写入拒绝'));
    await act(async () => { await expect(actions.prepareBackup()).rejects.toThrow(); });
    expect(briefState().brief.description).toBe('未丢的草稿'); expect(commit).not.toHaveBeenCalled();
  });
  it('stops a delayed export on A→B→A and rejects overlapping clicks', async () => {
    await mount(); let release!: (value: unknown) => void;
    vi.mocked(readSourceForm).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    let pending!: Promise<string>; await act(async () => { pending = actions.prepareBackup(); void pending.catch(() => {}); await Promise.resolve(); });
    await expect(actions.prepareBackup()).rejects.toThrow('正在处理备份');
    act(() => { changeLayout({ ...layout, id: 'backup-b' }); }); act(() => { changeLayout(layout); });
    await act(async () => { release(oldBrief); await expect(pending).rejects.toThrow('已变化'); });
    expect(commit).not.toHaveBeenCalled();
  });
  it('restores the same scope after dirty save, cancels its timer/cache, and undo restores layout plus brief', async () => {
    await mount(); vi.useFakeTimers();
    fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '确认前的草稿' } });
    await act(async () => { await actions.restoreBackup(file()); await vi.advanceTimersByTimeAsync(600); await flushSourceScope(projectId); });
    expect(briefState()).toMatchObject({ hasSavedBrief: true, brief: fileBrief });
    expect(forms.get(`${projectId}:brief`)).toEqual(fileBrief); expect(JSON.parse(screen.getByTestId('backup-layout').textContent!).name).toBe('文件布局');
    expect(actions.canUndoRestore).toBe(true);
    await act(async () => { await actions.undoRestore(); await vi.advanceTimersByTimeAsync(600); });
    expect(forms.get(`${projectId}:brief`)).toMatchObject({ description: '确认前的草稿', guests: 0 });
    expect(briefState().brief.description).toBe('确认前的草稿');
    expect(JSON.parse(screen.getByTestId('backup-layout').textContent!)).toEqual(layout); expect(actions.canUndoRestore).toBe(false);
  });
  it('drains a prior deferred save and prevents timers from queuing late old writes during restore', async () => {
    await mount(); vi.useFakeTimers(); let release!: () => void, held = false;
    vi.mocked(storeSourceForm).mockImplementation((key, value) => {
      if(key.endsWith(':brief')&&!held){held=true;return new Promise(resolve=>{release=()=>{forms.set(key,value);resolve();};});}
      forms.set(key,value);return Promise.resolve();
    });
    fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '排队中的旧草稿' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    let pending!: Promise<void>; await act(async () => { pending = actions.restoreBackup(file()); void pending.catch(() => {}); await vi.advanceTimersByTimeAsync(600); });
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([key])=>key.endsWith(':brief'))).toHaveLength(1);
    await act(async () => { release(); await pending; await vi.advanceTimersByTimeAsync(1000); await flushSourceScope(projectId); });
    expect(forms.get(`${projectId}:brief`)).toEqual(fileBrief); expect(briefState().brief).toMatchObject(fileBrief);
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([key])=>key.endsWith(':brief')).at(-1)?.[1]).toEqual(fileBrief);
  });
  it('stops restore during a delayed original flush after A→B→A and retains the original dirty cache', async () => {
    await mount(); let release!: () => void;
    vi.mocked(storeSourceForm).mockImplementationOnce((key, value) => new Promise(resolve => { release = () => { forms.set(key, value); resolve(); }; }));
    fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: 'A确认前输入' } });
    let pending!: Promise<void>; await act(async () => { pending = actions.restoreBackup(file()); void pending.catch(() => {}); await Promise.resolve(); });
    await waitFor(() => expect(release).toBeTypeOf('function'));
    act(() => { changeLayout({ ...layout, id: 'backup-b' }); }); act(() => { changeLayout(layout); });
    await act(async () => { release(); await expect(pending).rejects.toThrow('已变化'); });
    expect(commit).not.toHaveBeenCalled(); expect(briefState().brief.description).toBe('A确认前输入');
    expect(forms.get(`${projectId}:brief`)).toMatchObject({ description: 'A确认前输入' });
  });
  it.each(['stay','switch'] as const)('at 100ms restore freezes the 250ms timer; %s keeps the final scope consistent',async transition=>{
    await mount();vi.useFakeTimers();let release!:()=>void,held=false;
    const layoutB={...layout,id:'backup-b',name:'B原布局',width:9};const briefB={...oldBrief,description:'B原需求'};forms.set('backup-b:brief',briefB);
    vi.mocked(storeSourceForm).mockImplementation((key,value)=>{
      if(key===`${projectId}:brief`&&!held){held=true;return new Promise(resolve=>{release=()=>{forms.set(key,value);resolve();};});}
      forms.set(key,value);return Promise.resolve();
    });
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'A待保存编辑'}});
    await act(async()=>{await vi.advanceTimersByTimeAsync(100);});
    let pending!:Promise<void>;await act(async()=>{pending=actions.restoreBackup(file());void pending.catch(()=>{});await Promise.resolve();});
    await act(async()=>{await vi.advanceTimersByTimeAsync(150);});
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([key])=>key.endsWith(':brief'))).toHaveLength(1);
    // W2 never starts: restore clears the old timer synchronously before its first await.
    if(transition==='switch')act(()=>{changeLayout(layoutB);});
    await act(async()=>{release();if(transition==='stay')await pending;else await expect(pending).rejects.toThrow('已变化');await vi.advanceTimersByTimeAsync(600);});
    if(transition==='stay'){expect(forms.get(`${projectId}:brief`)).toEqual(fileBrief);expect(briefState().brief).toMatchObject(fileBrief);}
    else{expect(JSON.parse(screen.getByTestId('backup-layout').textContent!)).toEqual(layoutB);expect(forms.get('backup-b:brief')).toEqual(briefB);expect(briefState().brief.description).toBe('B原需求');expect(commit).not.toHaveBeenCalled();}
  });
  it.each(['absent', 'legacy'] as const)('clears existing same-scope brief for %s and undo restores the original', async status => {
    await mount(); await act(async () => { await actions.restoreBackup(file(projectId, status)); });
    expect(forms.has(`${projectId}:brief`)).toBe(false); expect(briefState().hasSavedBrief).toBe(false);
    await act(async () => { await flushSourceScope(projectId); }); expect(forms.has(`${projectId}:brief`)).toBe(false);
    await act(async () => { await actions.undoRestore(); }); expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief);
  });
  it('isolates a different target scope and undo preserves both scopes original needs', async () => {
    const other = { ...oldBrief, description: 'B原需求' }; forms.set('backup-b:brief', other);
    await mount(); await act(async () => { await actions.restoreBackup(file('backup-b')); });
    expect(briefState().brief).toMatchObject(fileBrief); expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief);
    await act(async () => { await actions.undoRestore(); });
    expect(forms.get('backup-b:brief')).toEqual(other); expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief);
    expect(briefState().brief.description).toBe('恢复前需求');
  });
  it('rolls back the target brief when persistent layout commit refuses the candidate', async () => {
    await mount(); commit.mockImplementationOnce(() => { throw new Error('布局保存拒绝'); });
    await act(async () => { await expect(actions.restoreBackup(file())).rejects.toThrow('布局保存拒绝'); });
    expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief); expect(briefState().brief.description).toBe('恢复前需求');
    expect(JSON.parse(screen.getByTestId('backup-layout').textContent!)).toEqual(layout); expect(actions.canUndoRestore).toBe(false);
  });
  it.each(['write', 'readback'] as const)('keeps the original project and rolls back after target %s refusal', async failure => {
    await mount();
    if (failure === 'write') vi.mocked(storeSourceForm).mockRejectedValueOnce(new Error('目标写入拒绝'));
    else {
      let failed = false;
      // The parser clones the file value; compare its contents rather than its identity.
      vi.mocked(readSourceForm).mockImplementation(async key => { const value = forms.get(key); if ((value as typeof fileBrief | undefined)?.description === fileBrief.description && !failed) { failed = true; throw new Error('目标读回拒绝'); } return value; });
    }
    await act(async () => { await expect(actions.restoreBackup(file())).rejects.toThrow('拒绝'); });
    expect(commit).not.toHaveBeenCalled(); expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief); expect(briefState().brief.description).toBe(oldBrief.description);
  });
  it('blocks export after same-scope failed restore rollback and resumes export after retry', async () => {
    await mount(); commit.mockImplementationOnce(() => { throw new Error('布局保存拒绝'); });
    vi.mocked(storeSourceForm).mockImplementation(async (key, value) => { if (value === oldBrief) throw new Error('回滚拒绝'); forms.set(key, value); });
    const candidate = file();
    await act(async () => { await expect(actions.restoreBackup(candidate)).rejects.toThrow('回退也失败'); });
    expect(briefState().brief.description).toBe('恢复前需求'); expect(candidate.brief).toMatchObject({ value: fileBrief });
    expect(forms.get(`${projectId}:brief`)).toEqual(fileBrief);expect(JSON.parse(screen.getByTestId('backup-layout').textContent!)).toEqual(layout);
    let output:string|undefined;
    await act(async()=>{await expect(actions.prepareBackup().then(text=>{output=text;})).rejects.toThrow('回退尚未完成');});expect(output).toBeUndefined();
    vi.mocked(storeSourceForm).mockImplementation(async (key, value) => { forms.set(key, value); });
    await act(async () => { await actions.restoreBackup(candidate); }); expect(briefState().brief).toMatchObject(fileBrief);
    await act(async()=>{output=await actions.prepareBackup();});const restored=parseLocalProjectBackupJson(output!);expect(restored.layout.name).toBe('文件布局');expect(restored.brief).toEqual({status:'present',value:fileBrief});
    await act(async () => { await actions.undoRestore(); }); expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief);
  });
  it('blocks export after same-scope undo compensation fails and resumes it after undo retry',async()=>{
    await mount();await act(async()=>{await actions.restoreBackup(file());});
    commit.mockImplementationOnce(()=>{throw new Error('撤销布局保存拒绝');});
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{if((value as typeof fileBrief)?.description===fileBrief.description)throw new Error('文件需求补偿拒绝');forms.set(key,value);});
    await act(async()=>{await expect(actions.undoRestore()).rejects.toThrow('回退也失败');});
    expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief);expect(briefState().brief).toMatchObject(fileBrief);expect(JSON.parse(screen.getByTestId('backup-layout').textContent!).name).toBe('文件布局');
    let output:string|undefined;
    await act(async()=>{await expect(actions.prepareBackup().then(text=>{output=text;})).rejects.toThrow('回退尚未完成');});expect(output).toBeUndefined();
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{forms.set(key,value);});
    await act(async()=>{await actions.undoRestore();output=await actions.prepareBackup();});
    const restored=parseLocalProjectBackupJson(output!);expect(restored.layout).toEqual(layout);expect(restored.brief).toEqual({status:'present',value:oldBrief});
  });
  it('retains a different target original through failed rollback, retry, and undo', async () => {
    const other = { ...oldBrief, description: 'B原需求' }; forms.set('backup-b:brief', other);
    await mount(); commit.mockImplementationOnce(() => { throw new Error('布局拒绝'); });
    vi.mocked(storeSourceForm).mockImplementation(async (key, value) => { if (value === other) throw new Error('回滚拒绝'); forms.set(key, value); });
    const candidate = file('backup-b');
    await act(async () => { await expect(actions.restoreBackup(candidate)).rejects.toThrow('回退也失败'); });
    expect(briefState().brief.description).toBe(oldBrief.description);
    let output='';await act(async()=>{output=await actions.prepareBackup();});
    const unaffected=parseLocalProjectBackupJson(output);expect(unaffected.layout).toEqual(layout);expect(unaffected.brief).toEqual({status:'present',value:oldBrief});
    vi.mocked(storeSourceForm).mockImplementation(async (key, value) => { forms.set(key, value); });
    await act(async () => { await actions.restoreBackup(candidate); });
    await act(async () => { await actions.undoRestore(); }); expect(forms.get('backup-b:brief')).toEqual(other); expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief);
  });
  it.each(['only-A','A-and-B'] as const)('independently compensates undo keys after B readback fails and retries %s compensation failure',async failures=>{
    const other={...oldBrief,description:'B原需求'};forms.set('backup-b:brief',other);
    await mount();await act(async()=>{await actions.restoreBackup(file('backup-b'));});
    let readFailed=false,compensating=false;
    vi.mocked(readSourceForm).mockImplementation(async key=>{
      const value=forms.get(key);
      if(key==='backup-b:brief'&&value===other&&!readFailed){readFailed=true;compensating=true;throw new Error('B撤销读回失败');}
      return value;
    });
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{
      if(compensating&&(key===`${projectId}:brief`||failures==='A-and-B'&&key==='backup-b:brief'))throw new Error(`${key}补偿保存拒绝`);
      forms.set(key,value);
    });
    await act(async()=>{await expect(actions.undoRestore()).rejects.toThrow('回退也失败');});
    expect(JSON.parse(screen.getByTestId('backup-layout').textContent!).id).toBe('backup-b');expect(briefState().brief).toMatchObject(fileBrief);expect(actions.canUndoRestore).toBe(true);
    // B compensation must be attempted even if A compensation rejects.
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([key])=>key==='backup-b:brief').at(-1)?.[1]).toEqual(fileBrief);
    if(failures==='only-A')expect(forms.get('backup-b:brief')).toEqual(fileBrief);else expect(forms.get('backup-b:brief')).toEqual(other);
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{forms.set(key,value);});
    await act(async()=>{await actions.undoRestore();});
    expect(JSON.parse(screen.getByTestId('backup-layout').textContent!)).toEqual(layout);expect(briefState().brief.description).toBe(oldBrief.description);expect(forms.get('backup-b:brief')).toEqual(other);expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief);
  });
  it('refuses retrying failed undo compensation after a user edit without overwriting the draft',async()=>{
    const other={...oldBrief,description:'B原需求'};forms.set('backup-b:brief',other);
    await mount();await act(async()=>{await actions.restoreBackup(file('backup-b'));});
    let failed=false,compensating=false;
    vi.mocked(readSourceForm).mockImplementation(async key=>{const value=forms.get(key);if(value===other&&!failed){failed=true;compensating=true;throw new Error('B读回失败');}return value;});
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{if(compensating)throw new Error('补偿拒绝');forms.set(key,value);});
    await act(async()=>{await expect(actions.undoRestore()).rejects.toThrow('回退也失败');});
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'失败后新输入'}});
    const calls=vi.mocked(storeSourceForm).mock.calls.length;
    await expect(actions.undoRestore()).rejects.toThrow('新编辑');expect(vi.mocked(storeSourceForm).mock.calls).toHaveLength(calls);expect(briefState().brief.description).toBe('失败后新输入');
  });
  it('keeps an inactive target dirty draft through restore and undo without blocking the current healthy scope',async()=>{
    const layoutB={...layout,id:'backup-b',name:'B原布局'};forms.set('backup-b:brief',{...oldBrief,description:'B已保存需求'});
    await mount();act(()=>{changeLayout(layoutB);});await waitFor(()=>expect(briefState().brief.description).toBe('B已保存需求'));
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{if(key==='backup-b:brief')throw new Error('B保存拒绝');forms.set(key,value);});
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'B未保存的真实草稿'}});
    act(()=>{changeLayout(layout);});await waitFor(()=>expect(briefState().brief.description).toBe(oldBrief.description));
    await act(async()=>{await Promise.resolve();});
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{forms.set(key,value);});
    await act(async()=>{await actions.restoreBackup(file('backup-b'));await actions.undoRestore();});
    act(()=>{changeLayout(layoutB);});
    expect(briefState().brief.description).toBe('B未保存的真实草稿');expect(briefState().hasSavedBrief).toBe(false);
    await act(async()=>{await flushSourceScope('backup-b');});expect(forms.get('backup-b:brief')).toMatchObject({description:'B未保存的真实草稿'});
  });
  it('a cached ready draft cannot write after its pending scope lease is cancelled',async()=>{
    const layoutB={...layout,id:'backup-b',name:'B原布局'};forms.set('backup-b:brief',{...oldBrief,description:'B需求'});
    await mount();
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{if(key===`${projectId}:brief`)throw new Error('A首次保存拒绝');forms.set(key,value);});
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'A仍待保存的草稿'}});
    act(()=>{changeLayout(layoutB);});await waitFor(()=>expect(briefState().brief.description).toBe('B需求'));await act(async()=>{await Promise.resolve();});
    let release!:()=>void,held!:()=>void;
    const started=new Promise<void>(resolve=>{held=resolve;});const wait=new Promise<void>(resolve=>{release=resolve;});
    const lock=navigator.locks.request(`scendance:source-editor:${projectId}`,{mode:'exclusive'},async()=>{held();await wait;});
    await act(async()=>{await started;});
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{forms.set(key,value);});
    const before=vi.mocked(storeSourceForm).mock.calls.filter(([key])=>key===`${projectId}:brief`).length;
    act(()=>{changeLayout(layout);});expect(briefState().brief.description).toBe('A仍待保存的草稿');
    act(()=>{changeLayout(layoutB);});
    await act(async()=>{await Promise.resolve();release();await lock;await Promise.resolve();});
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([key])=>key===`${projectId}:brief`)).toHaveLength(before);expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief);
    act(()=>{changeLayout(layout);});await act(async()=>{await flushSourceScope(projectId);});expect(forms.get(`${projectId}:brief`)).toMatchObject({description:'A仍待保存的草稿'});
  });
  it('aborts a restore if the user types while the target write is pending and preserves that input', async () => {
    await mount(); let release!: () => void;
    vi.mocked(storeSourceForm).mockImplementationOnce((key, value) => new Promise(resolve => { release = () => { forms.set(key, value); resolve(); }; }));
    let pending!: Promise<void>; await act(async () => { pending = actions.restoreBackup(file()); void pending.catch(() => {}); await Promise.resolve(); });
    await waitFor(() => expect(release).toBeTypeOf('function'));
    fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '恢复期间继续输入' } });
    await act(async () => { release(); await expect(pending).rejects.toThrow('已变化'); });
    expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief); expect(briefState().brief.description).toBe('恢复期间继续输入'); expect(commit).not.toHaveBeenCalled();
    await act(async () => { await flushSourceScope(projectId); }); expect(forms.get(`${projectId}:brief`)).toMatchObject({ description: '恢复期间继续输入' });
  });
  it('refuses undo after a new brief edit', async () => {
    await mount(); await act(async () => { await actions.restoreBackup(file()); });
    fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '恢复后的新输入' } });
    expect(actions.canUndoRestore).toBe(false); await expect(actions.undoRestore()).rejects.toThrow('新编辑'); expect(briefState().brief.description).toBe('恢复后的新输入');
  });
  it('refuses undo when the inactive original scope has a newer saved need',async()=>{
    await mount();await act(async()=>{await actions.restoreBackup(file('backup-b'));});
    const newer={...oldBrief,description:'另一页保存的A新需求'};forms.set(`${projectId}:brief`,newer);
    const writes=vi.mocked(storeSourceForm).mock.calls.filter(([key])=>key.endsWith(':brief')).length;
    await act(async()=>{await expect(actions.undoRestore()).rejects.toThrow('原项目的活动需求');});
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([key])=>key.endsWith(':brief'))).toHaveLength(writes);expect(forms.get(`${projectId}:brief`)).toEqual(newer);expect(briefState().brief).toMatchObject(fileBrief);
  });
  it('assigns an ID only once to a no-ID candidate across a failed commit and retry',async()=>{
    await mount();let ids=0;prepare.mockImplementation(next=>({...next,id:next.id??`legacy-target-${++ids}`}));
    const {id:_id,...legacy}=layout;const candidate=parseLocalProjectBackupJson(JSON.stringify({...legacy,name:'旧文件'}));
    commit.mockImplementationOnce(()=>{throw new Error('首次布局拒绝');});
    await act(async()=>{await expect(actions.restoreBackup(candidate)).rejects.toThrow('首次布局拒绝');});
    await act(async()=>{await actions.restoreBackup(candidate);});
    expect(ids).toBe(1);expect(JSON.parse(screen.getByTestId('backup-layout').textContent!).id).toBe('legacy-target-1');expect(candidate.layout.id).toBeUndefined();
  });
  it('refuses an occupied target and unsupported cross-page protection before replacing any data', async () => {
    await mount(); const other = renderUI(<CreativeStudioProvider controller={controller} layout={{ ...layout, id: 'backup-b' }} onApply={onApply}><span>另一编辑器</span></CreativeStudioProvider>);
    await act(async () => { await expect(actions.restoreBackup(file('backup-b'))).rejects.toThrow('另一编辑页面'); }); expect(commit).not.toHaveBeenCalled();
    other.unmount(); Reflect.deleteProperty(navigator, 'locks');
    await act(async () => { await expect(actions.restoreBackup(file())).rejects.toThrow('Web Locks'); }); expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief);
  });
  it('refuses local restore while a real controller project is bound without calling cloud APIs', async () => {
    connected(); await mount();
    await expect(actions.restoreBackup(file())).rejects.toThrow('云项目'); expect(commit).not.toHaveBeenCalled(); expect(controller.applySceneProposal).not.toHaveBeenCalled();
  });
});

describe('original CreativeBrief storage state', () => {
  it('keeps both optional hooks null outside the provider', () => {
    renderUI(<BriefStateProbe/>);
    expect(JSON.parse(screen.getByTestId('brief-state').textContent!)).toEqual({state:null,legacy:null});
  });

  it('does not persist unedited default suggestions', async () => {
    vi.useFakeTimers(); renderUI(briefForm());
    await act(async () => { await Promise.resolve(); await vi.advanceTimersByTimeAsync(300); });
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:false});
    expect(screen.getByText('当前需求尚未保存；默认活动类型和人数仅供参考，请按实际情况填写。')).toBeTruthy();
    await act(async () => { await flushSourceScope(projectId); });
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([key]) => key.endsWith(':brief'))).toHaveLength(0);
  });

  it('keeps a draft through a read failure, blocks flushing, and recovers by retrying the original key', async () => {
    vi.useFakeTimers();
    vi.mocked(readSourceForm).mockImplementation(async key => {
      if (key.endsWith(':brief')) throw new Error('存储暂时不可用');
      return undefined;
    });
    renderUI(briefForm());
    await act(async () => { await Promise.resolve(); });
    expect(briefState()).toMatchObject({ready:false,hasSavedBrief:false});
    expect(screen.getByRole('alert').textContent).toContain('活动需求读取失败');
    enterBrief();
    fireEvent.change(screen.getByRole('spinbutton', {name:'预计人数'}), {target:{value:'30'}});
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await expect(flushSourceScope(projectId)).rejects.toThrow('活动需求读取失败');
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([key]) => key.endsWith(':brief'))).toHaveLength(0);
    vi.mocked(readSourceForm).mockImplementation(async key => key.endsWith(':brief') ? {event:'工作坊',guests:12,description:'原需求',mustHave:'',allowIdeas:false} : undefined);
    fireEvent.click(screen.getByRole('button', {name:'重试读取需求'}));
    await act(async () => { await Promise.resolve(); });
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:false,brief:{guests:30,description:'给 24 位来宾布置一个交流会，保留中心通道。'}});
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(storeSourceForm).toHaveBeenCalledWith(`${projectId}:brief`, expect.objectContaining({guests:30,description:'给 24 位来宾布置一个交流会，保留中心通道。'}));
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:true});
  });

  it('preserves input entered while the original brief is still loading', async () => {
    vi.useFakeTimers();
    let finish!:(saved:unknown)=>void;
    vi.mocked(readSourceForm).mockImplementation(key => key.endsWith(':brief') ? new Promise(resolve=>{finish=resolve;}) : Promise.resolve(undefined));
    renderUI(briefForm()); enterBrief();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([key]) => key.endsWith(':brief'))).toHaveLength(0);
    await act(async () => { finish({event:'工作坊',guests:30,description:'存储中的旧需求',mustHave:'',allowIdeas:false}); });
    expect(briefState().brief.description).toBe('给 24 位来宾布置一个交流会，保留中心通道。');
    expect(briefState().brief.guests).toBe(30);
    await act(async () => { await flushSourceScope(projectId); });
    expect(storeSourceForm).toHaveBeenCalledWith(`${projectId}:brief`, expect.objectContaining({guests:30,description:'给 24 位来宾布置一个交流会，保留中心通道。'}));
  });

  it('shows write failure, retains the draft, and reopens a successfully retried brief from its scope', async () => {
    vi.useFakeTimers();
    const forms = new Map<string, unknown>();
    vi.mocked(readSourceForm).mockImplementation(async key => forms.get(key));
    vi.mocked(storeSourceForm).mockImplementation(async (key,value) => {
      if(key.endsWith(':brief')) throw new Error('本机空间不足');
      forms.set(key,value);
    });
    const view=renderUI(briefForm());
    await act(async () => { await Promise.resolve(); });
    enterBrief();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.getByRole('alert').textContent).toContain('活动需求保存失败');
    expect(briefState()).toMatchObject({ready:true,hasSavedBrief:false,brief:{description:'给 24 位来宾布置一个交流会，保留中心通道。'}});
    await expect(flushSourceScope(projectId)).rejects.toThrow('活动需求保存失败');
    vi.mocked(storeSourceForm).mockImplementation(async (key,value) => { forms.set(key,value); });
    fireEvent.click(screen.getByRole('button', {name:'重试保存需求'}));
    await act(async () => { await Promise.resolve(); });
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:true});
    view.unmount(); renderUI(briefForm());
    await act(async () => { await Promise.resolve(); });
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:true,brief:{description:'给 24 位来宾布置一个交流会，保留中心通道。'}});
  });

  it('isolates scope changes and ignores a delayed brief from the prior scope', async () => {
    vi.useFakeTimers();
    let finish!:(saved:unknown)=>void;
    const nextId='10000000-0000-4000-8000-000000000002';
    vi.mocked(readSourceForm).mockImplementation(key => key===`${projectId}:brief` ? new Promise(resolve=>{finish=resolve;}) : Promise.resolve(key===`${nextId}:brief` ? {event:'工作坊',guests:30,description:'另一个活动',mustHave:'',allowIdeas:false} : undefined));
    const view=renderUI(briefForm());await act(async()=>{await Promise.resolve();});enterBrief();
    view.rerender(briefForm({...layout,id:nextId}));
    await act(async () => { await Promise.resolve(); });
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:true,brief:{guests:30,description:'另一个活动'}});
    await act(async () => { finish({event:'品牌快闪',guests:24,description:'迟到的旧活动',mustHave:'',allowIdeas:true}); await vi.advanceTimersByTimeAsync(300); });
    expect(briefState().brief.description).toBe('另一个活动');
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([key]) => key.endsWith(':brief'))).toHaveLength(0);
    enterBrief(); await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(storeSourceForm).toHaveBeenCalledWith(`${nextId}:brief`,expect.objectContaining({description:'给 24 位来宾布置一个交流会，保留中心通道。'}));
    expect(vi.mocked(storeSourceForm).mock.calls.some(([key]) => key===`${projectId}:brief`)).toBe(false);
  });

  it('saves the original brief key when switching before the debounce and restores it on immediate return', async () => {
    vi.useFakeTimers();
    const nextId='10000000-0000-4000-8000-000000000002';
    const forms=new Map<string,unknown>([[`${projectId}:brief`,{event:'工作坊',guests:30,description:'A旧需求',mustHave:'',allowIdeas:false}]]);
    vi.mocked(readSourceForm).mockImplementation(async key=>forms.get(key));
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{forms.set(key,value);});
    const view=renderUI(briefForm());
    await act(async()=>{await Promise.resolve();});
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'A最新需求'}});
    view.rerender(briefForm({...layout,id:nextId}));
    view.rerender(briefForm());
    await act(async()=>{await Promise.resolve();await vi.advanceTimersByTimeAsync(320);});
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:true,brief:{guests:30,description:'A最新需求'}});
    expect(forms.get(`${projectId}:brief`)).toMatchObject({description:'A最新需求',guests:30});
    expect(storeSourceForm).toHaveBeenCalledWith(`${projectId}:brief`,expect.objectContaining({description:'A最新需求'}));
    expect(vi.mocked(storeSourceForm).mock.calls.some(([key])=>key===`${nextId}:brief`)).toBe(false);
  });

  it('retains an old-scope save failure in its draft cache without changing the new scope state', async () => {
    vi.useFakeTimers();
    const nextId='10000000-0000-4000-8000-000000000002';
    const forms=new Map<string,unknown>([
      [`${projectId}:brief`,{event:'工作坊',guests:30,description:'A旧需求',mustHave:'',allowIdeas:false}],
      [`${nextId}:brief`,{event:'展览市集',guests:12,description:'B已保存需求',mustHave:'',allowIdeas:false}],
    ]);
    vi.mocked(readSourceForm).mockImplementation(async key=>forms.get(key));
    let fail!:(reason:Error)=>void;
    vi.mocked(storeSourceForm).mockImplementation((key)=>key===`${projectId}:brief`?new Promise((_resolve,reject)=>{fail=reject;}):Promise.resolve());
    const view=renderUI(briefForm());
    await act(async()=>{await Promise.resolve();});
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'A未保存新需求'}});
    view.rerender(briefForm({...layout,id:nextId}));
    await act(async()=>{await Promise.resolve();});
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:true,brief:{description:'B已保存需求'}});
    await act(async()=>{fail(new Error('A保存失败'));});
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:true,brief:{description:'B已保存需求'}});
    expect(screen.queryByRole('alert')).toBeNull();
    view.rerender(briefForm());
    expect(briefState()).toMatchObject({ready:true,hasSavedBrief:false,brief:{guests:30,description:'A未保存新需求'}});
    expect(screen.getByRole('alert').textContent).toContain('A保存失败');
    expect(forms.get(`${projectId}:brief`)).toMatchObject({description:'A旧需求'});
    expect(vi.mocked(readSourceForm).mock.calls.filter(([key])=>key===`${projectId}:brief`)).toHaveLength(1);
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{forms.set(key,value);});
    fireEvent.click(screen.getByRole('button',{name:'重试保存需求'}));
    await act(async()=>{await Promise.resolve();});
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:true,brief:{description:'A未保存新需求'}});
    expect(forms.get(`${projectId}:brief`)).toMatchObject({description:'A未保存新需求'});
  });

  it('restores a draft on A to B to A while the original-key save is still pending', async () => {
    vi.useFakeTimers();
    const nextId='10000000-0000-4000-8000-000000000002';
    vi.mocked(readSourceForm).mockImplementation(async key=>key===`${projectId}:brief`?{event:'工作坊',guests:30,description:'A旧需求',mustHave:'',allowIdeas:false}:undefined);
    let finish!:()=>void;
    vi.mocked(storeSourceForm).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const view=renderUI(briefForm());
    await act(async()=>{await Promise.resolve();});
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'A等待保存的新需求'}});
    view.rerender(briefForm({...layout,id:nextId}));
    await act(async()=>{await Promise.resolve();});
    view.rerender(briefForm());
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:false,brief:{guests:30,description:'A等待保存的新需求'}});
    await act(async()=>{finish();});
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:true,brief:{description:'A等待保存的新需求'}});
    expect(storeSourceForm).toHaveBeenCalledWith(`${projectId}:brief`,expect.objectContaining({description:'A等待保存的新需求'}));
  });

  it('blocks automatic cloud preparation after a brief read failure', async () => {
    snapshot={...snapshot,configured:true};
    vi.mocked(readSourceForm).mockImplementation(async key => { if(key.endsWith(':brief'))throw new Error('读取失败');return undefined; });
    const ready=vi.spyOn(controller,'ensureWorkbenchReady');
    const local={...layout}; delete local.id;
    render(ui(local));
    await screen.findByRole('button',{name:'重试读取需求'});
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'增加一张桌子'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await waitFor(()=>expect(screen.getAllByText(/活动需求读取失败/).length).toBeGreaterThan(0));
    expect(ready).not.toHaveBeenCalled(); expect(controller.startAgentRun).not.toHaveBeenCalled();
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([key])=>key.endsWith(':brief'))).toHaveLength(0);
  });

  it('keeps the original local scope and input when migration to a prepared cloud project fails', async () => {
    snapshot={...snapshot,configured:true};
    const local={...layout,id:'10000000-0000-4000-8000-000000000009'};
    const bind=vi.fn();
    const ready=vi.spyOn(controller,'ensureWorkbenchReady').mockImplementation(async()=>{connected();return snapshot.project!;});
    const release=vi.spyOn(controller,'releaseLease').mockResolvedValue(undefined);
    vi.mocked(copySourceScope).mockRejectedValueOnce(new Error('本机资料复制失败'));
    render(<CreativeStudioProvider controller={controller} layout={local} onApply={onApply} onBindProject={bind}><CreativeAssistant/><BriefStateProbe/></CreativeStudioProvider>);
    enterBrief();
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'增加一张桌子'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await screen.findByText('云项目已准备好，但活动需求和场地资料未能迁移。原本地草稿与当前输入已保留，请重试后再发送。',{selector:'.cr-agent-notice'});
    expect(ready).toHaveBeenCalledOnce(); expect(copySourceScope).toHaveBeenCalledWith(local.id,projectId);
    expect(release).toHaveBeenCalledOnce(); expect(bind).not.toHaveBeenCalled();
    expect(controller.startAgentRun).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
    expect(briefState().brief.description).toBe('给 24 位来宾布置一个交流会，保留中心通道。');
    expect(storeSourceForm).toHaveBeenCalledWith(`${local.id}:brief`,expect.objectContaining({description:'给 24 位来宾布置一个交流会，保留中心通道。'}));
    expect(local.id).toBe('10000000-0000-4000-8000-000000000009');
    expect(controller.getSnapshot().project?.id).toBe(projectId);
  });
});


describe('context continuity and project isolation', () => {
  it('carries confirmed venue and design requirements into successive assistant requests', async () => {
    connected(); render(ui()); enterBrief();
    fireEvent.change(screen.getByRole('textbox',{name:'已确认的现场条件'}),{target:{value:'北侧入口不得遮挡'}});
    fireEvent.change(screen.getByRole('textbox',{name:'风格要求'}),{target:{value:'简约现代'}});
    fireEvent.change(screen.getByRole('textbox',{name:'配色要求'}),{target:{value:'米白橄榄绿'}});
    fireEvent.change(screen.getByRole('textbox',{name:'氛围要求'}),{target:{value:'温暖聚会'}});
    const send=async(text:string)=>{
      fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:text}});
      fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
      await waitFor(()=>expect(screen.getByRole('button',{name:'确认应用'})).toBeTruthy());
    };
    await send('把交流区靠近入口');
    fireEvent.click(screen.getByRole('button',{name:'放弃'}));
    await send('再留宽一点');
    const prompt=JSON.stringify(vi.mocked(prepareProposal).mock.calls[1]![0]);
    for(const text of ['北侧入口不得遮挡','简约现代','米白橄榄绿','温暖聚会','把交流区靠近入口','再留宽一点',proposal.explanation]) expect(prompt).toContain(text);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('clears old brief and conversation on project switch and ignores an old in-flight response', async () => {
    connected(); const rendered=render(ui()); enterBrief();
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'旧项目策划草稿'}});
    selectMode('model');fireEvent.click(screen.getByRole('button',{name:'椅'}));selectMode('plan');
    let finish!:(value:SceneProposal)=>void;
    vi.mocked(prepareProposal).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    fireEvent.click(screen.getByRole('button',{name:'生成布置预览'}));
    await waitFor(()=>expect(prepareProposal).toHaveBeenCalledOnce());
    const changed={...layout,id:'10000000-0000-4000-8000-000000000002'};
    rendered.rerender(ui(changed));
    expect((screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('');
    selectMode('model');expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('');
    await act(async()=>{finish(proposal);});
    expect(screen.queryByText('方案提案 · 尚未应用')).toBeNull();
    expect(screen.queryByText(proposal.explanation)).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });
});


describe('review workspace integration',()=>{
  beforeEach(()=>{vi.stubGlobal('innerWidth',1440);});
  it('prepares the real brief without re-flushing unrelated image forms, then expires on a layout edit',async()=>{
    let saved:unknown;
    vi.mocked(readSourceForm).mockImplementation(async key=>key===`${projectId}:brief`?saved:undefined);
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{if(key===`${projectId}:brief`)saved=value;});
    const sources=await import('@/lib/source-storage');const unrelated=vi.fn(async()=>{throw new Error('Unrelated image reload');});
    const unregister=sources.registerSourceFlush(projectId,unrelated);
    try{
      const view=renderUI(<DockedTrial/>);await act(async()=>{});
      fireEvent.click(screen.getByRole('button',{name:'活动需求'}));
      fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'评审专用活动需求：保留入口'}});
      fireEvent.click(screen.getByRole('button',{name:'方案评审'}));
      fireEvent.click(screen.getByRole('checkbox',{name:'包含当前活动需求'}));
      await waitFor(()=>expect((screen.getByRole('button',{name:'生成评审包'}) as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(screen.getByRole('button',{name:'生成评审包'}));
      const preview=await screen.findByTitle('客户评审预览');
      expect(preview.getAttribute('srcdoc')).toContain('评审专用活动需求：保留入口');
      expect(unrelated).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
      expect(controller.startAgentRun).not.toHaveBeenCalled();
      view.rerender(<DockedTrial current={{...layout,width:layout.width+1}}/>);
      await waitFor(()=>expect(screen.queryByRole('button',{name:'下载评审文件（HTML）'})).toBeNull());
      expect(screen.getByText('评审内容已过期，请重新生成。')).toBeTruthy();
    }finally{unregister();}
  });
  it('keeps the existing model draft while entering and leaving review',async()=>{
    renderUI(<DockedTrial/>);await act(async()=>{});selectMode('model');
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'一把椅子的未发送需求'}});
    fireEvent.click(screen.getByRole('button',{name:'方案评审'}));
    expect(screen.getByRole('region',{name:'客户评审包'})).toBeTruthy();
    expect((screen.getByRole('combobox',{name:'工作模式'}) as HTMLSelectElement).value).toBe('model');
    fireEvent.click(screen.getByRole('button',{name:'返回素材'}));
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('一把椅子的未发送需求');
  });
});

describe('unified Agent', () => {
  it('offers two chat scopes and retains separate planning and modeling drafts', () => {
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button', { name: '打开 Binggo Agent' }));
    const modes=screen.getByRole('combobox',{name:'工作模式'}) as HTMLSelectElement;
    expect(Array.from(modes.options).map(option=>option.text)).toEqual(['场景策划','物料建模']);
    fireEvent.change(screen.getByRole('textbox', { name: '告诉助手你的想法' }), { target: { value: '增加两把椅子' } });
    selectMode('model');
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('');
    fireEvent.click(screen.getByRole('button',{name:'椅'}));
    expect(modes.value).toBe('model');
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toContain('座面宽 0.5 米');
    selectMode('plan');
    expect((screen.getByRole('textbox', { name: '告诉助手你的想法' }) as HTMLTextAreaElement).value).toBe('增加两把椅子');
    selectMode('model');
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toContain('座面宽 0.5 米');
    expect(prepareProposal).not.toHaveBeenCalled();
  });

  it('expands and restores the same form without losing demand, draft, focus, or either scroll position', async () => {
    const view=renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    await act(async()=>{});
    const panel=screen.getByRole('region',{name:'Agent'});
    const demand=screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement;
    const input=screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement;
    fireEvent.change(demand,{target:{value:'为客户保留入口与交流区'}});
    fireEvent.change(input,{target:{value:'这条调整还没发送'}});
    const content=view.container.querySelector<HTMLElement>('.cr-workspace-content')!;
    const feed=view.container.querySelector<HTMLElement>('.cr-chat-feed')!;
    content.scrollTop=152;feed.scrollTop=64;
    demand.focus();vi.mocked(feed.scrollTo).mockClear();
    expect(view.container.querySelector<HTMLDetailsElement>('.cr-agent-settings')!.open).toBe(false);
    expect(view.container.querySelector<HTMLDetailsElement>('.cr-venue-details')!.open).toBe(false);
    expect(view.container.querySelector<HTMLDetailsElement>('.rc-inputs')!.open).toBe(false);
    fireEvent.click(screen.getByRole('button',{name:'展开工作区'}));
    expect(panel.classList.contains('is-expanded')).toBe(true);
    expect((screen.getByRole('combobox',{name:'工作模式'}) as HTMLSelectElement).form).toBe(input.form);
    content.scrollTop=21;feed.scrollTop=3; // A taller viewport can clamp either browser scroll position.
    fireEvent.click(screen.getByRole('button',{name:'恢复浮窗'}));
    expect(panel.classList.contains('is-expanded')).toBe(false);
    expect(screen.getByRole('region',{name:'Agent'})).toBe(panel);
    expect(screen.getByRole('textbox',{name:'客户需求'})).toBe(demand);
    expect(screen.getByRole('textbox',{name:'告诉助手你的想法'})).toBe(input);
    expect(demand.value).toBe('为客户保留入口与交流区');expect(input.value).toBe('这条调整还没发送');
    expect(document.activeElement).toBe(demand);expect(content.scrollTop).toBe(152);expect(feed.scrollTop).toBe(64);expect(feed.scrollTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'展开工作区'}));
    expect(content.scrollTop).toBe(21);expect(feed.scrollTop).toBe(3);
    expect(controller.startAgentRun).not.toHaveBeenCalled();
  });

  it('scrolls new chat messages independently of the current activity form', async () => {
    connected();vi.mocked(controller.startAgentRun).mockResolvedValueOnce(runFrom(proposal));
    const view=renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    fireEvent.click(screen.getByRole('button',{name:'展开工作区'}));
    const content=view.container.querySelector<HTMLElement>('.cr-workspace-content')!;
    const feed=view.container.querySelector<HTMLElement>('.cr-chat-feed')!;
    const conversation=view.container.querySelector<HTMLElement>('#creative-conversation')!;
    const demand=screen.getByRole('textbox',{name:'客户需求'});
    expect(content.contains(demand)).toBe(true);expect(feed.contains(demand)).toBe(false);
    expect(conversation.contains(feed)).toBe(true);expect(content.contains(conversation)).toBe(false);
    expect(conversation.contains(screen.getByRole('textbox',{name:'告诉助手你的想法'}))).toBe(true);
    content.scrollTop=219;vi.mocked(feed.scrollTo).mockClear();
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'请给我一个候选布局'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));await screen.findByText('方案提案 · 尚未应用');
    expect(feed.contains(screen.getByText('方案提案 · 尚未应用'))).toBe(true);
    expect(content.scrollTop).toBe(219);expect(feed.scrollTo).toHaveBeenCalled();
    expect(controller.startAgentRun).toHaveBeenCalledOnce();expect(onApply).not.toHaveBeenCalled();
  });

  it('opens collapsed chat and focuses its existing modeling draft from a material shortcut', () => {
    const view=renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'原策划草稿'}});
    selectMode('model');fireEvent.click(screen.getByRole('button',{name:'展开工作区'}));
    const input=screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button',{name:'收起聊天'}));
    expect(screen.queryByRole('textbox',{name:'告诉助手你的想法'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'椅'}));
    expect(screen.getByRole('textbox',{name:'告诉助手你的想法'})).toBe(input);
    expect(document.activeElement).toBe(input);expect(input.value).toContain('座面宽 0.5 米');
    expect(screen.getByRole('button',{name:'收起聊天'}).getAttribute('aria-expanded')).toBe('true');
    expect(view.container.querySelectorAll('#creative-message')).toHaveLength(1);
    selectMode('plan');expect(input.value).toBe('原策划草稿');
    expect(controller.startAgentRun).not.toHaveBeenCalled();
  });

  it('keeps an unapplied proposal discoverable across activity delivery, templates, and collapsed chat', async () => {
    connected();vi.mocked(controller.startAgentRun).mockResolvedValueOnce(runFrom(proposal));
    renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'请先给出布置预览'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));await screen.findByText('方案提案 · 尚未应用');
    const confirm=screen.getByRole('button',{name:'确认应用'});
    fireEvent.click(screen.getByRole('button',{name:'展开工作区'}));
    fireEvent.click(screen.getByRole('button',{name:'收起聊天'}));openExecution();
    fireEvent.click(screen.getByRole('button',{name:'场景模板'}));
    const reopen=screen.getByRole('button',{name:'展开聊天'});
    expect(reopen.getAttribute('aria-describedby')).toBe('creative-conversation-status');
    expect(document.getElementById('creative-conversation-status')?.textContent).toContain('有方案待确认');
    expect(screen.queryByRole('button',{name:'确认应用'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'收起 Agent'}));
    fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    expect(document.activeElement).toBe(reopen);
    const previewCalls=onPreview.mock.calls.length;fireEvent.click(reopen);
    expect(screen.getByRole('button',{name:'确认应用'})).toBe(confirm);
    expect(screen.getByText('方案提案 · 尚未应用')).toBeTruthy();
    expect(screen.getByRole('textbox',{name:'告诉助手你的想法'})).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('region',{name:'Binggo 聊天'}));
    expect(onPreview.mock.calls).toHaveLength(previewCalls);
    expect(controller.startAgentRun).toHaveBeenCalledOnce();expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(confirm);await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
  });

  it('keeps a modeling request local to materials and requires confirmation even for a server direct response', async () => {
    connected();vi.mocked(controller.startAgentRun).mockResolvedValueOnce({...runFrom(proposal),executionMode:'direct'});
    renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));enterBrief();
    fireEvent.change(screen.getByLabelText(/一定要有/),{target:{value:'保留无障碍通道'}});
    selectMode('model');fireEvent.click(screen.getByRole('button',{name:'椅'}));
    const input=screen.getByRole('textbox',{name:'告诉助手你的想法'});
    expect(document.activeElement).toBe(input);
    fireEvent.change(input,{target:{value:'创建一把宽 0.5 米的椅子'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await screen.findByText('方案提案 · 尚未应用');
    const request=vi.mocked(controller.startAgentRun).mock.calls[0]![0];
    expect(request).toMatchObject({executionMode:'preview',scene:layoutToBackendScene(layout),selectedIds:[]});
    expect(request.instruction).toContain('仅创建或调整本次请求指定的物料');
    expect(request.context.brief).toContain('给 24 位来宾');expect(request.context.brief).toContain('保留无障碍通道');
    expect(request.context.brief).not.toContain('请为客户设计一套完整的');expect(request.context.brief).not.toContain('主动布置适合主题的亮点');
    expect((screen.getByRole('combobox',{name:'工作模式'}) as HTMLSelectElement).value).toBe('model');
    expect(onApply).not.toHaveBeenCalled();expect(controller.applySceneProposal).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button',{name:'确认应用'})).toHaveLength(1);
    fireEvent.click(screen.getByRole('button',{name:'展开工作区'}));
    const previewCalls=onPreview.mock.calls.length;
    fireEvent.click(screen.getByRole('button',{name:'回到画布预览'}));
    expect(screen.getByRole('region',{name:'Agent'}).classList.contains('is-expanded')).toBe(false);
    expect(screen.getByText('方案提案 · 尚未应用')).toBeTruthy();expect(onPreview.mock.calls).toHaveLength(previewCalls);
    expect(onApply).not.toHaveBeenCalled();expect(controller.startAgentRun).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button',{name:'确认应用'}));await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByLabelText('助手设置'));
    expect((screen.getByRole('checkbox',{name:'明确指令直接应用'}) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('checkbox',{name:'明确指令直接应用'}).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('仅用于场景策划；物料建模始终先预览')).toBeTruthy();
  });

  it('applies a validated text request directly through the cloud apply endpoint', async () => {
    connected();
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button', { name: '打开 Binggo Agent' }));
    fireEvent.change(screen.getByRole('textbox', { name: '告诉助手你的想法' }), { target: { value: '增加一把椅子' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    expect(prepareProposal).toHaveBeenCalledWith(expect.objectContaining({executionMode:'direct',jevEnabled:false}));
    expect(vi.mocked(prepareProposal).mock.calls[0]![0].context.brief).not.toContain('预计24人');
    expect(controller.applySceneProposal).toHaveBeenCalledWith(proposal, layoutToBackendScene(layout));
    expect(layoutToBackendScene(onApply.mock.calls[0][0])).toEqual(candidate);
    expect(onApply.mock.calls[0][0].designBook?.variants.map(variant=>variant.name)).toEqual(['原始方案','AI 方案 A']);
  });

  it('sends structured scenes to DeepSeek as material modifications without dropping structure', async () => {
    connected();
    const structured = createMeasuredRoomLayout(layout, { width: 12, depth: 10, height: 3 });
    const baseScene=layoutToBackendScene(structured);
    const structuredCandidate={...baseScene,objects:candidate.objects};
    vi.mocked(prepareProposal).mockResolvedValueOnce({...proposal,base_scene:baseScene,candidate:structuredCandidate});
    vi.mocked(controller.applySceneProposal).mockResolvedValueOnce({id:projectId,revision:2,scene:structuredCandidate,previousScene:baseScene,updatedAt:'2026-10-03T10:00:00Z',undoGroup:'undo-test',acceptedLocally:true});
    renderUI(<CreativeStudioProvider controller={controller} layout={structured} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button', { name: '打开 Binggo Agent' }));
    fireEvent.change(screen.getByRole('textbox', { name: '告诉助手你的想法' }), { target: { value: '增加一把椅子' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(prepareProposal).toHaveBeenCalledOnce());
    expect(prepareProposal).toHaveBeenCalledWith(expect.objectContaining({ scene: baseScene }));
    await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
    expect(layoutToBackendScene(onApply.mock.calls[0][0])).toEqual(structuredCandidate);
  });


  it('keeps generation content mounted across modes, sizes, and closing the Agent', () => {
    const mounted=vi.fn(), submitted=vi.fn();
    function Generator() {
      const [text,setText]=useState('');
      useEffect(()=>{mounted();},[]);
      return <><input aria-label="测试物料描述" value={text} onChange={event=>setText(event.target.value)}/><button onClick={submitted}>测试提交</button></>;
    }
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><CreativeAssistant generationPanel={<Generator/>}/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    selectMode('model');
    fireEvent.change(screen.getByRole('textbox',{name:'测试物料描述'}),{target:{value:'绿色休闲椅'}});
    const input=screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement;
    fireEvent.change(input,{target:{value:'尚未发送的建模草稿'}});
    fireEvent.click(screen.getByRole('button',{name:'展开工作区'}));
    input.focus();fireEvent.click(screen.getByRole('button',{name:'收起聊天'}));
    const collapsed=screen.getByRole('button',{name:'展开聊天'});
    expect(collapsed.getAttribute('aria-controls')).toBe('creative-conversation');
    expect(collapsed.getAttribute('aria-expanded')).toBe('false');expect(document.activeElement).toBe(collapsed);
    expect(screen.queryByRole('textbox',{name:'告诉助手你的想法'})).toBeNull();
    expect(screen.getByRole('textbox',{name:'测试物料描述'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'材质调整'}));
    fireEvent.click(screen.getByRole('button',{name:'收起 Agent'}));
    fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    expect(document.activeElement).toBe(screen.getByRole('button',{name:'展开聊天'}));
    expect(screen.queryByRole('textbox',{name:'告诉助手你的想法'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'物料建模'}));
    fireEvent.click(screen.getByRole('button',{name:'恢复浮窗'}));
    expect(screen.getByRole('textbox',{name:'告诉助手你的想法'})).toBe(input);
    expect(screen.queryByRole('button',{name:'展开聊天'})).toBeNull();
    expect(input.value).toBe('尚未发送的建模草稿');
    fireEvent.click(screen.getByRole('button',{name:'展开工作区'}));
    fireEvent.click(screen.getByRole('button',{name:'展开聊天'}));
    expect(screen.getByRole('textbox',{name:'告诉助手你的想法'})).toBe(input);
    expect(input.value).toBe('尚未发送的建模草稿');expect(document.activeElement).toBe(input);
    selectMode('plan');
    fireEvent.click(screen.getByRole('button',{name:'收起 Agent'}));
    fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    selectMode('model');
    fireEvent.click(screen.getByRole('button',{name:'恢复浮窗'}));
    expect((screen.getByRole('textbox',{name:'测试物料描述'}) as HTMLInputElement).value).toBe('绿色休闲椅');
    expect(document.querySelectorAll('#creative-message')).toHaveLength(1);
    expect(mounted).toHaveBeenCalledOnce();
    expect(submitted).not.toHaveBeenCalled();
  });

  it('keeps the existing design limit before directly applying a proposal', async () => {
    connected();
    const full={...layout,designBook:{activeId:'design-0',variants:Array.from({length:20},(_,index)=>({id:`design-${index}`,name:`方案 ${index}`,layout}))}};
    renderUI(<CreativeStudioProvider controller={controller} layout={full} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'增加一把椅子'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('请先在图层面板移除'));
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('shows layout warnings after a direct application', async () => {
    connected();
    vi.mocked(prepareProposal).mockResolvedValueOnce({...proposal,warnings:[{code:'OVERLAP',ids:[candidate.objects[0].id]}]});
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'增加一把椅子'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
    expect(screen.getByRole('status').textContent).toContain('物件重叠：椅子');
  });

  it('does not apply a direct response after a scene edit while generation is pending', async () => {
    connected();
    let finish!:(value:SceneProposal)=>void;
    vi.mocked(prepareProposal).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const view=renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'增加一把椅子'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await waitFor(()=>expect(finish).toBeTypeOf('function'));
    view.rerender(<CreativeStudioProvider controller={controller} layout={{...layout,width:13}} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    await act(async()=>{finish(proposal);});
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('生成期间方案或需求已变化');
  });
});

describe('bounded Agent runs and JEV decisions',()=>{
  const send=()=>{fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'直接把交流区布置好'}});fireEvent.click(screen.getByRole('button',{name:'发送消息'}));};
  function comparison():AgentRun {
    const alternatives=(['A','B','C'] as const).map((label,index)=>({label,title:`布局${index+1}`,proposal:{...proposal,id:`30000000-0000-4000-8000-00000000000${index+1}`,candidate:{...candidate,objects:[{...candidate.objects[0]!,position:{x:3+index,z:4}}]}}}));
    return {...runFrom(proposal),jevEnabled:true,executionMode:'direct',candidates:alternatives,evaluation:{status:'complete',choice:'B',probabilities:{A:.2,B:.5,C:.2,NONE:.1},confidence:.33,message:'方案 B 更符合动线要求。'}};
  }
  it('keeps JEV off by default and presents three independently selectable candidates without applying',async()=>{
    connected();renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
    fireEvent.click(screen.getByLabelText('助手设置'));
    const toggle=screen.getByRole('checkbox',{name:'JEV 决策模式'}) as HTMLInputElement;
    expect(toggle.checked).toBe(false);fireEvent.click(toggle);
    vi.mocked(controller.startAgentRun).mockResolvedValueOnce(comparison());send();
    const second=await screen.findByRole('button',{name:/方案 B.*布局2.*50\.0/});
    expect(second.getAttribute('aria-pressed')).toBe('true');
    expect(onApply).not.toHaveBeenCalled();expect(controller.applySceneProposal).not.toHaveBeenCalled();
    expect(controller.startAgentRun).toHaveBeenCalledWith(expect.objectContaining({jevEnabled:true,scene:layoutToBackendScene(layout)}));
    fireEvent.click(screen.getByRole('button',{name:'展开工作区'}));
    fireEvent.click(screen.getByRole('button',{name:'收起聊天'}));openExecution();
    expect(document.getElementById('creative-conversation-status')?.textContent).toContain('有方案待确认');
    fireEvent.click(screen.getByRole('button',{name:'场景模板'}));
    expect(screen.queryByRole('button',{name:/方案 B.*布局2.*50\.0/})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'展开聊天'}));
    expect(screen.getByRole('button',{name:/方案 B.*布局2.*50\.0/})).toBe(second);
    expect(screen.getAllByRole('button',{name:/方案 [ABC] ·/})).toHaveLength(3);
    expect(controller.startAgentRun).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button',{name:/方案 C.*布局3.*20\.0/}));
    expect(screen.getByRole('button',{name:/方案 C.*布局3.*20\.0/}).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button',{name:'确认应用'}));
    await waitFor(()=>expect(controller.applySceneProposal).toHaveBeenCalledWith(comparison().candidates[2]!.proposal,layoutToBackendScene(layout)));
  });
  it('invalidates every candidate after any local edit',async()=>{
    connected();vi.mocked(controller.startAgentRun).mockResolvedValueOnce(comparison());const view=render(ui());send();
    await screen.findByRole('button',{name:/方案 A ·/});
    view.rerender(ui({...layout,width:14}));
    expect(screen.getAllByRole('button',{name:/方案 [ABC] ·/}).every(button=>button.hasAttribute('disabled'))).toBe(true);
    expect(screen.queryByRole('button',{name:'确认应用'})).toBeNull();
    expect(onPreview.mock.calls.at(-1)?.[0]).toBeNull();expect(onApply).not.toHaveBeenCalled();
  });
  it('retains partial candidates when evaluation is unavailable without inventing probabilities',async()=>{
    connected();const run=comparison();vi.mocked(controller.startAgentRun).mockResolvedValueOnce({...run,candidates:run.candidates.slice(0,2),evaluation:{status:'partial',message:'只有两个有效方案，未执行三选评价。'}});render(ui());send();
    await screen.findByText('只有两个有效方案，未执行三选评价。');
    expect(screen.getAllByRole('button',{name:/方案 [AB] ·/})).toHaveLength(2);
    expect(screen.queryByText(/模型推荐概率/)).toBeNull();expect(onApply).not.toHaveBeenCalled();
  });
  it('recovers an uncertain dispatch by the original request ID without posting again',async()=>{
    connected();vi.mocked(controller.startAgentRun).mockRejectedValueOnce(new TypeError('network unknown'));render(ui());send();
    const recover=await screen.findByRole('button',{name:'查询原任务'});
    const original=vi.mocked(controller.startAgentRun).mock.calls[0]![0];
    fireEvent.click(screen.getByRole('button',{name:'展开工作区'}));
    fireEvent.click(screen.getByRole('button',{name:'收起聊天'}));openExecution();
    fireEvent.click(screen.getByRole('button',{name:'场景模板'}));
    const reopen=screen.getByRole('button',{name:'展开聊天'});
    expect(reopen.getAttribute('aria-describedby')).toBe('creative-conversation-status');
    expect(document.getElementById('creative-conversation-status')?.textContent).toContain('原任务结果待核对');
    expect(screen.queryByRole('button',{name:'查询原任务'})).toBeNull();
    expect(controller.getAgentRunByRequest).not.toHaveBeenCalled();
    fireEvent.click(reopen);expect(screen.getByRole('button',{name:'查询原任务'})).toBe(recover);
    vi.mocked(controller.getAgentRunByRequest).mockResolvedValueOnce({...runFrom(proposal),requestId:original.requestId});
    fireEvent.click(recover);await screen.findByText('方案提案 · 尚未应用');
    expect(controller.getAgentRunByRequest).toHaveBeenCalledWith(original.requestId);
    expect(controller.startAgentRun).toHaveBeenCalledOnce();expect(onApply).not.toHaveBeenCalled();
  });
  it('cancels the original running task and ignores a later status response',async()=>{
    vi.useFakeTimers();connected();const running={...runFrom(proposal),state:'running' as const,candidates:[],progress:'正在查找物料'};
    vi.mocked(controller.startAgentRun).mockResolvedValueOnce(running);
    vi.mocked(controller.cancelAgentRun).mockResolvedValueOnce({...running,state:'cancelled'});
    render(ui());send();await act(async()=>{await Promise.resolve();});
    fireEvent.click(screen.getByRole('button',{name:'展开工作区'}));
    fireEvent.click(screen.getByRole('button',{name:'收起聊天'}));openExecution();
    expect(document.getElementById('creative-conversation-status')?.textContent).toContain('正在查找物料');
    fireEvent.click(screen.getByRole('button',{name:'场景模板'}));
    expect(screen.queryByRole('button',{name:'取消任务'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'展开聊天'}));
    expect(document.querySelector('.cr-chat-feed')?.textContent).toContain('正在查找物料');
    fireEvent.click(screen.getByRole('button',{name:'取消任务'}));
    await act(async()=>{await Promise.resolve();await vi.advanceTimersByTimeAsync(2500);});
    expect(controller.cancelAgentRun).toHaveBeenCalledWith(running.id);
    expect(controller.getAgentRun).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByText('方案提案 · 尚未应用')).toBeNull();
  });
  it('offers all six parametric families as editable requests and keeps material/export tools',()=>{
    renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));selectMode('model');
    for(const name of ['桌','椅','柜台','地台','背景板','柜体'])expect(screen.getByRole('button',{name})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'桌'}));
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toContain('1.6 米');
    expect(controller.startAgentRun).not.toHaveBeenCalled();
  });
});

it('honors the server preview decision even when direct application is selected',async()=>{
  connected();vi.mocked(controller.startAgentRun).mockResolvedValueOnce(runFrom(proposal));
  renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
  fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'有没有更好的布局'}});
  fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
  await screen.findByText('方案提案 · 尚未应用');
  expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
});

it('cancels a dispatch that is acknowledged only after the cancellation was requested',async()=>{
  connected();let acknowledge!:(run:AgentRun)=>void;
  vi.mocked(controller.startAgentRun).mockImplementationOnce(()=>new Promise(resolve=>{acknowledge=resolve;}));
  vi.mocked(controller.getAgentRunByRequest).mockRejectedValueOnce(new Error('任务尚未写入'));
  vi.mocked(controller.cancelAgentRun).mockResolvedValueOnce({...runFrom(proposal),state:'cancelled',candidates:[]});
  renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Binggo Agent'}));
  fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'摆放桌子'}});fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
  fireEvent.click(await screen.findByRole('button',{name:'取消任务'}));
  await screen.findByText('原任务结果待核对。查询会继续读取原任务，不会再次提交生成。');
  await act(async()=>acknowledge(runFrom(proposal)));
  expect(controller.cancelAgentRun).toHaveBeenCalledWith(runFrom(proposal).id);
  expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
});

it('keeps a newer task recoverable when a cancelled dispatch is acknowledged late',async()=>{
  connected();let acknowledge!:(run:AgentRun)=>void;
  vi.mocked(controller.startAgentRun).mockImplementationOnce(()=>new Promise(resolve=>{acknowledge=resolve;})).mockImplementationOnce(()=>new Promise(()=>{}));
  const cancelled={...runFrom(proposal),state:'cancelled' as const,candidates:[]};
  vi.mocked(controller.getAgentRunByRequest).mockResolvedValueOnce(runFrom(proposal));
  vi.mocked(controller.cancelAgentRun).mockResolvedValue(cancelled);
  render(ui());
  const send=(text:string)=>{fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:text}});fireEvent.click(screen.getByRole('button',{name:'发送消息'}));};
  send('摆放桌子');fireEvent.click(await screen.findByRole('button',{name:'取消任务'}));
  await screen.findByText('任务已取消，当前方案保持不变。');
  send('改为摆放椅子');
  const second=vi.mocked(controller.startAgentRun).mock.calls[1]![0];
  const key=Object.keys(localStorage).find(value=>value.startsWith('scendance:agent-run:'))!;
  expect(JSON.parse(localStorage.getItem(key)!).requestId).toBe(second.requestId);
  await act(async()=>acknowledge(runFrom(proposal)));
  expect(JSON.parse(localStorage.getItem(key)!).requestId).toBe(second.requestId);
  expect(screen.getByRole('button',{name:'取消任务'})).toBeTruthy();
  expect(controller.applySceneProposal).not.toHaveBeenCalled();
});
