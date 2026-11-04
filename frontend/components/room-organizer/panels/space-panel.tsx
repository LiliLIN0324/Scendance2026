'use client';

import { ChevronDown, ChevronUp, Globe, Info, Layers, LayoutTemplate, Mountain, Scan } from '@/components/solid-icons';
import { useEffect, useRef, useState } from 'react';
import { BLANK_VENUE, createBlankVenue } from '../lib/blank-venue';
import { isUntouched } from '../lib/restore-point';
import { SCENE_PRESETS } from '../lib/scene-presets';
import { EnvironmentPreview } from './environment-preview';
import { ShelfGrip } from './scendance-workspace';
import { ScenePresetsPanel } from './scene-presets-panel';
import { StructuralPropertiesPanel } from './structural-properties-panel';
import type { SplatPreviewState } from '../hooks/use-splat-preview';
import type { StoredEnvironment } from '../lib/environment-preference';
import type { RoomLayout } from '../lib/types';

/**
 * 空间是独立的一页：场景模板和本场环境从物料库搬到这里。
 * 新建空间进这一页上的空白壳体；空间可以是一间房，也可以是一栋建筑。
 */
export function SpacePanel({
  layout,
  onApply,
  environment,
  onOpenAholo,
  workflow: controlledWorkflow,
  onWorkflowChange,
  variant = 'shelf',
  onRegisterNew,
}: {
  layout: RoomLayout;
  onApply(layout: RoomLayout): void;
  environment?: {
    preview: SplatPreviewState;
    current: StoredEnvironment | null;
    environments: readonly StoredEnvironment[];
    floors: readonly Readonly<{ id: string; name: string }>[];
    onSelect(assetId: string, name: string): void;
    onRemove(assetId: string): void;
    onSetFloor(assetId: string, floorIndex: number): void;
    onClear(): void;
  };
  /** 直接打开既有 Aholo World / World Recon 流程。 */
  onOpenAholo?: ((kind: 'world' | 'recon') => void) | undefined;
  /** 可由工作台托管，切换到其他 Agent 后也记住本次选择。 */
  workflow?: 'aholo' | 'traditional';
  onWorkflowChange?(workflow: 'aholo' | 'traditional'): void;
  /** shelf = 画布底部抽屉；card = 嵌进 Agent 面板，不要拖拽条。 */
  variant?: 'shelf' | 'card';
  /** 新建空间收进输入框的 ＋ 菜单：blank 直接立空白壳，template 展开模板卡。 */
  onRegisterNew?(run: (mode?: 'blank' | 'template') => void): void;
}): JSX.Element {
  const hostRef = useRef<HTMLElement>(null);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState('');
  // 项目默认走 World 世界模型 + Gaussian Splatting；传统壳体与模板作为可切换路径。
  const [localWorkflow, setLocalWorkflow] = useState<'aholo' | 'traditional'>('aholo');
  const workflow = controlledWorkflow ?? localWorkflow;
  const selectWorkflow = onWorkflowChange ?? setLocalWorkflow;
  // 一张卡两种高度：收起只露模板一行与环境当前项，展开看完整模板列表与更大的环境预览。
  const [expanded, setExpanded] = useState(false);
  const blank = BLANK_VENUE;
  const startBlank = () => {
    setConfirm(false);
    setNotice('');
    try {
      onApply(createBlankVenue(layout));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '空白空间没立起来，请重试。');
    }
  };
  const pressNew = (mode: 'blank' | 'template' = 'blank') => {
    if (mode === 'template') {
      setConfirm(false);
      const templates = hostRef.current?.querySelector<HTMLElement>('.sc-space-templates');
      templates?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (isUntouched(layout)) startBlank();
    else setConfirm(true);
  };
  const card = variant === 'card';
  useEffect(() => { onRegisterNew?.(pressNew); });
  return (
    <aside ref={hostRef} className={`sc-library sc-compact-shelf sc-space-panel${card ? ' is-card' : ''}`} aria-label="空间">
      {!card && <ShelfGrip shelfRef={hostRef} label="调整空间面板高度"/>}
      <div className="sc-space-body">
        {notice && <p className="sc-note" role="status">{notice}</p>}
        <div className="sc-space-workflow" role="group" aria-label="空间生成方式">
          <div className="sc-space-workflow-label"><span>空间生成</span><details className="sc-space-info"><summary aria-label="空间生成方式说明" title="空间生成方式说明"><Info size={12} aria-hidden="true"/></summary><p>项目可包含多个空间。生成可漫游的场地；传统空间用于搭建可编辑的结构和模板。可按需要组合使用。</p></details></div>
          <div className="sc-space-workflow-switch">
            <button type="button" className={workflow === 'aholo' ? 'is-active' : ''} aria-pressed={workflow === 'aholo'} onClick={() => selectWorkflow('aholo')}>
              <Globe size={14} aria-hidden="true"/><span>World 世界模型</span><small>默认 · 生成场地</small>
            </button>
            <button type="button" className={workflow === 'traditional' ? 'is-active' : ''} aria-pressed={workflow === 'traditional'} onClick={() => selectWorkflow('traditional')}>
              <Layers size={14} aria-hidden="true"/><span>传统空间</span><small>空白壳 · 模板</small>
            </button>
          </div>
        </div>
        {workflow === 'aholo' ? <div className="sc-space-card is-aholo">
          <section className="sc-space-aholo-main" aria-label="Aholo 世界模型空间生成">
            <div className="sc-space-section-head">
              <Globe size={16} aria-hidden="true"/><h3>World 世界模型</h3><small>默认</small>
            </div>
            <details className="sc-space-info sc-space-detail"><summary aria-label="World 世界模型说明" title="World 世界模型说明"><Info size={13} aria-hidden="true"/></summary><p>生成可漫游的 3D 场地。Bingo 可在可编辑布局上规划物料与动线。</p></details>
            <div className="sc-space-aholo-actions">
              <button type="button" className="sc-button is-primary" onClick={() => onOpenAholo?.('world')} disabled={!onOpenAholo}>
                <Globe size={14} aria-hidden="true"/>生成场地
              </button>
              <button type="button" className="sc-button" onClick={() => onOpenAholo?.('recon')} disabled={!onOpenAholo}>
                <Scan size={14} aria-hidden="true"/>重建真实场地
              </button>
            </div>
            {!onOpenAholo && <p className="sc-note">Aholo 空间生成当前不可用。</p>}
            <details className="sc-space-info sc-space-detail"><summary aria-label="真实场地重建素材要求" title="真实场地重建素材要求"><Info size={13} aria-hidden="true"/></summary><p>真实场地重建使用现场照片或视频；卫星图只用于选址，不能作为重建素材。</p></details>
          </section>
          <section className="sc-space-block sc-space-env" aria-label="当前环境">
            {environment
              ? <EnvironmentPreview {...environment}/>
              : <>
                <div className="sc-space-section-head"><Mountain size={15} aria-hidden="true"/><h3>当前环境</h3><small>生成后会显示在这里</small></div>
                <p className="sc-note">生成或重建完成后，把产物挂为环境；不会改动已摆物料。</p>
              </>}
          </section>
        </div> : <div className={`sc-space-card${expanded ? ' is-expanded' : ''}`}>
          <section className="sc-space-block sc-space-templates" aria-label="场景模板">
            <div className="sc-space-section-head">
              <LayoutTemplate size={15} aria-hidden="true"/><h3>场景模板</h3>
              <small>{layout.scenePreset ? `${SCENE_PRESETS[layout.scenePreset].name} · 使用中` : '挑一个开场'}</small>
            </div>
            <div className="sc-library-presets">
              <ScenePresetsPanel layout={layout} onApply={onApply} active={layout.scenePreset}/>
            </div>
          </section>
          <section className="sc-space-block sc-space-env" aria-label="环境">
            {environment
              ? <EnvironmentPreview {...environment}/>
              : <>
                <div className="sc-space-section-head"><Mountain size={15} aria-hidden="true"/><h3>环境</h3><small>本场观感</small></div>
                <p className="sc-note">环境会列在这里。本场观感包取回之后可以铺成背景。</p>
              </>}
          </section>
          <button type="button" className="sc-space-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
            <span>{expanded ? '收起' : '展开'}</span>
            {expanded ? <ChevronUp size={13} aria-hidden="true"/> : <ChevronDown size={13} aria-hidden="true"/>}
          </button>
        </div>}
        {/* 结构对所有壳体都开：普通壳体收成一行入口，云端结构仍是常驻区块。 */}
        <StructuralPropertiesPanel/>
        {confirm && <div className="sc-space-confirm" role="group" aria-label="确认新建空间">
          <span className="sc-space-confirm-plan" aria-hidden="true"/>
          <span className="sc-space-confirm-text"><strong>空白空间</strong><small>{blank.width} × {blank.depth} 米，可改尺寸</small></span>
          <span className="sc-space-confirm-actions">
            <button type="button" className="sc-button" onClick={startBlank}>新建</button>
            <button type="button" className="sc-button" onClick={() => setConfirm(false)}>取消</button>
            <details className="sc-space-info is-right is-up">
              <summary aria-label="新建会清掉什么"><Info size={12} aria-hidden="true"/></summary>
              <p>会换成一块可改尺寸的空白空间，当前布置会被清掉。</p>
            </details>
          </span>
        </div>}
      </div>
    </aside>
  );
}
