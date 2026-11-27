'use client';

/**
 * 画布左上角「搜地点」框（用户 m05472：要和地图 App 一样，在左上角）。
 *
 * 2026-11-13 灵动岛化（用户指令「做成灵动岛的模式，智能展开和收缩」）：
 * - 收缩态是一枚 44px 圆图标；落了钉/有词时变成「图标 + 地名」短胶囊（瞥一眼状态）。
 * - 悬停或点击弹性展开成完整搜索框（宽度三态显式给值，CSS 过渡做 morph）；
 *   选中建议或点画布后自动缩回地名胶囊，Esc 也收。
 * - input 常驻 DOM（验收脚本/键盘可达），收缩时淡出并 pointer-events:none。
 *
 * 输入即出建议：**选区**（行政区边界，2026-11-12 用户要求「给相关的选区，
 * 而不是一个居中的点」）+ 最近选过的地点 + 地点检索（本机走天地图 3199 代理、
 * 线上走 /api/place 同契约，见 lib/place-search.ts、lib/place-area.ts）。
 * ↑↓ 选择、Enter 确认、Esc 关闭；选中只做「视图飞过去 + 落钉/画选区」，
 * 不改 plan / anchor。组件只负责输入与建议条，落钉、画框由调用方交给画布。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Search, X } from 'lucide-react';
import {
  matchRecentPlaces,
  recentPlaces,
  rememberPlace,
  searchPlaces,
  type PlaceSuggestion,
} from '@/components/room-organizer/lib/place-search';
import { peekCachedPlaceShape, searchAreas, type PlaceArea } from '@/components/room-organizer/lib/place-area';
import {
  buildPlaceSearchOptions,
  fetchPlaceShapeHints,
  hintedOutlineNames,
  type PlaceSearchOption,
} from '@/components/room-organizer/lib/place-search-options';
import { normalizeOutlineName } from '@/components/room-organizer/lib/place-shape-quality';
import type { SearchCandidatePin } from '@/components/room-organizer/lib/outdoor-plan-canvas';

const SEARCH_DEBOUNCE_MS = 350;

export interface PlanPlaceSearchProps {
  /** 选中一条地点建议。 */
  onPick: (place: PlaceSuggestion) => void;
  /** 选中一个选区（行政区边界）。不给就只搜地点。 */
  onPickArea?: (area: PlaceArea) => void;
  /** 画布中心，用于同名行政区里挑最近的（也是选区检索的 `near`）。 */
  near?: { lng: number; lat: number } | null;
  /** 点「清除」时回调（调用方据此撤掉定位钉/选区）。 */
  onClear?: () => void;
  /** 左上角偏移，默认贴画布左上 16 / 16。 */
  offset?: { left?: number; top?: number };
  width?: number;
  placeholder?: string;
  /** 便于验收脚本定位；默认 `plan-place-search`。 */
  testIdPrefix?: string;
  /**
   * 与对话侧场地检索同步过来的查询与候选（2026-11-13 用户指令）：
   * 在 chat 里搜「杭州 IN77」，地图左上角这个搜索框要同步显示同一批候选，
   * 不用在地图框里重新输入一遍。传 null / 不传 = 不同步，保持原有独立检索。
   */
  sync?: { query: string; hits: readonly PlaceSuggestion[] } | null;
  /**
   * 2026-11-27 用户指令（对齐百度地图）：下拉候选批量上报给画布落编号钉——
   * `index` 就是本下拉渲染的 1/N 序号（选区条目占号但无坐标，不落钉）。
   * 在本下拉里选中一条 / 清除后整批收掉（列表已不在）。
   * 传稳定引用（如 setState）以避免每次渲染重报。
   */
  onCandidatesChange?: (pins: ReadonlyArray<SearchCandidatePin> | null) => void;
  /**
   * 撤钉令牌：调用方每递增一次，当前这批候选钉立即收掉（场地已落红线 / 候选被收回 / 换活动）。
   * 只对递增时的那次检索生效——下拉自己刷新同一批结果不会把钉铺回来；
   * 换词重搜、或对话侧同步来新一批候选，照常重新铺钉。
   */
  revokeCandidatePins?: number;
}

