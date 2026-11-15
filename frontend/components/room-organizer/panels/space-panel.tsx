'use client';

import { Camera, Loader2, MoreHorizontal, Scan } from '@/components/solid-icons';
import { useEffect, useRef, useState } from 'react';
import { listShippedAssets, shippedImageUrl } from '../lib/shipped-assets';
import { listScannedVenues, type ScannedVenue } from '../lib/venue-scans';
import { registerCloudScans, registerLocalScans } from '../lib/local-scans';
import { EnvironmentPreview } from './environment-preview';
import { LibraryChat } from './library-chat';
import { SceneChat } from './scene-chat';
import { ShelfGrip } from './scendance-workspace';
import { ScenePresetsPanel } from './scene-presets-panel';
import type { ScenePresetKey } from '../lib/scene-presets';
import { StructuralPropertiesPanel } from './structural-properties-panel';
import { VenueFactsPanel } from './venue-facts-panel';
import type { SplatPreviewState } from '../hooks/use-splat-preview';
import type { StoredEnvironment } from '../lib/environment-preference';
import type { RoomLayout } from '../lib/types';
import './space-browser.css';

/**
 * 空间是独立的一页：场景模板和本场环境从物料库搬到这里。
 * 新建空间进这一页上的空白壳体；空间可以是一间房，也可以是一栋建筑。
 */
