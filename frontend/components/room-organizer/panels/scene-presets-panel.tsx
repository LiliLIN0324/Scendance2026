'use client';

import { useEffect, useRef, useState } from 'react';
import { preserveCurrentActivity } from '../../../lib/production-plan';
import { useHorizontalRail } from '../hooks/use-horizontal-rail';
import { BLANK_VENUE, createBlankVenue } from '../lib/blank-venue';
import { SCENE_PRESETS, type ScenePresetKey } from '../lib/scene-presets';
import { loadScenePreset } from '../three/scene-presets';
import type { RoomLayout } from '../lib/types';

interface Props {
  layout: RoomLayout;
  onApply(layout: RoomLayout): void;
  /**
   * 2026-11-16：有当前户外地图时，场景卡不再替换整张图，而是把整馆作为一个
   * 小场地设施交给现有的落位通道（幽灵 → 单击地面 → 2D/3D 同一件）。
   * 返回 false 表示当前没有可落位的地图，本面板不退回“替换当前布置”。
   */
  onPlace?(key: ScenePresetKey): boolean;
  /** 当前画布正在用的模板：只在那一张上标「使用中」。 */
  active?: ScenePresetKey | undefined;
}

type RailChoice = ScenePresetKey | 'blank';

export function ScenePresetsPanel({ layout, onApply, onPlace, active }: Props): JSX.Element {
  const current = useRef(layout);
  current.current = layout;
  const loading = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [busy, setBusy] = useState<RailChoice | null>(null);
  // 成功载入不在模板条底下占一行「已载入…」；失败才用 status 说原因。
  const [notice, setNotice] = useState('');
  const rail = useHorizontalRail<HTMLDivElement>();
  async function load(key: ScenePresetKey): Promise<void> {
    if (loading.current) return;
    const before = current.current;
    loading.current = true;
    setBusy(key); setNotice('');
    try {
      const next = await loadScenePreset(key);
      if (!mounted.current) return;
      if (current.current !== before) throw new Error('载入期间画布已有改动，已保留当前草稿。请重新载入预设。');
      onApply(preserveCurrentActivity(before,{ ...next, ...(before.id ? { id: before.id, name: before.name } : {}) }));
      setNotice('');
    } catch (error) { setNotice(error instanceof Error ? error.message : '场景载入失败，请重试。'); }
    finally { loading.current = false; setBusy(null); }
  }
  /** 空地不下载模型：直接换上可改尺寸的矩形壳，和说「12×9」立壳是同一种场地真相。 */
  function loadBlank(): void {
    if (loading.current) return;
    const before = current.current;
    loading.current = true;
    setBusy('blank'); setNotice('');
    try {
      onApply(createBlankVenue(before));
      setNotice('');
    } catch (error) { setNotice(error instanceof Error ? error.message : '空白空间没立起来，请重试。'); }
    finally { loading.current = false; setBusy(null); }
  }
  const choose = (choice: RailChoice): void => {
    if (choice === 'blank') loadBlank();
    else void load(choice);
  };
  const press = (choice: RailChoice) => {
    if (busy !== null) return;
    choose(choice);
  };
  const place = (key: ScenePresetKey) => {
    if (busy !== null) return;
    if (!onPlace) {
      choose(key);
      return;
    }
    const armed = onPlace(key);
    setNotice(armed ? '' : '当前没有打开的户外地图，先打开 2D 或 3D 场地再摆放。');
  };
  return <section className="sc-preset-board" aria-label="场景预设">
    <div ref={rail.setRef} onKeyDown={rail.onKeyDown} className="sc-preset-rail" role="group" aria-label="场景模板" tabIndex={0}>
      {!onPlace && <div className="sc-preset-tile" key="blank">
        <button className="sc-preset-card" type="button" disabled={busy !== null} onClick={() => press('blank')}
          aria-label={`载入空白空间 ${BLANK_VENUE.width} × ${BLANK_VENUE.depth} 米`} title="从一块能改尺寸的空地开始，不带模板场馆">
          <span className="sc-preset-blank" aria-hidden="true"><small>{BLANK_VENUE.width} × {BLANK_VENUE.depth} m · 可改尺寸</small></span>
          <strong>空白空间</strong>
        </button>
      </div>}
      {(Object.keys(SCENE_PRESETS) as ScenePresetKey[]).map(key => <div className="sc-preset-tile" key={key}>
        <button className={`sc-preset-card${active === key ? ' is-current' : ''}`} type="button" disabled={busy !== null} onClick={() => place(key)}
          aria-label={onPlace ? `摆放模板 ${SCENE_PRESETS[key].name}` : `载入模板 ${SCENE_PRESETS[key].name}`} aria-current={active === key ? 'true' : undefined} title={onPlace ? `摆放到当前地图：${SCENE_PRESETS[key].description}` : SCENE_PRESETS[key].description}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/scene-presets/${key}/preview.jpg`} alt=""/>
          <strong>{SCENE_PRESETS[key].name}</strong>
        </button>
        {active === key && <span className="sc-preset-now">使用中</span>}
      </div>)}
    </div>
    {notice && <p className="sc-note sc-preset-notice" role="status">{notice}</p>}
  </section>;
}