/** 同一批候选判定：id / 名字 / 坐标一致就算没变，避免每次同步都重写 state。 */
function samePlaces(a: readonly PlaceSuggestion[], b: readonly PlaceSuggestion[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((place, index) => {
    const other = b[index];
    return !!other && place.id === other.id && place.name === other.name && place.lng === other.lng && place.lat === other.lat;
  });
}


export default function PlanPlaceSearch({
  onPick,
  onPickArea,
  near,
  onClear,
  onCandidatesChange,
  revokeCandidatePins,
  offset,
  width = 320,
  placeholder = '搜地点 / 场馆 / 地址，地图飞过去',
  testIdPrefix = 'plan-place-search',
  sync = null,
}: PlanPlaceSearchProps) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PlaceSuggestion[]>([]);
  const [areas, setAreas] = useState<PlaceArea[]>([]);
  const [outlinedNames, setOutlinedNames] = useState<Set<string>>(new Set());
  const [recent, setRecent] = useState<PlaceSuggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  // 灵动岛两态开关：聚焦或悬停即展开；两者都不满足时收缩。
  const [focused, setFocused] = useState(false);
  const [hover, setHover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const expanded = focused || hover;

  useEffect(() => {
    setRecent(recentPlaces());
  }, []);

  const nearLng = near?.lng;
  const nearLat = near?.lat;
  // 2026-11-12：`onPickArea` 是调用方内联函数，每次渲染都是新引用。
  // 放进 effect 依赖会导致「每次重渲染 → 中止请求 → 再发一次」的死循环（下拉永远空）。
  // 这里只记「开不开选区搜索」，不跟引用。
  const areaEnabledRef = useRef(typeof onPickArea === 'function');
  areaEnabledRef.current = typeof onPickArea === 'function';

  // 对话侧同步过来的查询与候选（2026-11-13）：只读同步，本框不自己再检索同一批词。
  const syncQuery = sync?.query ?? '';
  const syncHits = sync?.hits;

  useEffect(() => {
    const keyword = query.trim();
    if (keyword.length < 2) {
      setHits([]);
      setAreas([]);
      setOutlinedNames(new Set());
      setBusy(false);
      return undefined;
    }
    // 同一批候选已经由对话侧给过来了就别再检索一遍：省一次出站往返，
    // 也避免本机双源慢响应把下拉清空。关键词被用户改过则照常检索。
    if (syncHits && syncHits.length > 0 && keyword === syncQuery.trim()) return undefined;
    const controller = new AbortController();
    setBusy(true);
    const timer = window.setTimeout(() => {
      const nearPoint = nearLng != null && nearLat != null ? { lng: nearLng, lat: nearLat } : null;
      const hintsRequest = fetchPlaceShapeHints(keyword, { signal: controller.signal });
      Promise.all([
        searchPlaces(keyword, { signal: controller.signal, center: nearPoint }),
        areaEnabledRef.current ? searchAreas(keyword, { signal: controller.signal, near: nearPoint }) : Promise.resolve([]),
      ])
        .then(([found, foundAreas]) => {
          if (controller.signal.aborted) return;
          setHits(found); setAreas(foundAreas);
          const names = new Set<string>();
          for (const place of found) {
            if (peekCachedPlaceShape(place.name, { lng: place.lng, lat: place.lat })) names.add(normalizeOutlineName(place.name.split('|')[0] ?? ''));
          }
          setOutlinedNames(names);
          // 先显示快结果，再异步提升已有轮廓；库存慢/不可达不能拖住整张下拉。
          void hintsRequest.then(hints => {
            if (controller.signal.aborted) return;
            setOutlinedNames(new Set([...names, ...hintedOutlineNames(hints)]));
          });
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, nearLng, nearLat, syncQuery, syncHits]);

  // 2026-11-13：对话侧（chat）搜到的地点同步到地图左上角这个搜索框——
  // 用户在 chat 里打「杭州 IN77」，这里要显示同一批候选，不必重新输入一遍。
  // 声明在检索 effect 之后，保证同一次提交里「清空旧命中」先于「写入同步命中」。
  useEffect(() => {
    const keyword = syncQuery.trim();
    if (!keyword) return;
    setQuery(syncQuery);
    setPicked(null);
    setHits(prev => (samePlaces(prev, syncHits ?? []) ? prev : [...(syncHits ?? [])]));
    setBusy(false);
    setOpen(true);
    setFocused(true); // 灵动岛展开；不展开的话收缩态看不到这批候选。
  }, [syncQuery, syncHits]);

  const keyword = query.trim();
  // 2026-11-27：候选编号钉要求 options 引用稳定（引用一变就重报钉），这里的合成
  // 从渲染体挪进 useMemo——hover/focus 等无关 state 变化不再重建列表。
  const recentMatches = useMemo(() => (keyword ? matchRecentPlaces(keyword) : recent), [keyword, recent]);
  const options: PlaceSearchOption[] = useMemo(() => buildPlaceSearchOptions({
    query: keyword,
    areas,
    places: hits,
    recent: recentMatches,
    outlinedNames,
  }), [keyword, areas, hits, recentMatches, outlinedNames]);

  // 2026-11-27 用户指令：把带坐标的候选按下拉序号上报，画布落「百度式」编号钉。
  // 选区条目占号但无单点坐标，不落钉；选中（picked 非空）后整批收掉——
  // 剩下那枚由调用方的定位钉接管，和地图 App「点选后只剩选中钉」同一观感。
  // 只有真实检索词（或对话侧同步候选）才铺钉：纯「最近搜过」的展开态不铺，
  // 避免工作台一加载/一聚焦就满图编号钉（百度也只在有搜索词时铺）。
  // 「一次检索」的标识，撤钉按它生效：换了词、或对话侧同步来一批新的非空候选，都算新的一次；
  // 同步撤走（变 null）和下拉自己刷新同一批结果（hits 变、词没变），都还是同一次。
  const lastSyncHitsRef = useRef(syncHits);
  if (syncHits?.length) lastSyncHitsRef.current = syncHits;
  const syncSessionKey = syncHits?.length ? syncHits : lastSyncHitsRef.current;
  // 标识就是一个普通对象：同一个对象 = 同一次检索，换词 / 新一批同步候选 = 新对象。
  const searchSession = useMemo(() => ({ keyword, syncHits: syncSessionKey }), [keyword, syncSessionKey]);
  const [revokedSession, setRevokedSession] = useState<typeof searchSession | null>(null);
  const sessionRef = useRef(searchSession);
  sessionRef.current = searchSession;
  const revokeToken = revokeCandidatePins ?? 0;
  const appliedRevokeRef = useRef(revokeToken);
  useEffect(() => {
    // 挂载时拿到的令牌是历史值，不拿来撤当前这批；只响应挂载之后的递增。
    if (appliedRevokeRef.current === revokeToken) return;
    appliedRevokeRef.current = revokeToken;
    setRevokedSession(sessionRef.current);
  }, [revokeToken]);
  const pinsRevoked = revokedSession === searchSession;

  const placePins = useMemo<ReadonlyArray<SearchCandidatePin> | null>(() => {
    if (picked || !keyword || pinsRevoked) return null;
    const pins: SearchCandidatePin[] = [];
    options.forEach((option, index) => {
      if (option.kind !== 'place') return;
      const { lng, lat } = option.place;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      pins.push({ index, lng, lat, name: option.place.name });
    });
    return pins;
  }, [options, picked, keyword, pinsRevoked]);

  // 清理函数先报 null 再报新值，同一次 commit 内连发、最终值正确；
  // 组件卸载（3D 接管时整层退场）也经此把钉收干净。
  const notifyCandidates = onCandidatesChange;
  useEffect(() => {
    notifyCandidates?.(placePins);
    return () => notifyCandidates?.(null);
  }, [notifyCandidates, placePins]);

  function chooseOption(option: PlaceSearchOption) {
    if (option.kind === 'area') {
      setQuery(option.area.name);
      setPicked(option.area.name);
      setHits([]);
      setAreas([]);
      setOpen(false);
      setActive(-1);
      // 灵动岛：选中后缩回地名胶囊（input 失焦， Isles 收口）。
      inputRef.current?.blur();
      onPickArea?.(option.area);
      return;
    }
    const place = option.place;
    setQuery(place.name);
    setPicked(place.name);
    setRecent(rememberPlace(place) ?? recentPlaces());
    setHits([]);
    setAreas([]);
    setOpen(false);
    setActive(-1);
    inputRef.current?.blur();
    onPick(place);
  }

  function clear() {
    setQuery('');
    setHits([]);
    setAreas([]);
    setPicked(null);
    setOpen(false);
    setActive(-1);
    onClear?.();
  }

  /** Esc / 点地图同口径：收下拉与灵动岛，但保留已输入/已选地名，不改检索结果。 */
  const dismiss = useCallback(() => {
    setOpen(false);
    setActive(-1);
    // 关键：鼠标还停在岛上时 hover=true 会把 expanded 撑住，Esc 看起来没反应；
    // 不用等 blur 事件回写 focused，这里直接把两态都收掉。
    setHover(false);
    setFocused(false);
    inputRef.current?.blur();
  }, []);

  useEffect(() => {
    // 焦点可能已经离开 input（清除按钮、候选按钮、同步候选自动展开），
    // 只靠 input 的 onKeyDown 会漏掉 Esc；在窗口层兜底。
    if (!open && !expanded) return undefined;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
      event.preventDefault();
      dismiss();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open, expanded, dismiss]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      return;
    }
    if (options.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(prev => (prev + 1) % options.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(prev => (prev <= 0 ? options.length - 1 : prev - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const hit = options[active >= 0 ? active : 0];
      if (hit) chooseOption(hit);
    }
  }

  const box = {
    left: offset?.left ?? 16,
    top: offset?.top ?? 16,
    '--sc-pps-w': `${width}px`,
  } as CSSProperties;

  return (
    <div
      className={`sc-plan-place-search${expanded ? ' is-expanded' : ''}${(query !== '' || picked) ? ' has-value' : ''}`}
      data-testid={testIdPrefix}
      data-expanded={expanded ? 'true' : 'false'}
      style={box}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        className="sc-plan-place-search-field"
        onClick={() => {
          // 收缩态整枚胶囊可点：点一下弹开并聚焦输入框。
          if (!expanded) inputRef.current?.focus();
        }}
      >
        <Search className="sc-plan-place-search-icon" size={15} strokeWidth={1.7} aria-hidden />
        <input
          ref={inputRef}
          data-testid={`${testIdPrefix}-input`}
          value={query}
          role="combobox"
          aria-label="搜地点"
          aria-expanded={open && options.length > 0}
          aria-controls={`${testIdPrefix}-options`}
          aria-autocomplete="list"
          placeholder={placeholder}
          onChange={event => {
            setQuery(event.target.value);
            setPicked(null);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => { setFocused(true); setOpen(true); }}
          onBlur={() => { setFocused(false); window.setTimeout(() => setOpen(false), 120); }}
          onKeyDown={handleKeyDown}
        />
        {/* 收缩态的「瞥一眼」内容：落了钉/有词时显示地名，展开时让位给输入框。 */}
        <span className="sc-plan-place-search-collapsed-name" aria-hidden="true">{picked ?? query}</span>
        {busy && <span className="sc-plan-place-search-spinner" aria-label="搜索中" />}
        {(query !== '' || picked) && (
          <button
            type="button"
            className="sc-plan-place-search-clear"
            data-testid={`${testIdPrefix}-clear`}
            aria-label="清除地点搜索与定位钉"
            title="清除"
            onClick={clear}
          >
            <X size={12} strokeWidth={2} aria-hidden />
          </button>
        )}
      </div>
      {open && options.length > 0 && (
        <ul className="sc-plan-place-search-options" id={`${testIdPrefix}-options`} role="listbox">
          {options.map((option, index) => (
            <li key={option.kind === 'area' ? `area-${option.area.id}` : `place-${option.place.id}-${index}`} role="none">
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                data-testid={`${testIdPrefix}-${option.kind === 'area' ? 'area' : 'option'}-${index}`}
                data-kind={option.kind}
                onMouseEnter={() => setActive(index)}
                onMouseDown={event => event.preventDefault()}
                onClick={() => chooseOption(option)}
                className={`sc-plan-place-search-option${option.kind === 'area' ? ' is-area' : option.hasOutline ? ' is-outline' : ''}`}
              >
                {/* 2026-11-15 用户指令：下拉按从上往下的顺序编号，chat 卡只给前三个标题时
                    说「第 N 个」能和这里的编号对上号。 */}
                <span className="sc-plan-place-search-option-no" aria-hidden="true">{index + 1}</span>
                {option.kind === 'area' ? (
                  <>
                    <span className="sc-plan-place-search-option-name">
                      {option.area.name}
                      <span className="sc-plan-place-search-badge">选区</span>
                    </span>
                    <span className="sc-plan-place-search-option-address">
                      {option.area.level}边界 · 点一下框出这片范围
                    </span>
                  </>
                ) : (
                  <>
                    <span className="sc-plan-place-search-option-name">
                      {option.place.name}
                      {option.hasOutline && <span className="sc-plan-place-search-badge">有轮廓</span>}
                    </span>
                    {option.place.address && (
                      <span className="sc-plan-place-search-option-address">{option.place.address}</span>
                    )}
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
