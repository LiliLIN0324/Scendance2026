'use client';

import { Box, Camera, Crown, Images, LayoutGrid, Loader2, Scan, Upload } from '@/components/solid-icons';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { listShippedAssets, shippedImageUrl } from '../lib/shipped-assets';
import { listScannedVenues, type ScannedVenue } from '../lib/venue-scans';
import { registerCloudScans, registerLocalScans } from '../lib/local-scans';
import { readOutdoorProjectRecord, saveOutdoorProjectRecord } from '../lib/outdoor-project-store';
import { requestOutdoorProjectSwitch } from '../lib/outdoor-project-switch';
import { CN_REPLICA_CASES, REPLICA_CASES, type ReplicaCase } from '../lib/replica-cases';
import { uploadScanFile } from '../lib/scan-upload';
import { SCENE_PRESETS, type ScenePresetKey } from '../lib/scene-presets';
import { CaseCards } from './case-cards';
import { EnvironmentPreview } from './environment-preview';
import { ShelfGrip } from './scendance-workspace';
import { ScenePresetsPanel } from './scene-presets-panel';
import type { SplatPreviewState } from '../hooks/use-splat-preview';
import type { StoredEnvironment } from '../lib/environment-preference';
import type { RoomLayout } from '../lib/types';
import './space-browser.css';

/**
 * 2026-11-17 用户：「下面重新排列。视觉参考户外规划的分类。」
 *
 * 场景库每段收成一枚分类行——折叠箭头 + 图标 + 名称 + 右侧计数，与户外规划物料库的
 * 一级段（区域、路线及交通 / 车 / 基础设施…）同一套读法：先看见有哪些类、各有几件，
 * 再按需展开。`open` 只作为首次挂载的展开态，用户点过之后由 details 自己管。
 */
