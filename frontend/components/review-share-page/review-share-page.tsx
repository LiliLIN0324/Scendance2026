'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { randomId } from '../room-organizer/lib/ids';
import {
  pinSubject,
  type ReviewPin,
  type ReviewPinDraft,
} from '../room-organizer/lib/review-pins';
import { floorElevation } from '../room-organizer/lib/storeys';
import { isStructuralMarker } from '../room-organizer/lib/structural-layout';
import {
  loadReviewPlan,
  readLocalReviewLayout,
  REVIEW_PLAN_ERRORS,
  type LoadedReviewPlan,
} from './load-plan';
import { itemNames, ReviewPlanSheet } from './review-plan-sheet';
import { ReviewSiteMap } from './review-site-canvas';
import { filterPlanByLevel, planLevels } from '../room-organizer/lib/plan-levels';
import type { ReviewBasemap } from './review-access';
import { markReviewReturned, readReviewReturn, REVIEW_RETURN_STORAGE_KEY } from './review-return';
import { appendReviewPinCloud, listReviewPinsCloud } from './review-pins-cloud';
import {
  appendReviewSharePin,
  readReviewSharePins,
  readExactReviewSharePins,
} from './share-pins';
import type { FurnitureItem } from '../room-organizer/lib/types';
import { createReviewFeedbackReceipt, inspectReviewFeedbackReceipt, reviewVersionForHash, type ReceiptPin } from './review-feedback-receipt';

const PIN_ERRORS = {
  text: '请写一句意见，最多 80 个字。',
  full: '这份方案已有 80 条意见，新的意见没有保存。',
  storage: '浏览器没有收下这条钉。',
  plan: '这条钉没有对应的方案，没有保存。',
  draft: '落钉位置无效，请再点一次平面。',
  unknown: '意见可能已保存，请刷新核对后再操作，暂不要重复提交。',
} as const;

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; plan: LoadedReviewPlan };

