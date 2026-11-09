'use client';

import { useEffect, useRef, useState } from 'react';
import { preserveCurrentActivity } from '../../../lib/production-plan';
import { useHorizontalRail } from '../hooks/use-horizontal-rail';
import { BLANK_VENUE, createBlankVenue } from '../lib/blank-venue';
import { isUntouched } from '../lib/restore-point';
import { SCENE_PRESETS, type ScenePresetKey } from '../lib/scene-presets';
import { loadScenePreset } from '../three/scene-presets';
import type { RoomLayout } from '../lib/types';

interface Props {
  layout: RoomLayout;
  onApply(layout: RoomLayout): void;
  /** 当前画布正在用的模板：只在那一张上标「使用中」。 */
  active?: ScenePresetKey | undefined;
}

type RailChoice = ScenePresetKey | 'blank';

function keepsExecution(layout: RoomLayout): boolean {
  return layout.productionPlan !== undefined || layout.eventOperations !== undefined
    || layout.floors.some(floor => floor.items.some(item => item.handoff));
}

export function ScenePresetsPanel({ layout, onApply, active }: Props): JSX.Element {
  const current = useRef(layout);
  current.current = layout;
  const loading = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [busy, setBusy] = useState<RailChoice | null>(null);
  const [pending, setPending] = useState<RailChoice | null>(null);
  // 成功载入不在模板条底下占一行「已载入…」；失败才用 status 说原因。
  const [notice, setNotice] = useState('');
  const rail = useHorizontalRail<HTMLDivElement>();
  async function load(key: ScenePresetKey): Promise<void> {
    if (loading.current) return;
    const before = current.current;
    loading.current = true;
    setPending(null); setBusy(key); setNotice('');
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
    setPending(null); setBusy('blank'); setNotice('');
    try {
      onApply(createBlankVenue(before));
      setNotice('');
    } catch (error) { setNotice(error instanceof Error ? error.message : '空白空间没立起来，请重试。'); }
    finally { loading.current = false; setBusy(null); }
  }
  const choose = (choice: RailChoice): void => {
    if (choice === 'blank') loadBlank(); else void load(choice);
  };
  // A fresh plan can be replaced in one click; anything already worked on asks
  // on the card itself rather than through a browser dialog.
  const press = (choice: RailChoice) => {
    if (busy !== null) return;
    if (isUntouched(current.current)) { choose(choice); return; }
    setPending(choice);
  };
  const confirmCopy = (choice: RailChoice): string => choice === 'blank'
    ? `会清空当前布置换成空地${keepsExecution(current.current) ? '；活动需求和任务保留' : ''}。`
    : keepsExecution(current.current) ? '活动需求和任务会保留。' : '会替换当前布置。';
  return <section className="sc-preset-board" aria-label="场景预设">
    <div ref={rail.setRef} onKeyDown={rail.onKeyDown} className="sc-preset-rail" role="group" aria-label="场景模板" tabIndex={0}>
      <div className="sc-preset-tile" key="blank">
        <button className="sc-preset-card" type="button" disabled={busy !== null} onClick={() => press('blank')}
          aria-label={`载入空白空间 ${BLANK_VENUE.width} × ${BLANK_VENUE.depth} 米`} title="从一块能改尺寸的空地开始，不带模板场馆">
          <span className="sc-preset-blank" aria-hidden="true"><small>{BLANK_VENUE.width} × {BLANK_VENUE.depth} m · 可改尺寸</small></span>
          <strong>空白空间</strong>
        </button>
        {pending === 'blank' && <div className="sc-preset-confirm" role="group" aria-label="确认换成空白空间">
          <p>{confirmCopy('blank')}</p>
          <div><button type="button" className="is-go" onClick={choose.bind(null, 'blank')}>确认换成</button>
          <button type="button" onClick={() => setPending(null)}>取消</button></div>
        </div>}
      </div>
      <div className="sc-preset-tile">
        <a className="sc-preset-card" href="/review/?example=sharing" target="_blank" rel="noopener noreferrer" aria-label="打开分享会示例预览（新窗口）">
          <svg viewBox="0 0 120 80" aria-hidden="true" style={{width:'100%',height:'100%',minHeight:0,background:'#F4F5F7'}}>
            <rect x="67" y="6" width="30" height="5" fill="#4A7C59"/><rect x="74" y="17" width="16" height="6" fill="#C9B89D"/>
            {[33,45,72,84].flatMap(x=>[32,42,52,62].map(y=><rect key={`${x}-${y}`} x={x} y={y} width="6" height="6" rx="1" fill="#4A7C59"/>))}
          </svg>
          <strong>分享会示例</strong>
        </a>
      </div>
      <div className="sc-preset-tile">
        <a className="sc-preset-card" href="/review/?example=hall-d5" target="_blank" rel="noopener noreferrer" aria-label="打开 Hall D5 尺寸参考预览（新窗口）">
          <span className="sc-preset-blank" aria-hidden="true"><small>16.5 × 17.2 m · 轮廓示意</small></span>
          <strong>Hall D5 尺寸参考</strong>
        </a>
      </div>
      {(Object.keys(SCENE_PRESETS) as ScenePresetKey[]).map(key => <div className="sc-preset-tile" key={key}>
        <button className={`sc-preset-card${active === key ? ' is-current' : ''}`} type="button" disabled={busy !== null} onClick={() => press(key)}
          aria-label={`载入模板 ${SCENE_PRESETS[key].name}`} aria-current={active === key ? 'true' : undefined} title={SCENE_PRESETS[key].description}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/scene-presets/${key}/preview.jpg`} alt=""/>
          <strong>{SCENE_PRESETS[key].name}</strong>
        </button>
        {active === key && <span className="sc-preset-now">使用中</span>}
        {pending === key && <div className="sc-preset-confirm" role="group" aria-label={`确认载入${SCENE_PRESETS[key].name}`}>
          <p>{confirmCopy(key)}</p>
          <div><button type="button" className="is-go" onClick={() => { void load(key); }}>确认载入</button>
          <button type="button" onClick={() => setPending(null)}>取消</button></div>
        </div>}
      </div>)}
    </div>
    {notice && <p className="sc-note sc-preset-notice" role="status">{notice}</p>}
  </section>;
}