function SceneGroup({ label, icon, count, open, testId, groupRef, lazy, action, children }: {
  label: string;
  icon: ReactNode;
  count: number;
  open?: boolean;
  testId?: string;
  groupRef?: RefObject<HTMLDetailsElement>;
  /** 收起时连子节点都不建（经典案例 44 张预览各自要算一遍方案）。 */
  lazy?: boolean;
  /** 分类行右侧的动作（如「上传实景包」）；点它不展开/收起这一段。 */
  action?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  // 2026-11-17：懒挂载只服务于重的那几段；已展开过的段照旧由 details 自己管开合。
  const [shown, setShown] = useState(!lazy || !!open);
  return <details className="sc-scene-group" ref={groupRef} {...(open ? { open } : {})} {...(testId ? { 'data-testid': testId } : {})}
    onToggle={event => { if (lazy) setShown(event.currentTarget.open); }}>
    <summary>
      <span className="sc-scene-group-caret" aria-hidden="true" />
      {icon}
      <span className="sc-scene-group-label">{label}</span>
      {/* 动作放在 summary 里，点击默认会连带开合这一段；preventDefault 挡掉，只做动作。 */}
      {action && <span className="sc-scene-group-action" onClick={event => event.preventDefault()}>{action}</span>}
      <span className="sc-scene-group-count">{count}</span>
    </summary>
    <div className="sc-scene-group-body">{shown ? children : null}</div>
  </details>;
}

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
}): JSX.Element {
  const hostRef = useRef<HTMLElement>(null);
  // 2026-11-16 用户：「我现在分成了四类，场地上的、那种高斯场景啊⋯我感觉没有必要」——
  // 场景库不再当分栏用（本活动 / 示例 / 模板 / 实景扫描 四个互斥标签，点一个就把别的藏起来），
  // 改成和物料库一样的连续列表：本活动 → 实景扫描（示例并入其中）→ 场景模板。
  // 2026-11-17 分类行重排后不再需要「首展开哪一段」的互斥状态，每段自己管展开。
  const moreRef = useRef<HTMLDetailsElement>(null);
  const templatesRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (workflow !== 'traditional') return;
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
  // 2026-11-19 用户：「我的实景扫描上传不到我的平台……图二这里应该新增一个上传功能」。
  // 手上已有的 .spz/.ply 直传本机资产代理落盘（POST /asset/upload），登记后立刻进这一段列表。
  const scansRef = useRef<HTMLDetailsElement>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<{ status: 'idle' | 'uploading' | 'done' | 'error'; percent: number; message: string }>({ status: 'idle', percent: 0, message: '' });
  const uploading = upload.status === 'uploading';
  const submitScanFile = async (file: File): Promise<void> => {
    // 这一段默认收起，进度与错误都在里面；先展开，不然传着传着看不见任何反应。
    if (scansRef.current) scansRef.current.open = true;
    setUpload({ status: 'uploading', percent: 0, message: '' });
    try {
      const asset = await uploadScanFile(file, {
        name: file.name,
        onProgress: (loaded, total) => setUpload({ status: 'uploading', percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0, message: '' }),
      });
      refreshScanList(value => value + 1);
      setUpload({ status: 'done', percent: 100, message: `已加入「${asset.name}」，点它就能在 3D 里看。` });
    } catch (error) {
      setUpload({ status: 'error', percent: 0, message: error instanceof Error ? error.message : '上传失败，请重试。' });
    }
  };
  const scanUploadButton = <button type="button" className="sc-scan-upload-btn" data-testid="scan-upload-button"
    title="上传从 Aholo Reality 下载的 .spz / .ply 实景包" disabled={uploading}
    onClick={event => { event.preventDefault(); event.stopPropagation(); scanInputRef.current?.click(); }}>
    {uploading
      ? <Loader2 className="cr-spin" size={13} aria-hidden="true"/>
      : <Upload size={13} aria-hidden="true"/>}
    <span>{uploading ? `上传 ${upload.percent}%` : '上传'}</span>
  </button>;
  const scanUploadNote = upload.message ? <p className={`sc-scan-upload-note is-${upload.status}`}
    role={upload.status === 'error' ? 'alert' : 'status'}>{upload.message}</p> : null;
  // 打开过的场会留下浏览器里的止帧；有止帧的排大图，没有的收成索引行。
  const venueThumb = (venue: ScannedVenue) => environment?.thumbnails?.[venue.assetId];
  const venueSize = (venue: ScannedVenue) => venue.meters
    ? `${venue.meters.width.toFixed(1)} × ${venue.meters.depth.toFixed(1)} m`
    : '';
  const venueDay = (venue: ScannedVenue) => venue.savedAt
    ? new Date(venue.savedAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
    : '';
  const hasBoundary = (layout.mapGroundPolygon?.length ?? 0) >= 3;
  const samples = onAddSampleScene ? listShippedAssets('spz') : [];
  const presetCount = Object.keys(SCENE_PRESETS).length;
  const pickScan = (venue: ScannedVenue) => {
    if (onPickScan) onPickScan(venue);
    else environment?.onSelect(venue.assetId, venue.name);
  };
  // 2026-11-17：经典案例不是“模板替换”，点开就在本机落一个独立活动（同一 id 复用，
  // 重复打开仍是那一案），当前场地一个字都不动。
  // 2026-11-17 用户拍板「按不换页改」：先写本机记录，再请工作台外壳就地换 project id
  // （重挂画布、replaceState 跟 URL），文档不重载、不白屏；没有宿主接住才退回整页跳。
  const [caseNotice, setCaseNotice] = useState('');
  const openReplicaCase = (replica: ReplicaCase): void => {
    setCaseNotice('');
    try {
      const projectId = `replica-${replica.id}`;
      const now = new Date().toISOString();
      const existing = readOutdoorProjectRecord(projectId);
      saveOutdoorProjectRecord({
        v: 1,
        projectId,
        name: `${replica.origin === 'cn' ? '国内案例' : '经典案例'} · ${replica.title}`.slice(0, 60),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        plan: replica.buildPlan(),
      });
      if (!requestOutdoorProjectSwitch(projectId)) {
        window.location.assign(`/editor/?project=${encodeURIComponent(projectId)}&mode=outdoor`);
      }
    } catch (error) {
      setCaseNotice(error instanceof Error ? error.message : '这个案例没能打开，请重试。');
    }
  };

  // 2026-11-17 用户：「我的实景扫描也要是和上面一样的卡片」；2026-11-19 用户又说
  // 「实景扫描的卡片也做成多个卡片的形式」。不再按「有没有止帧」分成大图与索引行两种读法：
  // 一律排 2 列 16:10 卡片，没打开过的用一枚安静的点云图标占位；尺寸与日期并成一行元信息，
  // 状态交给描边和左上角那颗标签。
  const scanCards = <>
    {scans.length === 0 && <p className="sc-note">还没有实景扫描。上传从 Aholo Reality 下载的 .spz / .ply，或用手机拍一段场地。</p>}
    {scans.length > 0 && <ul className="sc-space-samples sc-scan-cards" aria-label="实景扫描">
      {scans.map(venue => {
        const thumb = venueThumb(venue);
        const active = venue.assetId === currentScanId;
        const preview = active && environment?.preview.assetId === venue.assetId ? environment.preview : undefined;
        const failed = !!active && preview?.status === 'error';
        const inProject = environment?.environments.some(entry => entry.assetId === venue.assetId);
        const meta = [failed ? '加载失败' : '', venueSize(venue), venueDay(venue)].filter(Boolean).join(' · ');
        return <li key={venue.assetId}>
          <button type="button" className={`sc-space-sample sc-scan-card${active ? ' is-current' : ''}`}
            title="打开这一场的 3D 实景"
            aria-label={failed ? `重试加载真实场地 ${venue.name}` : `应用真实场地 ${venue.name}`}
            aria-pressed={active} onClick={() => pickScan(venue)}>
            <span className="sc-scan-card-shot">
              {thumb
                ? <img src={thumb} alt="" loading="lazy"/>
                : <Scan size={22} className="sc-scan-card-blank" aria-hidden="true"/>}
              {preview?.status === 'loading' && <span className="sc-scan-card-loading"><Loader2 className="cr-spin" size={16} aria-hidden="true"/></span>}
              {(active || inProject) && <span className="sc-scan-card-tag">{active ? '当前' : '已加入'}</span>}
            </span>
            <strong title={venue.name}>{venue.name}</strong>
            {meta && <span className="sc-scan-card-meta">{meta}</span>}
          </button>
        </li>;
      })}
    </ul>}
  </>;

  // 2026-11-16：示例场景不再单开一栏，收进实景扫描这一段末尾——
  // 自己还没扫的时候拿它顶上先看效果，它不是本场场地。
  // 2026-11-17：分类行重排后单列一段，计数直接读出来。
  const sampleTiles = samples.length > 0 ? <ul className="sc-space-samples">
    {samples.map(asset => <li key={asset.assetId}>
      <button type="button" className="sc-space-sample" onClick={() => onAddSampleScene?.(asset.assetId)}
        aria-label={`加入示例场景 ${asset.name}`}>
        {asset.image && <img src={shippedImageUrl(asset)} alt="" loading="lazy" />}
        <strong>{asset.name}</strong>
      </button>
    </li>)}
  </ul> : null;

  const cnCases = CN_REPLICA_CASES.length > 0 ? <SceneGroup label="国内案例" icon={<Crown size={15} aria-hidden="true" />} count={CN_REPLICA_CASES.length} testId="space-group-cn-cases" lazy>
    <CaseCards cases={CN_REPLICA_CASES} onOpen={openReplicaCase}/>
  </SceneGroup> : null;

  const cases = <SceneGroup label="经典案例" icon={<Crown size={15} aria-hidden="true" />} count={REPLICA_CASES.length} testId="space-group-cases" lazy>
    <CaseCards onOpen={openReplicaCase}/>
    {caseNotice && <p className="sc-note" role="status">{caseNotice}</p>}
  </SceneGroup>;

  const templates = <SceneGroup label={card ? '场景模板库' : '场景模板'} icon={<LayoutGrid size={15} aria-hidden="true" />} count={presetCount} groupRef={templatesRef}>
    <div className="sc-library-presets">
      <ScenePresetsPanel layout={layout} onApply={onApply} active={layout.scenePreset} {...(onPlaceScene ? { onPlace: onPlaceScene } : {})}/>
    </div>
  </SceneGroup>;

  const projectScenes = environment ? <SceneGroup label="项目中的场景" icon={<Box size={15} aria-hidden="true" />} count={environment.environments.length}>
    <EnvironmentPreview {...environment} gallery={card}/>
  </SceneGroup> : null;

  const moreOptions = <details className={card ? 'sc-space-library-menu' : 'sc-space-library-details'} ref={moreRef}>
    <summary>更多场地选项</summary>
    <div className="sc-space-library-menu-content">
      {!card && templates}
      {!card && projectScenes}
    </div>
  </details>;

  return (
    <aside ref={hostRef} className={`sc-library sc-compact-shelf sc-space-panel${card ? ' is-card' : ''}`} aria-label="空间">
      {/* 选文件框整页只挂一份：分类行与列表两处的「上传」按钮都点它。 */}
      <input ref={scanInputRef} type="file" accept=".spz,.ply" hidden data-testid="scan-upload-input" aria-label="选择实景包"
        onChange={event => {
          const file = event.currentTarget.files?.[0] ?? null;
          event.currentTarget.value = '';
          if (file) void submitScanFile(file);
        }}/>
      {!card && <ShelfGrip shelfRef={hostRef} label="调整空间面板高度"/>}
      <div className="sc-space-body">
        {/* 2026-11-17 用户：「场地信息记录删掉」——VenueFactsPanel 摘除挂载；venue-facts 子系统本体休眠保留（agent-panel venueFactToken 链路未动）。 */}
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
          {/* 2026-11-17 用户：「这个场景库三个字是不是要删掉啊」——删。卡片外壳已有「空间」标题，
              这行场景库是多余的一级标题，而且 .sc-library-chat-title 当时是绝对定位、不占高度，
              直接把下面「经典案例」压在自己身上（那条定位已改回流式，见 workbench-shelf.css）。LibraryChat 组件与 .sc-library-chat* 样式已于 2026-11-17 零引用清理删除；
              .sc-library-chat-choices 因 material-create-cell 仍在用而单独保留。 */}
          {card
            ? <>
                {/* 2026-11-17 用户：「是不是上面的应该放在下面」「项目中的场景这玩意根本就不重要啊」——
                    案例与模板库提到最前，本机那 8 行实景扫描压到最后；「项目中的场景」从卡里摘掉
                    （shelf 版仍在「更多场地选项」里挂着，环境切换没丢）。 */}
                {cnCases}
                {cases}
                {templates}
                {/* 2026-11-17 用户：「每次打开都默认打开了示例场景和我的实景扫描……默认都不要打开」——
                    两段一律收起起步，要看再点开；展开态此后由 details 自己管。 */}
                {sampleTiles && <SceneGroup label="示例场景" icon={<Images size={15} aria-hidden="true" />} count={samples.length}>
                  {sampleTiles}
                </SceneGroup>}
                {/* 2026-11-19 用户：「没有其他和我的区分，这些都是我们的云资产」——
                    这一段不再叫「我的实景扫描」：库里每一份扫描都是团队的云资产，
                    名字里的「本机 / 云端」前缀也已在 lib/scan-names.ts 那一道口去掉。 */}
                <SceneGroup label="实景扫描" icon={<Scan size={15} aria-hidden="true" />} count={scans.length} groupRef={scansRef} action={scanUploadButton}>
                  {scanUploadNote}
                  {scanCards}
                </SceneGroup>
              </>
            : <>
                <div className="sc-scan-options">
                  <div className="sc-scan-upload">
                    {scanUploadButton}
                    <span className="sc-scan-upload-hint">从 Aholo Reality 下载的 .spz / .ply</span>
                  </div>
                  {scanUploadNote}
                  {scans.length > 0 && scanCards}
                </div>
                {moreOptions}
              </>}
          {onTryHanfuWalk && <button className="sc-button" type="button" disabled={!!hanfuWalkDisabledReason}
            title={hanfuWalkDisabledReason} onClick={onTryHanfuWalk}>穿汉服漫游</button>}
          {onTryHanfuWalk && hanfuWalkDisabledReason && <p className="sc-note">{hanfuWalkDisabledReason}</p>}
          {onShowScanContext && <button className="sc-button" type="button" onClick={onShowScanContext}>{hasBoundary || layout.researchArea ? '返回地图' : '显示其他场景'}</button>}
        </div>
      </div>
    </aside>
  );
}
