'use client';

import { ChevronDown, ChevronUp, Info, LayoutTemplate, Mountain } from 'lucide-react';
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
  variant = 'shelf',
  onRegisterNew,
}: {
  layout: RoomLayout;
  onApply(layout: RoomLayout): void;
  environment?: {
    preview: SplatPreviewState;
    current: StoredEnvironment | null;
    onSelect(assetId: string, name: string): void;
    onClear(): void;
    /** 高斯空间正在展示时，切回矢量空间（只换视图，不摘掉已存的环境）。 */
    onShowVector?(): void;
  };
  /** shelf = 画布底部抽屉；card = 嵌进 Agent 面板，不要拖拽条。 */
  variant?: 'shelf' | 'card';
  /** 新建空间收进输入框的 ＋ 菜单：blank 直接立空白壳，template 展开模板卡。 */
  onRegisterNew?(run: (mode?: 'blank' | 'template') => void): void;
}): JSX.Element {
  const hostRef = useRef<HTMLElement>(null);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState('');
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
        <div className={`sc-space-card${expanded ? ' is-expanded' : ''}`}>
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
              ? <EnvironmentPreview preview={environment.preview} current={environment.current} onSelect={environment.onSelect} onClear={environment.onClear} {...(environment.onShowVector ? { onShowVector: environment.onShowVector } : {})}/>
              : <>
                <div className="sc-space-section-head"><Mountain size={15} aria-hidden="true"/><h3>环境</h3><small>本场观感</small></div>
                <p className="sc-note">环境会列在这里。本场观感包取回之后可以铺成背景。</p>
              </>}
          </section>
          <button type="button" className="sc-space-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
            <span>{expanded ? '收起' : '展开'}</span>
            {expanded ? <ChevronUp size={13} aria-hidden="true"/> : <ChevronDown size={13} aria-hidden="true"/>}
          </button>
        </div>
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
