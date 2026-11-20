'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { Sparkles } from '@/components/solid-icons';
import {
  CHARACTER_STEPS,
  DEFAULT_CHARACTER_ANIMATIONS,
  type CharacterStepId,
} from '../lib/character-flow';
import {
  CHARACTER_ANIMATION_PRESETS,
  imageOutputOf,
  modelOutputOf,
  submitCharacterFourView,
  submitCharacterReference,
  submitCharacterRetarget,
  submitCharacterRig,
  type CharacterTaskResult,
} from '../lib/character-generate';
import { fetchLux3dTask } from '../lib/lux3d-import';

/**
 * 角色设计分步面板（直连本机代理 3199）。
 * 链路：参考形象 → 四视图 → 静态人形 → 绑骨 → 动作重定向。
 * 产物只在面板内预览，验收通过前不写入人物库、不分配 assetId。
 * 静态人形这一步复用物件出模链路，本轮先预留占位；参考图/四视图产物是公网地址，
 * 喂给需要 dataURL 的下一步前要先下载转码（接缝待补）。
 */

interface StageState {
  taskid?: string | undefined;
  statusLabel?: string | undefined;
  resultUrl?: string | undefined;
}

const EMPTY_STAGE: StageState = {};

export function CharacterDesignPanel(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [stages, setStages] = useState<Record<CharacterStepId, StageState>>({
    ref: { ...EMPTY_STAGE },
    fourview: { ...EMPTY_STAGE },
    model: { ...EMPTY_STAGE },
    rig: { ...EMPTY_STAGE },
    retarget: { ...EMPTY_STAGE },
  });
  const [prompt, setPrompt] = useState('');
  const [fourPrompt, setFourPrompt] = useState('');
  const [refImage, setRefImage] = useState('');
  const [refImageName, setRefImageName] = useState('');
  const [modelUrl, setModelUrl] = useState('');
  const [rigUrl, setRigUrl] = useState('');
  const [animations, setAnimations] = useState<string[]>([...DEFAULT_CHARACTER_ANIMATIONS]);
  const [credit, setCredit] = useState(false);
  const [busyStep, setBusyStep] = useState<CharacterStepId | null>(null);
  const [note, setNote] = useState('');
  const alive = useRef(true);

  function patchStage(step: CharacterStepId, patch: Partial<StageState>): void {
    setStages(prev => ({ ...prev, [step]: { ...prev[step], ...patch } }));
  }

  async function submitStep(
    step: CharacterStepId,
    submit: () => Promise<CharacterTaskResult>,
  ): Promise<void> {
    if (busyStep) return;
    if (!credit) { setNote('请先勾选「确认扣额度」后再提交。'); return; }
    setBusyStep(step);
    setNote('');
    const result = await submit();
    if (!alive.current) return;
    setBusyStep(null);
    if (!result.ok) {
      setNote(result.message);
      if (!result.stub) setCredit(false);
      return;
    }
    patchStage(step, { taskid: result.taskid, statusLabel: '排队中' });
    setNote('已提交生成。完成后点该步的「取回」查看产物。');
  }

  async function fetchResult(
    step: CharacterStepId,
    pick: (outputs: string[]) => string | undefined,
    onResult?: (url: string) => void,
  ): Promise<void> {
    const taskid = stages[step].taskid;
    if (!taskid || busyStep) return;
    setBusyStep(step);
    setNote('');
    try {
      const detail = await fetchLux3dTask(taskid);
      if (!alive.current) return;
      if (detail.status === 0 || detail.status === 1) {
        patchStage(step, { statusLabel: detail.statusLabel });
        setNote(`${detail.statusLabel}，稍后再点取回。`);
      } else if (detail.status === 4 || detail.status === 6) {
        setNote(`${detail.statusLabel}，请回到该步重新提交。`);
      } else {
        const url = pick(detail.outputs);
        if (!url) { setNote('产物里没找到可用的图片或模型文件。'); return; }
        patchStage(step, { statusLabel: detail.statusLabel, resultUrl: url });
        onResult?.(url);
        setNote('已取回产物。');
      }
    } catch (error) {
      setNote(error instanceof Error ? error.message : '取回任务失败，请稍后重试。');
    } finally {
      if (alive.current) setBusyStep(null);
    }
  }

  function pickReferenceImage(file: File | undefined): void {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) {
      setNote('请选择不超过 5 MB 的 PNG 或 JPEG 图片。');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setRefImage(reader.result);
        setRefImageName(file.name);
        setNote('');
      }
    };
    reader.onerror = () => setNote('图片读取失败，请重新选择。');
    reader.readAsDataURL(file);
  }

  function toggleAnimation(id: string): void {
    setAnimations(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  const busy = busyStep !== null;

  function renderStageHeader(step: CharacterStepId, index: number): JSX.Element {
    const def = CHARACTER_STEPS[index];
    const state = stages[step];
    return (
      <div className="sc-material-create-field">
        <strong>{index + 1}. {def.label}</strong>
        <span className="sc-note">{def.hint}</span>
        {state.statusLabel && <span className="sc-note">{state.statusLabel}</span>}
        {state.resultUrl && <span className="sc-note">产物已取回</span>}
      </div>
    );
  }

  function renderResult(step: CharacterStepId, kind: 'image' | 'glb'): JSX.Element | null {
    const url = stages[step].resultUrl;
    if (!url) return null;
    return kind === 'image'
      ? /* eslint-disable-next-line @next/next/no-img-element */
        <img className="sc-lib-tile-photo" src={url} alt={`${step} 预览`} style={{ maxWidth: 160 }}/>
      : <a className="sc-note" href={url} target="_blank" rel="noreferrer">{url.slice(0, 80)}</a>;
  }

  return (
    <div className="sc-lib-tree-panel" aria-label="角色设计">
      <button
        type="button"
        className="ap-gen-chip"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <Sparkles size={14} aria-hidden="true"/> 设计新角色
      </button>
      {open && (
        <div className="sc-material-create-menu" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
          {/* 1. 参考形象 */}
          <section>
            {renderStageHeader('ref', 0)}
            <label className="sc-material-create-field">角色描述
              <textarea
                rows={3}
                maxLength={4000}
                value={prompt}
                disabled={busy}
                aria-label="角色描述"
                placeholder="例如：女性志愿者，红白志愿马甲，A 字站姿，纯白背景，单人，无道具"
                onChange={event => setPrompt(event.target.value)}
              />
            </label>
            <div className="sc-material-create-actions">
              <button
                type="button"
                disabled={busy || !prompt.trim()}
                onClick={() => void submitStep('ref', () => submitCharacterReference(prompt))}
              >
                {busyStep === 'ref' ? '提交中…' : '生成参考图'}
              </button>
              <button type="button" disabled={!stages.ref.taskid || busy} onClick={() => void fetchResult('ref', imageOutputOf)}>
                取回参考图
              </button>
            </div>
            {renderResult('ref', 'image')}
          </section>

          {/* 2. 四视图 */}
          <section>
            {renderStageHeader('fourview', 1)}
            <label className="sc-material-create-field">参考图（PNG/JPEG dataURL）
              <input type="file" accept="image/png,image/jpeg" aria-label="四视图参考图" disabled={busy} onChange={(event: ChangeEvent<HTMLInputElement>) => pickReferenceImage(event.target.files?.[0])}/>
            </label>
            {refImageName && <p className="sc-note">{refImageName}</p>}
            <label className="sc-material-create-field">补充描述（可选）
              <input value={fourPrompt} disabled={busy} aria-label="四视图补充描述" onChange={event => setFourPrompt(event.target.value)}/>
            </label>
            <div className="sc-material-create-actions">
              <button
                type="button"
                disabled={busy || !refImage}
                onClick={() => void submitStep('fourview', () => submitCharacterFourView(refImage, fourPrompt || undefined))}
              >
                {busyStep === 'fourview' ? '提交中…' : '生成四视图'}
              </button>
              <button type="button" disabled={!stages.fourview.taskid || busy} onClick={() => void fetchResult('fourview', imageOutputOf)}>
                取回四视图
              </button>
            </div>
            {renderResult('fourview', 'image')}
          </section>

          {/* 3. 静态人形（占位） */}
          <section>
            {renderStageHeader('model', 2)}
            <p className="sc-note">静态人形由四视图出模（复用物件图生 3D 链路）。这一步待接入人物专用出模；产物验收前不写入人物库。</p>
            <label className="sc-material-create-field">静态人形 GLB 地址（出模后回填）
              <input value={modelUrl} disabled={busy} aria-label="静态人形模型地址" placeholder="https://…/model.glb" onChange={event => setModelUrl(event.target.value)}/>
            </label>
          </section>

          {/* 4. 绑骨 */}
          <section>
            {renderStageHeader('rig', 3)}
            <div className="sc-material-create-actions">
              <button
                type="button"
                disabled={busy || !modelUrl.startsWith('https://')}
                onClick={() => void submitStep('rig', () => submitCharacterRig(modelUrl))}
              >
                {busyStep === 'rig' ? '提交中…' : '提交绑骨'}
              </button>
              <button type="button" disabled={!stages.rig.taskid || busy} onClick={() => void fetchResult('rig', modelOutputOf, url => setRigUrl(url))}>
                取回带骨模型
              </button>
            </div>
            {renderResult('rig', 'glb')}
          </section>

          {/* 5. 动作重定向 */}
          <section>
            {renderStageHeader('retarget', 4)}
            <div className="sc-material-create-field" role="group" aria-label="选择动作">
              {CHARACTER_ANIMATION_PRESETS.map(preset => (
                <label key={preset.id} style={{ display: 'block' }}>
                  <input
                    type="checkbox"
                    checked={animations.includes(preset.id)}
                    disabled={busy}
                    onChange={() => toggleAnimation(preset.id)}
                  /> {preset.label}（{preset.id}）
                </label>
              ))}
            </div>
            <div className="sc-material-create-actions">
              <button
                type="button"
                disabled={busy || !rigUrl.startsWith('https://') || animations.length === 0}
                onClick={() => void submitStep('retarget', () => submitCharacterRetarget(rigUrl, animations))}
              >
                {busyStep === 'retarget' ? '提交中…' : '动作重定向'}
              </button>
              <button type="button" disabled={!stages.retarget.taskid || busy} onClick={() => void fetchResult('retarget', modelOutputOf)}>
                取回最终模型
              </button>
            </div>
            {renderResult('retarget', 'glb')}
          </section>

          <label className="sc-material-create-credit">
            <input type="checkbox" checked={credit} disabled={busy} aria-label="确认扣额度后才提交" onChange={event => setCredit(event.target.checked)}/>
            <span>确认扣额度后才会提交</span>
          </label>
          {note && <p className="sc-note" role="status">{note}</p>}
        </div>
      )}
    </div>
  );
}
