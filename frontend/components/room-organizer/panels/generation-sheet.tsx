'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Camera, FileImage, Sparkles, X } from '@/components/solid-icons';
import { type BackendSession, type BackendSnapshot, type GenerationCapabilities } from '@/lib/backend-session';
import {
  beginGenerationSubmission,
  consumeFacilityGenerateLink,
  discardFacilityGenerateLink,
  findUnresolvedGenerationSubmission,
  getGenerationSubmissionsRevision,
  latestGenerationSubmissionReceipt,
  recordFacilityGenerateLink,
  registerGeneratedFacilityModel,
  settleGenerationSubmission,
  subscribeGenerationSubmissions,
} from '../lib/facility-generated-models';
import {
  GENERATION_TASK_COPY,
  backToGenerationChooser,
  chooseGenerationTask,
  closeGenerationSheet,
  generationNeedsCredit,
  generationPrimaryLabel,
  generationSheetTitle,
  generationTargetLabel,
  generationTaskList,
  getGenerationSheetState,
  openGenerationSheet,
  setGenerationModelSource,
  subscribeGenerationSheet,
  type GenerationModelSource,
  type GenerationTask,
} from '../lib/generation-sheet';
import { importDisplayName, newLocalGlbKey, validateLocalGlbPick } from '../lib/glb-import';
import { subscribeStagedMaterialGenerate } from '../lib/material-generate';
import {
  UNKNOWN_SUBMISSION_NOTICE,
  generationBlockReason,
  generationFailureDisposition,
  modeSupports,
  pickEngine,
  plainFailure,
  submitModelJob,
  uploadModelReference,
} from '../lib/model-generation';
import { addMyItem } from '../lib/my-items';
import { CreationEntry } from './creation-entry';
import type { CatalogItem } from '../lib/types';
import './generation-sheet.css';

/**
 * 统一生成面板。
 *
 * 创作来路：左栏同一页三张卡片（重建真实场地、文生 3D、图生 3D）。
 * 点「开始创作」才进入已有的模型表单（source: 'text' | 'image'）。
 * 重建卡只收照片/视频并在本卡预览，不提交重建。导入 GLB 不在这些卡片上。
 * 物料 / 设施来路仍直接进模型表单，导入仍是那张表单里的一种输入。
 *
 * 模型这条接真提交：描述/图片走 generated-model-library 同一套 createGenerationJob
 * （lib/model-generation）。额度确认只在会真扣额度的操作前出现，且不会自动勾上。
 */
const OFFLINE_SNAPSHOT = { user: null, project: null, writeBlocked: false, dirty: false } as unknown as BackendSnapshot;
const offlineSnapshot = () => OFFLINE_SNAPSHOT;
const offlineSubscribe = () => () => {};

/** controller 可能没有（未登录/未连接）。此时读离线快照，不另建一个真会话。 */
function useOptionalCloud(controller?: BackendSession): BackendSnapshot {
  return useSyncExternalStore(
    controller ? controller.subscribe : offlineSubscribe,
    controller ? controller.getSnapshot : offlineSnapshot,
    controller ? controller.getSnapshot : offlineSnapshot,
  );
}