export function ReviewSharePage(): JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [floorIndex, setFloorIndex] = useState(0);
  const [pins, setPins] = useState<ReviewPin[]>([]);
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [pinDraft, setPinDraft] = useState<ReviewPinDraft | null>(null);
  // 户外钉：ENU 米制点，与楼层钉分开；floorId='outdoor' 作为存储标记。
  const [outdoorDraft, setOutdoorDraft] = useState<{ x: number; y: number } | null>(null);
  const [outdoorText, setOutdoorText] = useState('');
  const [pinError, setPinError] = useState('');
  // G3：只看链接（?view=1）能看方案与历史钉，但不能新增意见或回复。
  const [viewOnly, setViewOnly] = useState(false);
  const [levelId, setLevelId] = useState<string | null>(null);
  const [basemap, setBasemap] = useState<ReviewBasemap>('map');
  const [syncNote, setSyncNote] = useState('');
  // 访客署名：只存在本机，随钉一起带给创作者；不强制登录。
  const [author, setAuthor] = useState('');
  const [returned, setReturned] = useState(false);
  const [returnNote, setReturnNote] = useState('');
  const [planVersion,setPlanVersion]=useState<string|null>(null);
  const [exportNote,setExportNote]=useState('');
  const [pinsUsable,setPinsUsable]=useState(true);
  const linkHashRef=useRef<string|null>(null),canonicalHashRef=useRef<string|null>(null),pinWritePending=useRef(false);

  useEffect(() => {
    const readViewOnly = () => setViewOnly(new URLSearchParams(window.location.search).get('view') === '1');
    readViewOnly();
    window.addEventListener('hashchange', readViewOnly);
    return () => window.removeEventListener('hashchange', readViewOnly);
  }, []);

  useEffect(() => {
    let active = true;
    let ticket = 0;
    const load = () => {
      const current = ++ticket;
      linkHashRef.current=null;canonicalHashRef.current=null;
      setPhase({ kind: 'loading' });
      setPlanVersion(null);setExportNote('');setPinsUsable(true);setSyncNote('');
      const shareHash=window.location.hash;
      const example=new URLSearchParams(window.location.search).get('example');
      const isolatedExample=!shareHash && (example==='sharing'||example==='hall-d5');
      const localLayout = isolatedExample ? null : readLocalReviewLayout(safeStorage());
      if (!isolatedExample) {
        try { setAuthor(window.localStorage.getItem('scendance-review-author') ?? ''); } catch { /* 忽略不可用存储 */ }
      }
      void loadReviewPlan({
        hash: shareHash,
        search: window.location.search,
        pathname: window.location.pathname,
        localLayout,
      }).then(async (result) => {
        if (!active || current !== ticket) return;
        setFloorIndex(0);
        setLevelId(result.ok ? result.plan.reviewAccess.levelId : null);
        setBasemap(result.ok ? result.plan.reviewAccess.basemapStyle : 'map');
        setPinDraft(null);
        setActivePinId(null);
        setPinError('');
        if (!result.ok) {
          setPhase({ kind: 'error', message: REVIEW_PLAN_ERRORS[result.reason] });
          setPins([]);
          return;
        }
        let currentPlan=result.plan;
        if(currentPlan.planKey==='sample:sharing'||currentPlan.planKey==='sample:hall-d5'){
          setPins([]);setReturned(false);setReturnNote('');setPhase({kind:'ready',plan:currentPlan});return;
        }
        if(currentPlan.source==='link'){
          const canonical=currentPlan.shareHash;
          if(canonical){
            try {const version=await reviewVersionForHash(canonical);if(!active||current!==ticket)return;
              currentPlan={...currentPlan,planKey:`review-v2:${version.slice(7)}`};linkHashRef.current=reviewLocationToken();canonicalHashRef.current=canonical;setPlanVersion(version);
            } catch {if(!active||current!==ticket)return;setExportNote('无法核对分享版本，暂不能保存或导出反馈。');}
          }else if(active&&current===ticket)setExportNote('无法核对分享版本，暂不能保存或导出反馈。');
        }
        if(currentPlan.source==='link'&&currentPlan.planKey.startsWith('review-v2:')){
          try {const storage=safeStorage();if(!storage)throw new Error();setPins(readExactReviewSharePins(currentPlan.planKey,storage));}
          catch {setPins([]);setPinsUsable(false);setPinError('本机反馈无法完整读取，请保留原记录，暂不能修改或导出。');}
        }else setPins(currentPlan.source==='link'||currentPlan.planKey==='sample:sharing'||currentPlan.planKey==='sample:hall-d5'?[]:readReviewSharePins(currentPlan.planKey,safeStorage()));
        if(currentPlan.source==='link'&&currentPlan.planKey.startsWith('review-v2:')){
          void listReviewPinsCloud(currentPlan.planKey).then(remote=>{
            if(!active||current!==ticket||!remote.ok||!remote.value.length)return;
            setPins(prev=>{const seen=new Set(prev.map(pin=>pin.id));return [...prev,...remote.value.filter(pin=>!seen.has(pin.id))];});
          });
        }
        const storage=safeStorage();
        const receipt = readReviewReturn(storage&&currentPlan.source==='link'?versionedReturnStorage(storage,currentPlan.planKey):storage);
        const already = receipt?.planKey === currentPlan.planKey;
        setReturned(already);
        setReturnNote(already ? currentPlan.source==='link'?'这份方案已记下完成，请导出反馈文件交给方案创建者。':'这台浏览器已记录完成。' : '');
        setPhase({ kind: 'ready', plan: currentPlan });
      });
    };
    load();
    window.addEventListener('hashchange', load);
    return () => {
      active = false;
      ticket += 1;
      linkHashRef.current=null;canonicalHashRef.current=null;
      window.removeEventListener('hashchange', load);
    };
  }, []);

  const plan = phase.kind === 'ready' ? phase.plan : null;
  const exampleOnly=plan?.planKey==='sample:sharing'||plan?.planKey==='sample:hall-d5';
  const floor = plan ? plan.layout.floors[floorIndex] ?? plan.layout.floors[0] : undefined;
  const legend = floor ? itemLegend(floor.items) : { rows: [], hidden: 0 };
  const outdoorMode = !!plan?.outdoorPlan;
  const levels = plan?.outdoorPlan ? planLevels(plan.outdoorPlan) : [];
  const access = plan?.reviewAccess;
  const activeLevelId = access && !access.levels && access.levelId && levels.some(level => level.id === access.levelId)
    ? access.levelId
    : (levelId && levels.some(level => level.id === levelId) ? levelId : levels[0]?.id ?? '');
  const shownOutdoor = plan?.outdoorPlan ? filterPlanByLevel(plan.outdoorPlan, activeLevelId) : null;
  const shownBasemap: ReviewBasemap = access && !access.basemap ? access.basemapStyle : basemap;
  const canPin = !viewOnly && (access?.pins !== false) && !exampleOnly;
  const outdoorPins = outdoorMode ? pins.filter(pin => (pin as ReviewPin & { floorId?: string }).floorId === 'outdoor') : [];
  const floorPins = outdoorMode ? pins.filter(pin => (pin as ReviewPin & { floorId?: string }).floorId !== 'outdoor') : pins;
  const pinNumbers = useMemo(() => new Map(pins.map((pin, index) => [pin.id, index + 1])), [pins]);

  const openPinDraft = useCallback((pick: { itemId: string | null; x: number; z: number }) => {
    if (!plan || !floor || exampleOnly || viewOnly || !plan.reviewAccess.pins) return;
    const floorY = floorElevation(plan.layout.floors, floorIndex);
    const item = pick.itemId ? floor.items.find((entry) => entry.id === pick.itemId) : null;
    const origin = item?.position ? { x: item.position.x, y: floorY, z: item.position.z } : null;
    const offset = origin ? [pick.x - origin.x, floorY - origin.y, pick.z - origin.z] as const : null;
    const camera = {
      position: [pick.x + 2.4, floorY + 2.8, pick.z + 2.4] as const,
      target: [pick.x, floorY, pick.z] as const,
    };
    setPinError('');
    setPinDraft({ itemId: pick.itemId, x: pick.x, y: floorY, z: pick.z, offset, camera });
  }, [plan, floor, floorIndex, exampleOnly, viewOnly]);

  const openOutdoorPinDraft = useCallback((point: { x: number; y: number }) => {
    if (!plan?.outdoorPlan || viewOnly || !plan.reviewAccess.pins) return;
    setPinError('');
    setOutdoorText('');
    setOutdoorDraft(point);
  }, [plan, viewOnly]);

  const commitOutdoorPin = useCallback(async (text: string) => {
    if (!plan?.outdoorPlan || !outdoorDraft || viewOnly || !plan.reviewAccess.pins) return;
    const storage = safeStorage();
    if (!storage) { setPinError(PIN_ERRORS.storage); return; }
    const draft = {
      itemId: null,
      x: outdoorDraft.x,
      y: 0,
      z: outdoorDraft.y,
      offset: null,
      camera: { position: [outdoorDraft.x, 12, outdoorDraft.y + 12] as const, target: [outdoorDraft.x, 0, outdoorDraft.y] as const },
    };
    const result = appendReviewSharePin(storage, {
      planKey: plan.planKey,
      text,
      draft,
      id: randomId('pin'),
      floorId: 'outdoor',
    });
    if (!result.ok) { setPinError(PIN_ERRORS[result.reason] ?? PIN_ERRORS.text); return; }
    setPins(result.pins);
    if (plan.source === 'link' && plan.planKey.startsWith('review-v2:')) {
      void appendReviewPinCloud({ shareKey: plan.planKey, pin: result.pin, floorId: 'outdoor', author }).then(remote => {
        setSyncNote(remote.ok ? '' : cloudSyncFailure(remote.reason));
      });
    }
    setActivePinId(result.pin.id);
    setOutdoorDraft(null);
    setOutdoorText('');
    setPinError('');
  }, [plan, outdoorDraft, viewOnly, author]);

  const commitPin = useCallback(async (text: string) => {
    if (!plan || !pinDraft || !floor || pinWritePending.current || viewOnly || !plan.reviewAccess.pins) return;
    if(plan.source==='link'&&(!planVersion||!pinsUsable)){setPinError('无法完整核对本机反馈，未保存新意见。');return;}
    const capturedHash=linkHashRef.current;
    if(plan.source==='link'&&(!capturedHash||reviewLocationToken()!==capturedHash)){setPinError('分享版本已变化，未保存意见。');return;}
    const storage = safeStorage();
    if (!storage) {
      setPinError(PIN_ERRORS.storage);
      return;
    }
    const write=()=>appendReviewSharePin(storage, {
      planKey: plan.planKey,
      text,
      draft: pinDraft,
      id: randomId('pin'),
      floorId: floor.id,
    });
    let result:ReturnType<typeof appendReviewSharePin>;pinWritePending.current=true;
    try{
    if(plan.source==='link'){
      try {
        if(!navigator.locks?.request)throw new Error();
        result=await navigator.locks.request('scendance:review-feedback-pins',{ifAvailable:true},lock=>{
          if(!lock||linkHashRef.current!==capturedHash||reviewLocationToken()!==capturedHash)throw new Error();return write();
        });
      }catch{setPinError(linkHashRef.current!==capturedHash||reviewLocationToken()!==capturedHash?'分享版本已变化，未保存意见。':'本机评审正在另一页面修改或无法安全协调，请稍后重试。');return;}
    } else result=write();
    if(plan.source==='link'&&(linkHashRef.current!==capturedHash||reviewLocationToken()!==capturedHash))return;
    if (!result.ok) {
      if(result.reason==='unknown')setPinsUsable(false);
      setPinError(PIN_ERRORS[result.reason] ?? PIN_ERRORS.text);
      return;
    }
    setPins(result.pins);
    if(plan.source==='link'&&plan.planKey.startsWith('review-v2:')){
      void appendReviewPinCloud({shareKey:plan.planKey,pin:result.pin,floorId:floor.id,author}).then(remote => {
        setSyncNote(remote.ok ? '' : cloudSyncFailure(remote.reason));
      });
    }
    setActivePinId(result.pin.id);
    setPinDraft(null);
    setPinError('');
    }finally{pinWritePending.current=false;}
  }, [plan, pinDraft, floor?.id, planVersion, pinsUsable]);

  const onComplete = () => {
    if (!plan) return;
    if(plan.source==='link'&&(!planVersion||!pinsUsable)){setReturnNote('无法完整核对本机反馈，未记下完成。');return;}
    if(plan.source==='link'&&(!linkHashRef.current||reviewLocationToken()!==linkHashRef.current)){setReturnNote('分享版本已变化，未记下完成。');return;}
    const storage = safeStorage();
    if (!storage) {
      setReturnNote('这台浏览器没有记下完成。');
      return;
    }
    const receiptStorage=plan.source==='link'?versionedReturnStorage(storage,plan.planKey):storage;
    try{
      const prior=receiptStorage.getItem(REVIEW_RETURN_STORAGE_KEY);
      if(prior!==null&&readReviewReturn(receiptStorage)?.planKey!==plan.planKey){setReturnNote('原完成记录无法核对，已保留，未写入。');return;}
    }catch{setReturnNote('原完成记录无法读取，未写入。');return;}
    const result = markReviewReturned(receiptStorage, { planKey: plan.planKey });
    if (!result.ok) {
      setReturnNote('完成状态可能已写入，请刷新核对后再操作。');
      return;
    }
    if(readReviewReturn(receiptStorage)?.planKey!==plan.planKey){setReturnNote('完成记录未能核实，未标为完成。');return;}
    setReturned(true);
    setReturnNote(plan.source==='link'?'已记下完成，请导出反馈文件交给方案创建者。':'这台浏览器已记录完成。');
  };

  const exportFeedback=async()=>{
    if(!planVersion||!plan||!pinsUsable||!linkHashRef.current||reviewLocationToken()!==linkHashRef.current){setExportNote('请使用完整分享链接并核对本机反馈后再导出。');return;}
    try {
      const storage=safeStorage();if(!storage||JSON.stringify(readExactReviewSharePins(plan.planKey,storage))!==JSON.stringify(pins))throw new Error('反馈已变化');
      if((readReviewReturn(versionedReturnStorage(storage,plan.planKey))?.planKey===plan.planKey)!==returned)throw new Error('评审完成状态已变化');
      const json=createReviewFeedbackReceipt(planVersion,pins as ReceiptPin[],returned);
      const canonical=canonicalHashRef.current;if(!canonical)throw new Error('缺少规范分享版本');
      await inspectReviewFeedbackReceipt(json,canonical);
      if(canonicalHashRef.current!==canonical||reviewLocationToken()!==linkHashRef.current||JSON.stringify(readExactReviewSharePins(plan.planKey,storage))!==JSON.stringify(pins)||
        (readReviewReturn(versionedReturnStorage(storage,plan.planKey))?.planKey===plan.planKey)!==returned)throw new Error('反馈已变化');
      const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
      try {const link=document.createElement('a');link.href=url;link.download='方案评审反馈.json';link.click();}
      finally {URL.revokeObjectURL(url);}
      setExportNote('已发起下载，请将反馈文件发给方案创建者。已经送到审校的意见，对方打开 Bingo 也能看到。');
    } catch {setExportNote('反馈未能导出，请检查浏览器下载权限并保留本页。');}
  };

  return (
    <main className="rsp" data-review-share-page="true" data-review-source={plan?.source ?? phase.kind}>
      <header className="rsp-mast">
        <p className="rsp-brand"><span>幕景</span><small className="sc-brand-en">Scendance</small></p>
        <p className="rsp-mast-status">{exampleOnly?'示例预览 · 只读':'客户评审 · 只读'}</p>
      </header>
      {phase.kind === 'loading' ? (
        <section className="rsp-state" role="status"><h1>正在打开方案</h1><p>正在读取平面。</p></section>
      ) : phase.kind === 'error' ? (
        <section className="rsp-state" role="alert"><h1>评审链接没有打开</h1><p>{phase.message}</p></section>
      ) : plan && floor ? (
        <div className="rsp-shell">
          <section className="rsp-intro" aria-labelledby="rsp-plan-title">
            <div className="rsp-intro-main">
              <p className="rsp-kicker">方案评审</p>
              <h1 id="rsp-plan-title">{plan.layout.name}</h1>
              {!outdoorMode && <p className="rsp-meta">{metres(plan.layout.width)} × {metres(plan.layout.height)} 米 · {floor.name} · 平面上 {placedCount(floor.items)} 件</p>}
            </div>
            <div className="rsp-intro-side">
              {plan.identity && (
                <p className="rsp-version" data-delivery-version={plan.identity.deliveryVersion} data-snapshot-id={plan.identity.snapshotId}>
                  <b>{plan.identity.deliveryVersion}</b>
                  <span>{plan.identity.status === 'confirmed' ? '已确认的交付版' : '草案版'}</span>
                  <small>
                    快照 {plan.identity.snapshotId} · {plan.identity.verified
                      ? '内容与快照一致，旧链接一直指着这一版'
                      : '内容与快照对不上，请让分享者重新生成链接'}
                  </small>
                </p>
              )}
              <p className="rsp-notice">{plan.notice}</p>
            </div>
          </section>
          <div className="rsp-workspace">
            <section className="rsp-stage" aria-label="方案平面">
              <div className="rsp-stage-bar">
                {!outdoorMode && plan.layout.floors.length > 1 && (
                  <div className="rsp-floors" role="group" aria-label="楼层">
                    {plan.layout.floors.map((entry, index) => (
                      <button key={entry.id} type="button" aria-pressed={entry.id === floor.id} onClick={() => { setFloorIndex(index); setPinDraft(null); }}>{entry.name}</button>
                    ))}
                  </div>
                )}
                {!exampleOnly && !outdoorMode && (
                  <p className="rsp-stage-tip" role="status">{pins.length === 0 ? '点平面任意位置，落一条意见' : '点钉查看意见'}</p>
                )}
              </div>
              {plan.planKey==='sample:hall-d5' && <p className="rsp-source"><a href="https://www.t-i-forum.co.jp/en/facilities/d5/" target="_blank" rel="noopener noreferrer">查看场地方官方资料</a></p>}
            {shownOutdoor && (
              <section className="rsp-outdoor" aria-label="户外方案">
                {canPin && <p className="rsp-review-hint" role="status">点地图落一条意见。滚轮缩放，拖拽平移。</p>}
                <ReviewSiteMap
                  plan={shownOutdoor}
                  levelId={activeLevelId}
                  canSwitchLevel={access?.levels !== false}
                  onLevel={setLevelId}
                  basemap={shownBasemap}
                  canSwitchBasemap={access?.basemap !== false}
                  onBasemap={setBasemap}
                  pins={outdoorPins}
                  pinNumbers={pinNumbers}
                  activePinId={activePinId}
                  canPin={canPin}
                  onPick={openOutdoorPinDraft}
                  onFocusPin={setActivePinId}
                />
                {outdoorDraft && (
                  <div className="rsp-draft">
                    <span className="rsp-draft-point">钉在 {outdoorDraft.x.toFixed(1)}, {outdoorDraft.y.toFixed(1)} m</span>
                    <input autoFocus value={outdoorText} maxLength={80} aria-label="户外钉评内容" placeholder="这里要改什么？" onChange={event => setOutdoorText(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void commitOutdoorPin(outdoorText); } else if (event.key === 'Escape') { setOutdoorDraft(null); } }} />
                    <button type="button" disabled={!outdoorText.trim()} onClick={() => { void commitOutdoorPin(outdoorText); }}>钉下</button>
                    <button type="button" onClick={() => setOutdoorDraft(null)}>取消</button>
                  </div>
                )}
              </section>
            )}
            {!outdoorMode && <div className="rsp-sheet rsp-sheet-interactive">
              <ReviewPlanSheet
                layout={plan.layout}
                floor={floor}
                floorIndex={floorIndex}
                pins={floorPins}
                activePinId={activePinId}
                pinDraft={pinDraft}
                onAnchor={openPinDraft}
                onFocusPin={setActivePinId}
                onCommitPin={commitPin}
                onCancelPin={() => setPinDraft(null)}
              />
            </div>}
            {!outdoorMode && <div className="rsp-legend">
              <h2>场内物件</h2>
              {legend.rows.length === 0 ? <p>这一层平面上还没有物件。</p> : (
                <ul>
                  {legend.rows.map((row) => (
                    <li key={`${row.name}-${row.color}`}>
                      <span className="rsp-swatch" style={{ backgroundColor: swatch(row.color) }} aria-hidden="true" />
                      <span>{row.count > 1 ? `${row.name} × ${row.count}` : row.name}</span>
                    </li>
                  ))}
                </ul>
              )}
              {legend.hidden > 0 && <p className="rsp-zones">还有 {legend.hidden} 种物件，都画在平面上。</p>}
              {(floor.zones ?? []).length > 0 && (
                <p className="rsp-zones">分区：{(floor.zones ?? []).map((zone) => zone.name).join('、')}</p>
              )}
            </div>}
          </section>
          {!exampleOnly && <aside className="rsp-rail" aria-labelledby="rsp-comments-title">
            <div className="rsp-rail-head">
              <div className="rsp-rail-title"><h2 id="rsp-comments-title">意见</h2><span>{pins.length}</span></div>
              <label className="rsp-author">
                <span>你的称呼</span>
                <input value={author} maxLength={24} placeholder="选填，方便对方知道是谁" onChange={event => { const value = event.currentTarget.value; setAuthor(value); try { window.localStorage.setItem('scendance-review-author', value); } catch { /* 忽略 */ } }} />
              </label>
              <p className="rsp-persist">{syncNote || (plan.source === 'link' ? '意见会回到方案的审校里。' : '这是本机预览。发给客户的短链上，意见才会回到审校。')}</p>
            </div>
            <div className="rsp-rail-list">
              {pins.length === 0 ? (
                <p className="rsp-empty">还没有意见。在左侧平面上点一下，写下要改的地方。</p>
              ) : (
                <ol className="rsp-pin-list">
                  {pins.map((pin) => {
                    const on = activePinId === pin.id;
                    return (
                      <li key={pin.id} className={on ? 'is-on' : ''}>
                        <button
                          type="button"
                          className="rsp-pin-go"
                          aria-pressed={on}
                          onClick={() => setActivePinId(pin.id)}
                        >
                          <b aria-hidden="true">{pinNumbers.get(pin.id)}</b>
                          <span>
                            <strong>{pin.text}</strong>
                            <small>{(pin as ReviewPin & { author?: string }).author || pinSubject(pin.itemId, itemNames(floor.items))}</small>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
              {(viewOnly || access?.pins === false) && <p className="rsp-form-note" role="status">这是只看链接：可以查看方案与已有意见，不能新增。</p>}
              {pinError && <p className="rsp-form-error" role="alert">{pinError}</p>}
            </div>
            <div className="rsp-rail-foot">
              <div className="rsp-actions">
                <button type="button" className="rsp-primary" onClick={onComplete}>{returned ? '已完成评审' : '完成评审'}</button>
                <button type="button" className="rsp-backup" onClick={exportFeedback} disabled={!planVersion||!pinsUsable}>导出备份</button>
              </div>
              {exportNote && <p className="rsp-status" role="status">{exportNote}</p>}
              <p className="rsp-status" role="status">{returnNote || (plan.source==='link' ? '意见会回到方案的审校里。' : '这是本机预览，意见不会送到审校。')}</p>
            </div>
          </aside>}
          </div>
        </div>
      ) : (
        <section className="rsp-state" role="alert"><h1>方案没有可看的楼层</h1><p>这份快照里没有楼层，平面没有展开。</p></section>
      )}
    </main>
  );
}

function reviewLocationToken(): string {
  return `${window.location.pathname}${window.location.hash}`;
}

function cloudSyncFailure(reason: string): string {
  if (reason === 'disabled') return '评审服务没接上，这条意见只留在这台浏览器，对方的审校里看不到。';
  return '这条意见没有送到审校。请检查网络后再钉一次，或先导出备份。';
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function versionedReturnStorage(storage:Storage,planKey:string):Pick<Storage,'getItem'|'setItem'> {
  return {getItem:key=>storage.getItem(key===REVIEW_RETURN_STORAGE_KEY?`${key}:${planKey}`:key),
    setItem:(key,value)=>storage.setItem(key===REVIEW_RETURN_STORAGE_KEY?`${key}:${planKey}`:key,value)};
}

function placedCount(items: readonly FurnitureItem[]): number {
  // 与工作台 materialCount 同一口径：门/柱/出入口是场地真相，不计物料件数。
  return items.filter((item) => item.position && !isStructuralMarker(item)).length;
}

function itemLegend(items: readonly FurnitureItem[]): { rows: { name: string; color: string; count: number }[]; hidden: number } {
  const rows = new Map<string, { name: string; color: string; count: number }>();
  for (const item of items) {
    if (!item.position) continue;
    const name = item.name.trim() || '未命名物件';
    const color = item.color;
    const key = `${name}\0${color}`;
    const current = rows.get(key);
    if (current) current.count += 1;
    else rows.set(key, { name, color, count: 1 });
  }
  const all = [...rows.values()];
  return { rows: all.slice(0, 24), hidden: Math.max(0, all.length - 24) };
}

function swatch(color: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : '#c8c8c2';
}

function metres(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
