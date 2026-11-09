'use client';

import { useEffect, useState } from 'react';
import { BLANK_VENUE, createBlankVenue } from '../lib/blank-venue';
import { isUntouched } from '../lib/restore-point';
import { SCENE_PRESETS } from '../lib/scene-presets';
import { describeScannedVenue, listScannedVenues, type ScannedVenue } from '../lib/venue-scans';
import { useRoomEditor } from '../contexts';
import { useAgent } from './agent-panel';
import { EnvironmentPreview } from './environment-preview';
import { ScenePresetsPanel } from './scene-presets-panel';
import { StructuralPropertiesPanel } from './structural-properties-panel';
import type { SplatPreviewState } from '../hooks/use-splat-preview';
import type { StoredEnvironment } from '../lib/environment-preference';
import type { RoomLayout } from '../lib/types';

interface SpaceProps {
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
  currentScanId?: string;
  onPickScan?(venue: import('../lib/venue-scans').ScannedVenue): void;
  onRegisterNew?(run: (mode?: 'blank' | 'template') => void): void;
  /** 对话里说「换成厅型」时展开厅型，不另做一套模式开关。 */
  workflow?: 'aholo' | 'traditional';
}

/**
 * 第一次办活动时，场地只有一件事：这块地能不能摆。
 * 换厅型、用扫过的场地、用图纸，是换地的几种做法，不跟「现在这块地」抢第一眼。
 */
export function PlannerSpace({
  layout,
  onApply,
  environment,
  currentScanId,
  onPickScan,
  onRegisterNew,
  workflow,
}: SpaceProps): JSX.Element {
  const { actions, history } = useRoomEditor();
  const agent = useAgent();
  const [halls, setHalls] = useState(false);
  const [walls, setWalls] = useState(false);
  const [scene, setScene] = useState(false);
  const [confirmBlank, setConfirmBlank] = useState(false);
  const [notice, setNotice] = useState('');
  const scans = listScannedVenues();
  const bound = Boolean(layout.backendSceneV2);

  useEffect(() => {
    onRegisterNew?.((mode) => {
      if (mode === 'template') setHalls(true);
      else setConfirmBlank(true);
    });
  });
  useEffect(() => {
    if (workflow === 'traditional') setHalls(true);
  }, [workflow]);

  const applySize = (width: number, depth: number) => {
    if (bound) return;
    if (width === layout.width && depth === layout.height) return;
    history.commitNow();
    if (width !== layout.width) actions.setWidth(width);
    if (depth !== layout.height) actions.setHeight(depth);
    setNotice('尺寸已改，可以撤销。');
  };

  const applyBlank = () => {
    setConfirmBlank(false);
    try {
      onApply(createBlankVenue(layout));
      setNotice(`已换成 ${BLANK_VENUE.width} × ${BLANK_VENUE.depth} 米的空地。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '空白场地没换成。');
    }
  };

  const pickScan = (venue: ScannedVenue) => {
    if (onPickScan) onPickScan(venue);
    else environment?.onSelect(venue.assetId, venue.name);
  };

  return (
    <div className="sc-planner" aria-label="场地">
      <p className="sc-planner-lead">现在这块地可以直接摆。尺寸不对就改数字。</p>
      {bound
        ? <p className="sc-planner-note">这块地的墙已经定过，改尺寸请打开下面的「改墙和门」。</p>
        : <SizePair width={layout.width} depth={layout.height} onApply={applySize} />}
      {notice && <p className="sc-planner-note" role="status">{notice}</p>}

      <div className="sc-planner-choices" role="group" aria-label="换场地">
        <button type="button" onClick={() => agent.startVenuePicker()}>换已保存的场地</button>
        <button type="button" onClick={() => { if (isUntouched(layout)) applyBlank(); else setConfirmBlank(true); }}>换成空白场地</button>
        <button type="button" aria-expanded={halls} onClick={() => setHalls(value => !value)}>
          {halls ? '收起厅型' : '换成一种厅型'}
        </button>
        <button type="button" disabled={!agent.callbacks.onOpenReference} onClick={() => agent.callbacks.onOpenReference?.()}>用图纸改这块地</button>
        <a href="/guide/capture">用手机拍场地</a>
      </div>
      {!agent.callbacks.onOpenReference && <p className="sc-planner-note">图纸入口还没接上。</p>}
      {confirmBlank && (
        <div className="sc-planner-confirm" role="group" aria-label="确认换成空白场地">
          <p>会换成 {BLANK_VENUE.width} × {BLANK_VENUE.depth} 米的空地，现在摆的东西会被清掉。</p>
          <button type="button" onClick={applyBlank}>换成空白</button>
          <button type="button" onClick={() => setConfirmBlank(false)}>取消</button>
        </div>
      )}
      {halls && (
        <section className="sc-planner-fold" aria-label="场景模板">
          <p className="sc-planner-note">{layout.scenePreset ? `正在用「${SCENE_PRESETS[layout.scenePreset].name}」。` : '点一个厅型，会换成那一块地。'}</p>
          <ScenePresetsPanel layout={layout} onApply={onApply} active={layout.scenePreset} />
        </section>
      )}
      {scans.length > 0 && (
        <section className="sc-planner-fold" aria-label="扫过的场地">
          <p className="sc-planner-note">这些是已经扫过的场地。</p>
          <ul>
            {scans.map(venue => (
              <li key={venue.assetId}>
                <button type="button" aria-pressed={venue.assetId === currentScanId} onClick={() => pickScan(venue)}>
                  {venue.name}<small>{describeScannedVenue(venue)}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {environment?.current && (
        <section className="sc-planner-fold" aria-label="当前实景">
          <button type="button" aria-expanded={scene} onClick={() => setScene(value => !value)}>
            {scene ? '收起实景' : `实景：${environment.current.name}`}
          </button>
          {scene && <EnvironmentPreview {...environment} />}
        </section>
      )}
      <button type="button" className="sc-planner-quiet" aria-expanded={walls} onClick={() => setWalls(value => !value)}>
        {walls ? '收起墙和门' : '改墙和门'}
      </button>
      {walls && <StructuralPropertiesPanel />}
    </div>
  );
}

function SizePair({ width, depth, onApply }: { width: number; depth: number; onApply(width: number, depth: number): void }): JSX.Element {
  const [wide, setWide] = useState(String(width));
  const [deep, setDeep] = useState(String(depth));
  useEffect(() => { setWide(String(width)); }, [width]);
  useEffect(() => { setDeep(String(depth)); }, [depth]);
  const commit = () => {
    const nextWide = Number(wide);
    const nextDeep = Number(deep);
    if (!Number.isFinite(nextWide) || nextWide <= 0) setWide(String(width));
    if (!Number.isFinite(nextDeep) || nextDeep <= 0) setDeep(String(depth));
    if (Number.isFinite(nextWide) && nextWide > 0 && Number.isFinite(nextDeep) && nextDeep > 0) onApply(nextWide, nextDeep);
  };
  return (
    <div className="sc-planner-size">
      <label>宽（米）<input aria-label="场地宽" inputMode="decimal" value={wide} onChange={event => setWide(event.target.value)} onBlur={commit} /></label>
      <label>深（米）<input aria-label="场地深" inputMode="decimal" value={deep} onChange={event => setDeep(event.target.value)} onBlur={commit} /></label>
    </div>
  );
}