export function GenerationSheetHost({ controller, onAddLocalGlb }: {
  /** 保留给拍摄向导接线。创作入口的「拍摄现场」走卡片自己的相机/文件口，不打开拍摄向导。 */
  onOpenCapture?: (() => void) | undefined;
  /** 云项目会话：模型生成走它的队列。缺省时模型表单只解释为什么不能提交。 */
  controller?: BackendSession | undefined;
  /** 导入的本机 GLB 在「物料」来路下落进哪里（room-organizer 传 placeFromCatalog）。 */
  onAddLocalGlb?: ((item: CatalogItem) => void) | undefined;
}): JSX.Element | null {
  const state = useSyncExternalStore(subscribeGenerationSheet, getGenerationSheetState, getGenerationSheetState);
  const cardRef = useRef<HTMLElement>(null);
  const cloud = useOptionalCloud(controller);
  const [source, setSource] = useState<GenerationModelSource>('text');
  const [prompt, setPrompt] = useState('');
  const [credit, setCredit] = useState(false);
  const [photoName, setPhotoName] = useState('');
  const [reference, setReference] = useState<{ id: string; name: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [capabilities, setCapabilities] = useState<GenerationCapabilities | null>(null);
  const [capabilityState, setCapabilityState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');

  // 提交回执：按「项目 + 设施」读最近一次提交与未知锁；刷新/重开面板后仍可核对。
  const receiptsRevision = useSyncExternalStore(
    subscribeGenerationSubmissions,
    getGenerationSubmissionsRevision,
    getGenerationSubmissionsRevision,
  );
  const projectId = cloud.project?.id;
  const facilityId = state.facility?.id ?? null;
  const receipt = useMemo(
    () => latestGenerationSubmissionReceipt({ projectId, facilityId }),
    [projectId, facilityId, receiptsRevision],
  );
  const unknownLock = useMemo(
    () => findUnresolvedGenerationSubmission({ projectId, facilityId }),
    [projectId, facilityId, receiptsRevision],
  );

  const signedIn = Boolean(cloud.user?.id);
  const formSource: GenerationModelSource = state.scope === 'venue' && source === 'import' ? 'text' : source;
  const engine = useMemo(() => pickEngine(capabilities, formSource === 'image' ? 'image' : 'text'), [capabilities, formSource]);

  // 每次换面板/换任务都把表单清干净，免得把上一次的内容带进另一个任务；
  // 但对话里带进来的那句原话（state.prompt）要落在描述框里。额度确认每次都从空开始。
  useEffect(() => {
    setSource(state.scope === 'venue' && state.source === 'import' ? 'text' : state.source);
    setPrompt(state.prompt);
    setPhotoName('');
    setReference(null);
    setCredit(false);
    setNotice('');
    setBusy(false);
  }, [state.open, state.task, state.source, state.prompt, state.facility?.id, state.scope]);

  // 活动对话里点名「生成物件」：不再弹旧的物料星菜单，直接把原话带进这张面板。
  useEffect(() => subscribeStagedMaterialGenerate(request => {
    openGenerationSheet({
      task: 'model',
      scope: 'material',
      source: request.kind === 'image' ? 'image' : 'text',
      ...(request.kind === 'text' ? { prompt: request.prompt } : {}),
    });
  }), []);

  useEffect(() => {
    if (!state.open) return;
    // 与拍摄卡一致：开卡先把焦点收进卡内，Esc 才由卡自己接（不再全局抢 Esc）。
    cardRef.current?.focus();
  }, [state.open]);

  // 能力表只跟会话走；面板关掉就停读，不白跑请求。
  useEffect(() => {
    if (!state.open || !controller || !signedIn) { setCapabilities(null); setCapabilityState('idle'); return undefined; }
    let alive = true;
    setCapabilityState('loading');
    controller.getGenerationCapabilities().then(value => {
      if (!alive) return;
      setCapabilities(value);
      setCapabilityState('ready');
    }).catch(() => {
      if (!alive) return;
      setCapabilities(null);
      setCapabilityState('failed');
    });
    return () => { alive = false; };
  }, [controller, signedIn, state.open]);

  if (!state.open) return null;

  const tasks: GenerationTask[] = generationTaskList(state.scope);
  const title = generationSheetTitle(state.task === 'model' ? { ...state, source: formSource } : state);
  const needsCredit = generationNeedsCredit(state.task, formSource);
  const primary = generationPrimaryLabel(state.task, formSource);
  const allowImport = state.scope !== 'venue';
  const anyConfigured = Boolean(capabilities && (capabilities.textToModel || capabilities.imageToModel
    || capabilities.aholoTextToModel || capabilities.aholoImageToModel));
  const blocked = generationBlockReason({
    signedIn,
    capabilityState,
    anyConfigured,
    disabled: busy,
    writeBlocked: cloud.writeBlocked,
  });
  const modeReady = modeSupports(capabilities, formSource === 'image' ? 'image' : 'text');
  // 正在提交时不要显示「上次结果未知」：那一条 submitting 回执就是本次请求。
  const lockForUi = busy ? null : unknownLock;
  const receiptShown = busy ? null : (unknownLock ?? receipt);
  const receiptText = receiptShown
    ? unknownLock
      ? `上次提交结果未知：可能已经创建任务并计费。先查任务记录与费用，不重试。${unknownLock.taskid ? `任务号 ${unknownLock.taskid}。` : ''}请求号 ${unknownLock.requestId}。`
      : receiptShown.state === 'submitted'
        ? `上次提交已受理：任务号 ${receiptShown.taskid ?? '（服务端未返回）'}。请求号 ${receiptShown.requestId}。`
        : receiptShown.state === 'failed'
          ? `上次提交未被受理：${receiptShown.message ?? '服务端已拒绝'}。请求号 ${receiptShown.requestId}。`
          : `上次提交尚未核对：请求号 ${receiptShown.requestId}。`
    : '';
  // 已结束（成功或被明确拒绝）才能再次生成。未知锁可能已经计费，不提供重试入口。
  const againReady = !busy && state.task === 'model' && formSource !== 'import' && !lockForUi
    && (receipt?.state === 'submitted' || receipt?.state === 'failed');

  /** 模型这条：真提交。额度确认是提交前的闸门，不是提交后的道歉。 */
  const submitModel = async (): Promise<void> => {
    if (!controller) { setNotice('登录云项目后才能生成模型。'); return; }
    if (!prompt.trim()) { setNotice(formSource === 'image' ? '先写一句补充描述。' : '先写一句描述。'); return; }
    if (formSource === 'image' && !reference) { setNotice('先选一张参考图。'); return; }
    if (blocked) { setNotice(blocked); return; }
    if (!modeReady) { setNotice('当前没有开通这种生成方式。'); return; }
    // 上一次结果未知：按钮已经灰了，回车也不能绕过；先查任务记录与费用。
    if (unknownLock) { setNotice(UNKNOWN_SUBMISSION_NOTICE); return; }
    if (!credit) return; // 未勾额度时按钮本身就是灰的，不再弹提示。
    // 提交当刻捕获目标：等待期间用户换了设施/项目，链接与回执也不能跟着串。
    const facility = state.facility;
    const requestId = crypto.randomUUID();
    setBusy(true);
    setNotice('');
    // 先记「这炉生成给哪件设施」（10 分钟内的 staged 链接），成功后用 taskid 落成正式链接。
    if (facility) {
      recordFacilityGenerateLink({
        facilityId: facility.id,
        facilityName: facility.name,
        ...(projectId ? { projectId } : {}),
      });
    }
    // 再落提交回执：requestId 必须在发请求前写盘，断网后才查得到这次提交。
    beginGenerationSubmission({
      requestId,
      prompt: prompt.trim(),
      ...(projectId ? { projectId } : {}),
      ...(facility ? { facilityId: facility.id, facilityName: facility.name } : {}),
    });
    try {
      const job = await submitModelJob(controller, {
        mode: formSource === 'image' ? 'image' : 'text',
        prompt,
        engine,
        requestId,
        ...(formSource === 'image' && reference ? { referenceImageAssetId: reference.id } : {}),
      });
      // 属性卡来路：把 staged 链接落成 taskid↔facility，画布轮询到 ready 就回填模型条首位。
      if (facility) consumeFacilityGenerateLink(job.id, job.prompt || prompt);
      if (job.state === 'submit_unknown') {
        settleGenerationSubmission(requestId, { state: 'unknown', taskid: job.id, message: UNKNOWN_SUBMISSION_NOTICE });
        setNotice(`已创建任务 ${job.id}，但结果暂不可核对。${UNKNOWN_SUBMISSION_NOTICE}`);
        return;
      }
      settleGenerationSubmission(requestId, { state: 'submitted', taskid: job.id });
      setNotice(`已提交：任务号 ${job.id}「${job.prompt || prompt}」。${facility
        ? `生成完会回填到「${facility.name}」的模型条。`
        : '生成完会出现在「我的生成」。'}`);
      // 同一张表单留着，方便不满意时再生成；额度必须重新勾，不会自动再扣。
      setCredit(false);
    } catch (failure) {
      // 无论哪种失败都先清 staged：残留会把下一次生成错挂到这件设施。
      if (facility) discardFacilityGenerateLink();
      if (generationFailureDisposition(failure) === 'unknown') {
        settleGenerationSubmission(requestId, { state: 'unknown', message: UNKNOWN_SUBMISSION_NOTICE });
        setNotice(`结果未知：请求号 ${requestId}。先查任务记录与费用，不重试。`);
      } else {
        const message = plainFailure(failure);
        settleGenerationSubmission(requestId, { state: 'failed', message });
        setNotice(message);
        setCredit(false);
      }
    } finally {
      setBusy(false);
    }
  };

  /** 图片来路：先传参考图，提交时只带资产 id。 */
  const pickReference = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setPhotoName(file.name);
    if (!controller) { setNotice('登录云项目后才能上传参考图。'); return; }
    try {
      const uploaded = await uploadModelReference(controller, file);
      setReference(uploaded);
      setNotice('');
    } catch (failure) {
      setReference(null);
      setNotice(plainFailure(failure));
    }
  };

  /** 导入 GLB：本机文件，不进生成队列、不扣额度。带设施就回填那件设施，否则落进物料库。 */
  const importGlb = async (file: File | undefined): Promise<void> => {
    if (!file || !allowImport) return;
    const invalid = validateLocalGlbPick(file);
    if (invalid) { setNotice(invalid); return; }
    setBusy(true);
    setNotice('');
    try {
      const { importLocalGlb, createGlbCatalogItem } = await import('../three/glb-assets');
      const asset = await importLocalGlb(file, newLocalGlbKey());
      if (state.facility) {
        registerGeneratedFacilityModel({
          slug: `generated:${asset.key}`,
          name: asset.name,
          glbUrl: asset.key,
          width: asset.width,
          depth: asset.depth,
          height: asset.height,
          facilityId: state.facility.id,
          facilityName: state.facility.name,
          createdAt: Date.now(),
          sessionOnly: true,
        });
        setNotice(`「${importDisplayName(file.name)}」已导入，并回填到「${state.facility.name}」的模型条（仅本次编辑有效）。`);
      } else {
        const created = createGlbCatalogItem({
          name: asset.name,
          url: asset.key,
          width: asset.width,
          depth: asset.depth,
          height: asset.height,
          source: 'local_sample',
        });
        // 先留进「我的物品」（本会话可反复放），再摆进场景。
        addMyItem(created);
        onAddLocalGlb?.(created);
        setNotice(`「${asset.name}」已导入并放进场景（仅本次编辑有效）。`);
      }
    } catch (failure) {
      setNotice(plainFailure(failure));
    } finally {
      setBusy(false);
    }
  };

  const primaryAction = (): void => {
    if (state.task !== 'model') return;
    if (formSource === 'import') {
      document.getElementById('gs-import-glb-input')?.click();
      return;
    }
    void submitModel();
  };

  /** 再次生成：回到同一张表单。表单还在就沿用当前内容；关掉再开时把上次的描述填回来。不提交、不勾额度。 */
  const regenerate = (): void => {
    setCredit(false);
    setBusy(false);
    if (!prompt.trim() && receipt?.prompt) setPrompt(receipt.prompt);
    const field = cardRef.current?.querySelector<HTMLTextAreaElement>('textarea')
      ?? cardRef.current?.querySelector<HTMLInputElement>('input:not([type="checkbox"]):not([type="file"])');
    field?.focus();
  };

  const openVenueModel = (next: 'text' | 'image'): void => {
    setGenerationModelSource(next);
    chooseGenerationTask('model');
  };

  const venueEntry = state.scope === 'venue' && (state.task === 'choose' || state.task === 'scene-recon');

  return (
    <aside
      ref={cardRef}
      id="generation-sheet"
      className={`sc-generation-card${state.scope === 'venue' ? ' is-venue' : ''}${venueEntry ? ' is-entry' : ''}`}
      aria-label={title}
      data-testid="generation-sheet"
      tabIndex={-1}
      onKeyDown={event => {
        // 与拍摄卡同一种取消：Esc 只在焦点在卡内时收卡，不干扰画布自己的 Esc（退出绘制等）。
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.stopPropagation();
        closeGenerationSheet();
      }}
    >
      <div className="gs-head">
        <strong>{title}</strong>
        <button type="button" className="sc-left-close" aria-label="关闭生成面板" onClick={closeGenerationSheet}><X size={18} aria-hidden="true" /></button>
      </div>

      <div className="gs-body">
        {state.scope === 'venue' ? (
          <div className="gs-create-host" hidden={!venueEntry}>
            <CreationEntry onStartText={() => openVenueModel('text')} onStartImage={() => openVenueModel('image')} />
          </div>
        ) : null}
        {venueEntry ? null : state.task === 'choose' ? (
          <div className="gs-tasks">
            {tasks.map(task => {
              const copy = GENERATION_TASK_COPY[task];
              return (
                <button
                  key={task}
                  type="button"
                  className="gs-task"
                  data-testid={`generation-task-${task}`}
                  onClick={() => chooseGenerationTask(task)}
                >
                  <span className="gs-task-icon" aria-hidden>
                    {task === 'scene-recon' ? <Camera size={15} /> : <Sparkles size={15} />}
                  </span>
                  <span className="gs-task-text">
                    <strong>{copy.title}</strong>
                    <small>{copy.hint}</small>
                  </span>
                </button>
              );
            })}
          </div>
        ) : state.task === 'scene-recon' ? (
          <CreationEntry onStartText={() => openVenueModel('text')} onStartImage={() => openVenueModel('image')} />
        ) : (
          <>
            {state.scope === 'venue' ? (
              <div className="gs-crumb">
                <button type="button" className="gs-link" onClick={backToGenerationChooser}>← 返回</button>
              </div>
            ) : null}

            <div className={state.scope === 'venue' ? 'gs-window' : undefined}>
              <p className="gs-target" data-testid="generation-target">{generationTargetLabel(state.facility)}</p>
              {receiptText ? (
                <p className={receiptShown && unknownLock ? 'gs-notice' : 'gs-hint'} data-testid="generation-receipt">{receiptText}</p>
              ) : null}
              <div className="gs-seg" role="group" aria-label="模型输入方式">
                <button type="button" aria-pressed={formSource === 'text'} onClick={() => setSource('text')}>{state.scope === 'venue' ? '文生 3D' : '描述'}</button>
                <button type="button" aria-pressed={formSource === 'image'} onClick={() => setSource('image')}>{state.scope === 'venue' ? '图生 3D' : '图片'}</button>
                {allowImport ? <button type="button" aria-pressed={formSource === 'import'} onClick={() => setSource('import')}>导入</button> : null}
              </div>
              {formSource === 'text' ? (
                <div className="gs-composer">
                  <textarea
                    rows={2}
                    maxLength={200}
                    aria-label="描述"
                    value={prompt}
                    placeholder={state.facility ? `${state.facility.name}（材质、颜色、尺寸都写上）` : '一句话描述物件，如：一把户外折叠椅'}
                    onChange={event => setPrompt(event.target.value)}
                    onKeyDown={event => {
                      if (event.nativeEvent.isComposing || event.key !== 'Enter' || event.shiftKey) return;
                      event.preventDefault();
                      primaryAction();
                    }}
                  />
                  <div className="gs-composer-foot">
                    <span className="gs-composer-hint">回车生成，Shift+Enter 换行</span>
                    <kbd className="gs-kbd">Enter</kbd>
                  </div>
                </div>
              ) : null}
              {formSource === 'image' ? (
                <>
                  <label
                    className={`gs-drop${photoName ? ' has-file' : ''}`}
                    onDragOver={event => { event.preventDefault(); }}
                    onDrop={event => { event.preventDefault(); void pickReference(event.dataTransfer.files?.[0]); }}
                  >
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      className="gs-file-input"
                      disabled={busy}
                      onChange={event => { void pickReference(event.target.files?.[0]); event.target.value = ''; }}
                    />
                    <FileImage size={16} aria-hidden />
                    <span className="gs-drop-text">
                      <strong>{photoName || '选一张参考图，或拖进来'}</strong>
                      <small>{photoName ? (reference ? '已上传' : '正在上传…') : 'PNG / JPG，主体清楚、背景干净'}</small>
                    </span>
                  </label>
                  <label className="gs-field">
                    补充描述
                    <input value={prompt} maxLength={200} placeholder="按照片做同款，哑光白桌面" onChange={event => setPrompt(event.target.value)} />
                  </label>
                </>
              ) : null}
              {formSource === 'import' ? (
                <>
                  <input
                    id="gs-import-glb-input"
                    type="file"
                    accept=".glb,model/gltf-binary"
                    className="gs-file-input"
                    onChange={event => { void importGlb(event.target.files?.[0]); event.target.value = ''; }}
                  />
                  <p className="gs-hint">单文件 .glb，≤10 MB；仅本次编辑有效，刷新后需重新导入。</p>
                </>
              ) : null}

              {needsCredit ? (
                <label className="gs-credit">
                  <input type="checkbox" checked={credit} disabled={busy} onChange={event => setCredit(event.target.checked)} />
                  消耗额度
                </label>
              ) : null}

              {notice ? <p className="gs-notice" role="status">{notice}</p> : null}

              {/* 禁用按钮在部分浏览器里不弹出 title，拦下「生成」的原因必须写在按钮旁边。 */}
              {formSource !== 'import' && blocked ? (
                <p className="gs-hint gs-hint--warn" data-testid="generation-block-reason">{blocked}</p>
              ) : null}

              <div className="gs-actions">
                <button type="button" className="gs-cancel" onClick={closeGenerationSheet}>取消</button>
                {againReady ? (
                  <button type="button" className="gs-again" data-testid="generation-again" onClick={regenerate}>再次生成</button>
                ) : null}
                <button
                  type="button"
                  className="gs-primary"
                  data-testid="generation-primary"
                  disabled={busy || Boolean(lockForUi) || (needsCredit && !credit) || (formSource !== 'import' && Boolean(blocked))}
                  title={(lockForUi ? UNKNOWN_SUBMISSION_NOTICE : blocked) || undefined}
                  onClick={primaryAction}
                >
                  {busy ? '提交中…' : primary}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