export function SpacePanel({
  layout,
  onApply,
  onPlaceScene,
  environment,
  currentScanId,
  onPickScan,
  onShowScanContext,
  onOpenCapture,
  onAddSampleScene,
  onTryHanfuWalk,
  hanfuWalkDisabledReason,
  workflow,
  variant = 'shelf',
  venueFactScope,
  isVenueFactScopeCurrent,
}: {
  layout: RoomLayout;
  onApply(layout: RoomLayout): void;
  /** 户外地图打开时，场景卡改为在当前地图上摆一个小场地（不替换整图）。 */
  onPlaceScene?(key: ScenePresetKey): boolean;
  environment?: {
    preview: SplatPreviewState;
    current: StoredEnvironment | null;
    environments: readonly StoredEnvironment[];
    floors: readonly Readonly<{ id: string; name: string }>[];
    onSelect(assetId: string, name: string): void;
    onRemove(assetId: string): void;
    onSetFloor(assetId: string, floorIndex: number): void;
    onClear(): void;
    thumbnails?: Readonly<Record<string, string>>;
    onPreview?(assetId: string, name: string): void;
  };
  /** 当前正在使用的真实场地（扫描库 assetId），只用于列表里的「使用中」。 */
  currentScanId?: string;
  /** 选中一套已扫描场地；不传时退回环境切换，保证面板单独渲染也能用。 */
  onPickScan?(venue: ScannedVenue): void;
  onShowScanContext?(): void;
  onOpenCapture?(): void;
  onAddSampleScene?(assetId: string): void;
  onTryHanfuWalk?(): void;
  /** 实景还没就绪时说明为什么不能进汉服漫游。 */
  hanfuWalkDisabledReason?: string;
  /** 可由工作台托管，切换到其他 Agent 后也记住本次选择。 */
  workflow?: 'aholo' | 'traditional';
  /** shelf = 画布底部抽屉；card = 嵌进 Agent 面板，不要拖拽条。 */
  variant?: 'shelf' | 'card';
  venueFactScope?: string;
  isVenueFactScopeCurrent?: () => boolean;
}): JSX.Element {
  const hostRef = useRef<HTMLElement>(null);
  // 2026-11-16 用户：「我现在分成了四类，场地上的、那种高斯场景啊⋯我感觉没有必要」——
  // 场景库不再当分栏用（本活动 / 示例 / 模板 / 实景扫描 四个互斥标签，点一个就把别的藏起来），
  // 改成和物料库一样的连续列表：本活动 → 实景扫描（示例并入其中）→ 场景模板。
  // `source` 只决定初次展开哪一段，不再是「当前分类」。
  const [source, setSource] = useState<'templates' | 'scans' | 'project'>(
    environment?.environments.length ? 'project' : onAddSampleScene ? 'scans' : 'templates',
  );
  const moreRef = useRef<HTMLDetailsElement>(null);
  const templatesRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (workflow !== 'traditional') return;
    setSource('templates');
    if (variant !== 'card' && moreRef.current) moreRef.current.open = true;
    if (templatesRef.current) templatesRef.current.open = true;
  }, [variant, workflow]);
  const card = variant === 'card';
  // 扫描登记在浏览器的来源隔离存储里（127.0.0.1 与 localhost 各存各的），换来源就丢；
  // 文件才是事实，所以每次开面板先登记本机文件、再用云端副本补缺，两边都不漏。
  const [, refreshScanList] = useState(0);
  useEffect(() => {
    if (registerLocalScans() + registerCloudScans() > 0) refreshScanList(value => value + 1);
  }, []);
  // 真实场地 = 扫描库里已重建好的这一场；每次渲染重读，刚重建完的场立刻出现。
  const scans = listScannedVenues();
  // 打开过的场会留下浏览器里的止帧；有止帧的排大图，没有的收成索引行。
  const venueThumb = (venue: ScannedVenue) => environment?.thumbnails?.[venue.assetId];
  const venueSize = (venue: ScannedVenue) => venue.meters
    ? `${venue.meters.width.toFixed(1)} × ${venue.meters.depth.toFixed(1)} m`
    : '';
  const venueDay = (venue: ScannedVenue) => venue.savedAt
    ? new Date(venue.savedAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
    : '';
  const framedScans = scans.filter(venue => !!venueThumb(venue));
  const plainScans = scans.filter(venue => !venueThumb(venue));
  const hasBoundary = (layout.mapGroundPolygon?.length ?? 0) >= 3;
  const ScanList = card ? 'details' : 'div';
  const samples = onAddSampleScene ? listShippedAssets('spz') : [];
  const pickScan = (venue: ScannedVenue) => {
    if (onPickScan) onPickScan(venue);
    else environment?.onSelect(venue.assetId, venue.name);
  };
  const templates = <details ref={templatesRef} className="sc-space-block sc-space-templates sc-space-library-details" data-space-source={card ? 'templates' : undefined} open={card ? source === 'templates' : undefined}>
    <summary>{card ? '场景模板库' : '场景模板'}</summary>
    <div className="sc-library-presets">
      <ScenePresetsPanel layout={layout} onApply={onApply} active={layout.scenePreset} {...(onPlaceScene ? { onPlace: onPlaceScene } : {})}/>
    </div>
  </details>;
  const projectScenes = environment && <details className="sc-space-block sc-space-env sc-space-library-details" data-space-source={card ? 'project' : undefined} open={card ? source === 'project' : undefined}>
    <summary>项目中的场景{environment.environments.length > 0 && ` · ${environment.environments.length}`}</summary>
    <EnvironmentPreview {...environment} gallery={card}/>
  </details>;
  const moreOptions = <details className={card ? "sc-space-library-menu" : "sc-space-library-details"} ref={moreRef}>
            <summary aria-label={card ? "更多场地选项" : undefined}>{card ? <MoreHorizontal size={18} aria-hidden="true"/> : "更多场地选项"}</summary>
            <div className="sc-space-library-menu-content">
          {!card && templates}
          {!card && projectScenes}
            <StructuralPropertiesPanel/>
            </div>
          </details>;
  return (
    <aside ref={hostRef} className={`sc-library sc-compact-shelf sc-space-panel${card ? ' is-card' : ''}`} aria-label="空间">
      {!card && <ShelfGrip shelfRef={hostRef} label="调整空间面板高度"/>}
      <div className="sc-space-body">
        {venueFactScope?.startsWith('activity:') && isVenueFactScopeCurrent && <VenueFactsPanel key={venueFactScope} activityId={venueFactScope.slice('activity:'.length)} isCurrent={isVenueFactScopeCurrent}/>}
        <div className="sc-space-card is-aholo">
          {!card && <section className="sc-space-block" aria-label="真实场地">
            <div className="sc-space-section-head">
              <Scan size={15} aria-hidden="true"/><h3>真实场地</h3>
              <small>{scans.length ? `${scans.length} 套已扫描` : '实拍重建'}</small>
            </div>
            {hasBoundary && !currentScanId && (
              <p className="sc-note">场地范围已保存。可以先放物料或试走。需要核对现场障碍时，先拍摄或选择本场扫描，再对齐地图并核验碰撞边界。</p>
            )}
            {scans.length === 0 && <div className="sc-space-venue-hint">
                <Camera size={13} aria-hidden="true"/><span>用手机拍一段场地</span>
                {onOpenCapture
                  ? <button type="button" className="sc-button" onClick={onOpenCapture}>拍摄场地</button>
                  : <a className="sc-button" href="/guide/capture">拍摄场地</a>}
              </div>}
          </section>}
          {card && <div className="sc-space-browser-head">
            <LibraryChat title="场景库" headerAction={moreOptions}>
            <SceneChat scans={scans} onPickScan={pickScan} onOpenCapture={onOpenCapture}/>
            </LibraryChat>
          </div>}
            {(card || scans.length > 0) && <ScanList className={card ? 'sc-space-library-details' : 'sc-scan-options'}
              {...(card ? { 'data-space-source': 'scans', open: source === 'scans' } : {})}>
                {card && <summary>我的实景扫描 · {scans.length}</summary>}
                {scans.length === 0 && <p className="sc-note">还没有实景扫描。拍摄后可在这里查看。</p>}
                {/* 画面优先：截过止帧的排成大图，还没打开过的收成一行行索引，不拿同一句话填满每张卡。 */}
                {framedScans.length > 0 && <ul className="sc-scan-frames" aria-label="有画面的真实场地">
                  {framedScans.map(venue => {
                    const active = venue.assetId === currentScanId;
                    const preview = active && environment?.preview.assetId === venue.assetId ? environment.preview : undefined;
                    const failed = !!active && preview?.status === 'error';
                    const inProject = environment?.environments.some(entry => entry.assetId === venue.assetId);
                    return <li key={venue.assetId}>
                      <button type="button" className={`sc-scan-frame${active ? ' is-current' : ''}`}
                        title="打开这一场的 3D 实景"
                        aria-label={failed ? `重试加载真实场地 ${venue.name}` : `应用真实场地 ${venue.name}`}
                        aria-pressed={active} onClick={() => pickScan(venue)}>
                        <span className="sc-scan-frame-shot">
                          <img src={venueThumb(venue)} alt="" loading="lazy"/>
                          {preview?.status === 'loading' && <span className="sc-scan-frame-loading"><Loader2 className="cr-spin" size={16} aria-hidden="true"/></span>}
                          {(active || inProject) && <span className="sc-scan-frame-tag">{active ? '当前' : '已加入'}</span>}
                          <span className="sc-scan-frame-open">{failed ? '重试' : '打开 3D'}</span>
                        </span>
                        <strong title={venue.name}>{venue.name}</strong>
                        {venueSize(venue) && <small>{venueSize(venue)}</small>}
                      </button>
                    </li>;
                  })}
                </ul>}
                {plainScans.length > 0 && <div className="sc-scan-plain">
                  {framedScans.length > 0 && <p className="sc-scan-plain-label">其它实景扫描 · {plainScans.length}</p>}
                  <ul aria-label="其它实景扫描">
                    {plainScans.map(venue => {
                      const active = venue.assetId === currentScanId;
                      const preview = active && environment?.preview.assetId === venue.assetId ? environment.preview : undefined;
                      const failed = !!active && preview?.status === 'error';
                      const inProject = environment?.environments.some(entry => entry.assetId === venue.assetId);
                      const state = preview?.status === 'loading' ? '加载中…' : failed ? '加载失败' : active ? '当前' : venueSize(venue) || venueDay(venue);
                      return <li key={venue.assetId}>
                        <button type="button" className="sc-scan-row" title="打开这一场的 3D 实景"
                          aria-label={failed ? `重试加载真实场地 ${venue.name}` : `应用真实场地 ${venue.name}`}
                          aria-pressed={active} onClick={() => pickScan(venue)}>
                          <strong title={venue.name}>{venue.name}</strong>
                          {inProject && !active && <span className="sc-scan-row-tag">已加入</span>}
                          <small>{state}</small>
                        </button>
                      </li>;
                    })}
                  </ul>
                </div>}
                {/* 2026-11-16：示例场景不再单开一栏，收进实景扫描这一段末尾——
                    自己还没扫的时候拿它顶上先看效果，它不是本场场地。 */}
                {card && samples.length > 0 && <div className="sc-scan-plain sc-space-samples-inline">
                  <p className="sc-scan-plain-label">示例场景 · {samples.length}</p>
                  <ul className="sc-space-samples">
                    {samples.map(asset => <li key={asset.assetId}>
                      <button type="button" className="sc-space-sample" onClick={() => onAddSampleScene?.(asset.assetId)}
                        aria-label={`加入示例场景 ${asset.name}`}>
                        {asset.image && <img src={shippedImageUrl(asset)} alt="" loading="lazy" />}
                        <strong>{asset.name}</strong>
                      </button>
                    </li>)}
                  </ul>
                </div>}
              </ScanList>}
          {card && projectScenes}
            {onTryHanfuWalk && <button className="sc-button" type="button" disabled={!!hanfuWalkDisabledReason}
              title={hanfuWalkDisabledReason} onClick={onTryHanfuWalk}>穿汉服漫游</button>}
            {onTryHanfuWalk && hanfuWalkDisabledReason && <p className="sc-note">{hanfuWalkDisabledReason}</p>}
            {onShowScanContext && <button className="sc-button" type="button" onClick={onShowScanContext}>{hasBoundary || layout.researchArea ? '返回地图' : '显示其他场景'}</button>}
          {card && templates}
          {!card && moreOptions}
        </div>
      </div>
    </aside>
  );
}
