'use client';

import { useRef, useState } from 'react';
import { createBlankVenue } from '../lib/blank-venue';
import { isUntouched } from '../lib/restore-point';
import { EnvironmentPreview } from './environment-preview';
import { ShelfGrip } from './scendance-workspace';
import { ScenePresetsPanel } from './scene-presets-panel';
import { StructuralPropertiesPanel } from './structural-properties-panel';
import type { SplatPreviewState } from '../hooks/use-splat-preview';
import type { RoomLayout } from '../lib/types';

/**
 * 空间是独立的一页：场景模板和环境预览从物料库搬到这里。
 * 新建空间进这一页上的空白壳体；空间可以是一间房，也可以是一栋建筑。
 */
export function SpacePanel({
  layout,
  onApply,
  environment,
  onClose,
}: {
  layout: RoomLayout;
  onApply(layout: RoomLayout): void;
  environment?: { preview: SplatPreviewState; onStart(assetId: string): void; onStop(): void };
  onClose?(): void;
}): JSX.Element {
  const hostRef = useRef<HTMLElement>(null);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState('');
  const startBlank = () => {
    setConfirm(false);
    setNotice('');
    try {
      onApply(createBlankVenue(layout));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '空白空间没立起来，请重试。');
    }
  };
  const pressNew = () => {
    if (isUntouched(layout)) startBlank();
    else setConfirm(true);
  };
  return (
    <aside ref={hostRef} className="sc-library sc-compact-shelf sc-space-panel" aria-label="空间">
      <ShelfGrip shelfRef={hostRef} label="调整空间面板高度"/>
      <div className="sc-space-body">
        <header className="sc-space-head">
          <div>
            <h2>空间</h2>
            <p>一间房或一栋建筑都可以从这里开始。选场景模板，或新建一块空白空间。</p>
          </div>
          <button type="button" className="sc-space-new" onClick={pressNew}>新建空间</button>
          {onClose && <button type="button" className="sc-button" onClick={onClose}>关闭</button>}
        </header>
        {confirm && <div className="sc-preset-confirm sc-space-confirm" role="group" aria-label="确认新建空间">
          <p>会换成一块可改尺寸的空白空间。当前布置会被清掉。</p>
          <div>
            <button type="button" className="is-go" onClick={startBlank}>确认新建</button>
            <button type="button" onClick={() => setConfirm(false)}>取消</button>
          </div>
        </div>}
        {notice && <p className="sc-note" role="status">{notice}</p>}
        <section className="sc-space-section" aria-label="场景模板">
          <h3>场景模板</h3>
          <div className="sc-library-presets">
            <ScenePresetsPanel layout={layout} onApply={onApply}/>
          </div>
        </section>
        <section className="sc-space-section" aria-label="环境预览">
          <h3>环境预览</h3>
          {environment
            ? <EnvironmentPreview preview={environment.preview} onStart={environment.onStart} onStop={environment.onStop}/>
            : <p className="sc-note">环境预览会列在这里。本场观感包取回之后可以铺成背景。</p>}
        </section>
        {layout.backendSceneV2 && <div className="sc-preset-utilities">
          <details><summary>已建空间的结构微调</summary><StructuralPropertiesPanel/></details>
        </div>}
      </div>
    </aside>
  );
}
