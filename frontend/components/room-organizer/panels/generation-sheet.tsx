'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Camera, FileImage, Globe, Scan, Sparkles, Upload, X } from '@/components/solid-icons';
import { type BackendSession, type BackendSnapshot, type GenerationCapabilities } from '@/lib/backend-session';
import type { CatalogItem } from '../lib/types';
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
  subscribeGenerationSheet,
  type GenerationModelSource,
  type GenerationTask,
} from '../lib/generation-sheet';
import {
  generationBlockReason,
  modeSupports,
  pickEngine,
  plainFailure,
  submitModelJob,
  uploadModelReference,
} from '../lib/model-generation';
import { consumeFacilityGenerateLink, recordFacilityGenerateLink, registerGeneratedFacilityModel } from '../lib/facility-generated-models';
import { importDisplayName, newLocalGlbKey, validateLocalGlbPick } from '../lib/glb-import';
import { subscribeStagedMaterialGenerate } from '../lib/material-generate';
import { addMyItem } from '../lib/my-items';
import './generation-sheet.css';

/**
 * 统一生成面板（2026-11-15）：左栏卡片，不是弹窗。
 *
 * 生成入口只剩这一张（轨道「场地」、物料栏的星、画布属性卡三处进来），标题与首层选项按来路走：
 *  - venue   ：重建真实场地 / 生成新场景；
 *  - material：直接进模型表单，结果进模型库；
 *  - facility：直接进模型表单，结果回填那件设施。
 *
 * 模型这条已经接真提交：描述/图片走 generated-model-library 同一套 createGenerationJob
 * （lib/model-generation），导入 GLB 走本机导入（会话内有效）。
 * 额度确认只在会真扣额度的操作前出现；导入是本地文件，不勾也不扣。
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

export function GenerationSheetHost({ onOpenCapture, controller, onAddLocalGlb }: {
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
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [credit, setCredit] = useState(false);
  const [photoName, setPhotoName] = useState('');
  const [reference, setReference] = useState<{ id: string; name: string } | null>(null);
  const [reconInput, setReconInput] = useState<'shoot' | 'upload'>('shoot');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [capabilities, setCapabilities] = useState<GenerationCapabilities | null>(null);
  const [capabilityState, setCapabilityState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');

  const signedIn = Boolean(cloud.user?.id);
  const engine = useMemo(() => pickEngine(capabilities, source === 'image' ? 'image' : 'text'), [capabilities, source]);

  // 每次换面板/换任务都把表单清干净，免得把上一次的内容带进另一个任务；
  // 但对话里带进来的那句原话（state.prompt）要落在描述框里。
  useEffect(() => {
    setSource(state.source);
    setName('');
    setPrompt(state.prompt);
    setPhotoName('');
    setReference(null);
    setCredit(false);
    setReconInput('shoot');
    setNotice('');
    setBusy(false);
  }, [state.open, state.task, state.source, state.prompt, state.facility?.id]);

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
  const title = generationSheetTitle(state);
  const needsCredit = generationNeedsCredit(state.task, source);
  const primary = generationPrimaryLabel(state.task, source);
  const sceneSkeleton = '场景生成还没接提交：这一步不会创建任务、也不会扣额度。';
  const anyConfigured = Boolean(capabilities && (capabilities.textToModel || capabilities.imageToModel
    || capabilities.aholoTextToModel || capabilities.aholoImageToModel));
  const blocked = generationBlockReason({
    signedIn,
    capabilityState,
    anyConfigured,
    disabled: busy,
    writeBlocked: cloud.writeBlocked,
  });
  const modeReady = modeSupports(capabilities, source === 'image' ? 'image' : 'text');

  /** 模型这条：真提交。额度确认是提交前的闸门，不是提交后的道歉。 */
  const submitModel = async (): Promise<void> => {
    if (!controller) { setNotice('登录云项目后才能生成模型。'); return; }
    if (!prompt.trim()) { setNotice(source === 'image' ? '先写一句补充描述。' : '先写一句描述。'); return; }
    if (source === 'image' && !reference) { setNotice('先选一张参考图。'); return; }
    if (blocked) { setNotice(blocked); return; }
    if (!modeReady) { setNotice('当前没有开通这种生成方式。'); return; }
    if (!credit) return; // 未勾额度时按钮本身就是灰的，不再弹提示。
    setBusy(true);
    setNotice('');
    // 先记「这炉生成给哪件设施」（10 分钟内的 staged 链接），成功后用 taskid 落成正式链接。
    if (state.facility) recordFacilityGenerateLink({ facilityId: state.facility.id, facilityName: state.facility.name });
    try {
      const job = await submitModelJob(controller, {
        mode: source === 'image' ? 'image' : 'text',
        prompt,
        engine,
        ...(source === 'image' && reference ? { referenceImageAssetId: reference.id } : {}),
      });
      // 属性卡来路：把 staged 链接落成 taskid↔facility，画布轮询到 ready 就回填模型条首位。
      if (state.facility) consumeFacilityGenerateLink(job.id, job.prompt || prompt);
      setNotice(state.facility
        ? `已提交：「${job.prompt}」。生成完会回填到「${state.facility.name}」的模型条。`
        : `已提交：「${job.prompt}」。生成完会出现在模型库。`);
      setPrompt('');
      setReference(null);
      setPhotoName('');
      setCredit(false);
    } catch (failure) {
      setNotice(plainFailure(failure));
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
    if (!file) return;
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
    if (state.task === 'scene-recon' && reconInput === 'shoot') {
      onOpenCapture?.();
      closeGenerationSheet();
      return;
    }
    if (state.task === 'model') {
      if (source === 'import') {
        // 主按钮在导入时只是「选文件」：真正读文件走下面那个 input。
        document.getElementById('gs-import-glb-input')?.click();
        return;
      }
      void submitModel();
      return;
    }
    setNotice(sceneSkeleton);
  };

  return (
    <aside
      ref={cardRef}
      id="generation-sheet"
      className="sc-generation-card"
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
        {state.task === 'choose' ? (
          <>
            <p className="gs-question">你想做什么？</p>
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
                      {task === 'scene-recon' ? <Scan size={15} /> : task === 'scene-new' ? <Globe size={15} /> : <Sparkles size={15} />}
                    </span>
                    <span className="gs-task-text">
                      <strong>{copy.title}</strong>
                      <small>{copy.hint}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="gs-crumb">
              <button type="button" className="gs-link" onClick={backToGenerationChooser}>← 换任务</button>
            </div>

            {state.task === 'scene-recon' && (
              <>
                <div className="gs-seg" role="group" aria-label="重建素材来源">
                  <button type="button" aria-pressed={reconInput === 'shoot'} onClick={() => setReconInput('shoot')}>
                    <Camera size={13} aria-hidden /> 现场拍摄
                  </button>
                  <button type="button" aria-pressed={reconInput === 'upload'} onClick={() => setReconInput('upload')}>
                    <Upload size={13} aria-hidden /> 上传
                  </button>
                </div>
                {reconInput === 'shoot' ? (
                  <p className="gs-hint">用手机绕真实场地拍一段视频（或 Insta360 全景）。卫星图、地图瓦片不能当重建素材。</p>
                ) : (
                  <p className="gs-hint">照片至少 20 张、多角度覆盖；视频一条绕场即可。</p>
                )}
              </>
            )}

            {state.task === 'scene-new' && (
              <>
                <label className="gs-field">
                  场景名称
                  <input value={name} maxLength={60} placeholder="老厂房三层展厅" onChange={event => setName(event.target.value)} />
                </label>
                <div className="gs-composer">
                  <textarea
                    rows={2}
                    maxLength={400}
                    aria-label="场地描述"
                    value={prompt}
                    placeholder="一句话描述场地，如：80 人发布会，室内"
                    onChange={event => setPrompt(event.target.value)}
                    onKeyDown={event => {
                      // 和原来那条输入栏一样：回车就提交，Shift+Enter 换行。
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
                <p className="gs-hint gs-hint--warn">室外场景仍处于 Beta，质量可能不稳定；演示建议用室内文案。</p>
              </>
            )}

            {state.task === 'model' && (
              <>
                <p className="gs-target" data-testid="generation-target">{generationTargetLabel(state.facility)}</p>
                <div className="gs-seg" role="group" aria-label="模型输入方式">
                  <button type="button" aria-pressed={source === 'text'} onClick={() => setSource('text')}>描述</button>
                  <button type="button" aria-pressed={source === 'image'} onClick={() => setSource('image')}>图片</button>
                  <button type="button" aria-pressed={source === 'import'} onClick={() => setSource('import')}>导入</button>
                </div>
                {source === 'text' ? (
                  <div className="gs-composer">
                    <textarea
                      rows={2}
                      maxLength={200}
                      aria-label="描述"
                      value={prompt}
                      placeholder={state.facility ? `${state.facility.name}（材质、颜色、尺寸都写上）` : '一句话描述物件，如：一把户外折叠椅'}
                      onChange={event => setPrompt(event.target.value)}
                      onKeyDown={event => {
                        // 原来那条物料输入栏的回车提交行为保留在这张卡里。
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
                ) : (
                  <>
                    {/* 旧的 <input type=file> 直曝浏览器样式（“选择文件 / 未选择任何文件”），
                        与卡片其余控件不是一套；换成可点可拖的投放区，真 input 只做隐藏承接。 */}
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
                        <strong>{photoName || '选一张照片，或拖进来'}</strong>
                        <small>{photoName ? (reference ? '已上传' : '正在上传…') : 'PNG / JPG，主体清楚、背景干净'}</small>
                      </span>
                    </label>
                    <label className="gs-field">
                      补充描述
                      <input value={prompt} maxLength={200} placeholder="按照片做同款，哑光白桌面" onChange={event => setPrompt(event.target.value)} />
                    </label>
                  </>
                )}
                {source === 'import' ? (
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
              </>
            )}

            {needsCredit ? (
              <label className="gs-credit">
                <input type="checkbox" checked={credit} disabled={busy} onChange={event => setCredit(event.target.checked)} />
                消耗额度
              </label>
            ) : null}

            {notice ? <p className="gs-notice" role="status">{notice}</p> : null}

            <div className="gs-actions">
              <button type="button" className="gs-cancel" onClick={closeGenerationSheet}>取消</button>
              <button
                type="button"
                className="gs-primary"
                data-testid="generation-primary"
                disabled={busy || (needsCredit && !credit) || (state.task === 'model' && source !== 'import' && Boolean(blocked))}
                title={blocked || undefined}
                onClick={primaryAction}
              >
                {busy ? '提交中…' : primary}
              </button>
            </div>
            {state.task !== 'model' ? <p className="gs-foot">{sceneSkeleton}</p> : null}
          </>
        )}
      </div>
    </aside>
  );
}
