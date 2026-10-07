'use client';

import { useEffect, useRef, useState } from 'react';
import { isUntouched } from '../lib/restore-point';
import { SCENE_PRESETS, type ScenePresetKey } from '../lib/scene-presets';
import { loadScenePreset } from '../three/scene-presets';
import { VenueShapePresets } from './venue-shape-presets';
import type { RoomLayout } from '../lib/types';

interface Props {
  layout: RoomLayout;
  onApply(layout: RoomLayout): void;
}

export function ScenePresetsPanel({ layout, onApply }: Props): JSX.Element {
  const current = useRef(layout);
  current.current = layout;
  const loading = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [busy, setBusy] = useState<ScenePresetKey | null>(null);
  const [notice, setNotice] = useState('');
  async function load(key: ScenePresetKey): Promise<void> {
    if (loading.current) return;
    const before = current.current;
    const hasExecution = before.eventOperations !== undefined || before.floors.some(floor => floor.items.some(item => item.handoff));
    if (!isUntouched(before) && !window.confirm(hasExecution
      ? '载入模板将替换当前布置。活动需求和任务会保留，关联物料需重新核对；原布置与物料工作单可用撤销恢复。继续吗？'
      : '载入模板将替换当前布置，可用撤销恢复。继续吗？')) return;
    loading.current = true;
    setBusy(key); setNotice('');
    try {
      const next = await loadScenePreset(key);
      if (!mounted.current) return;
      if (current.current !== before) throw new Error('载入期间画布已有改动，已保留当前草稿。请重新载入预设。');
      onApply({ ...next, ...(before.id ? { id: before.id, name: before.name } : {}),
        ...(before.eventOperations !== undefined ? { eventOperations: before.eventOperations } : {}) });
      setNotice(`已载入${SCENE_PRESETS[key].name}，可选择物件继续编辑。`);
    } catch (error) { setNotice(error instanceof Error ? error.message : '场景载入失败，请重试。'); }
    finally { loading.current = false; setBusy(null); }
  }
  return <section aria-label="场景预设">
    <div className="sc-section-heading"><div><h2>场景预设</h2><p>从完整方案开始，继续布置</p></div></div>
    <VenueShapePresets layout={layout} onApply={onApply}/>
    <div className="sc-preset-list">
      {(Object.keys(SCENE_PRESETS) as ScenePresetKey[]).map(key => <button className="sc-preset-card" key={key} type="button" disabled={busy !== null} onClick={() => { void load(key); }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/scene-presets/${key}/preview.jpg`} alt=""/>
        <span><strong>{SCENE_PRESETS[key].name}</strong><small>{SCENE_PRESETS[key].description}</small><b>{busy === key ? '正在载入…' : '载入工作台 ↗'}</b></span>
      </button>)}
    </div>
    <p className="sc-note">桌椅、展台和人物可移动、旋转、缩放、复制、删除。场馆结构固定，屋顶隐藏以便编辑。</p>
    <p className="sc-note">预设改动自动保存在此浏览器；使用 Binggo 时会自动连接云项目，可继续 AI 修改和云保存。场地尺寸与人数为概念方案。</p>
    {notice && <p className="sc-note" role="status">{notice}</p>}
  </section>;
}
