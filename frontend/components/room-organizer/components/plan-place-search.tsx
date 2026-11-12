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

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Search, X } from 'lucide-react';
import {
  matchRecentPlaces,
  mergePlaceSuggestions,
  recentPlaces,
  rememberPlace,
  searchPlaces,
  type PlaceSuggestion,
} from '@/components/room-organizer/lib/place-search';
import { searchAreas, type PlaceArea } from '@/components/room-organizer/lib/place-area';

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
}

type Option =
  | { kind: 'area'; area: PlaceArea }
  | { kind: 'place'; place: PlaceSuggestion };

export default function PlanPlaceSearch({
  onPick,
  onPickArea,
  near,
  onClear,
  offset,
  width = 320,
  placeholder = '搜地点 / 场馆 / 地址，地图飞过去',
  testIdPrefix = 'plan-place-search',
}: PlanPlaceSearchProps) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PlaceSuggestion[]>([]);
  const [areas, setAreas] = useState<PlaceArea[]>([]);
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

  useEffect(() => {
    const keyword = query.trim();
    if (keyword.length < 2) {
      setHits([]);
      setAreas([]);
      setBusy(false);
      return undefined;
    }
    const controller = new AbortController();
    setBusy(true);
    const timer = window.setTimeout(() => {
      const nearPoint = nearLng != null && nearLat != null ? { lng: nearLng, lat: nearLat } : null;
      Promise.all([
        // 带上「当前看的地方」：天地图地名搜索只在小范围 mapBound 内出结果，
        // 没有提示点时 geocoder 会把 in77 猜到大同（2026-11-12 实测），围着画布搜就能命中。
        searchPlaces(keyword, { signal: controller.signal, center: nearPoint }),
        areaEnabledRef.current ? searchAreas(keyword, { signal: controller.signal, near: nearPoint }) : Promise.resolve([]),
      ])
        .then(([found, foundAreas]) => {
          if (controller.signal.aborted) return;
          setHits(found);
          setAreas(foundAreas);
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, nearLng, nearLat]);

  const keyword = query.trim();
  const options: Option[] = (() => {
    const list: Option[] = [];
    for (const area of areas) list.push({ kind: 'area', area });
    const recentMatches = keyword ? matchRecentPlaces(keyword) : recent;
    // 完全命中的新鲜结果压过「最近」：否则旧 geocoder 兜底点（如 in77→大同）
    // 会以同名「最近」身份排在真 POI 前面，回车默认第一条又飞回假点。
    for (const place of mergePlaceSuggestions(keyword, recentMatches, hits)) {
      list.push({ kind: 'place', place });
    }
    return list;
  })();

  function chooseOption(option: Option) {
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

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      setOpen(false);
      // 灵动岛：Esc 除了收下拉，也把整个岛收回（失焦后缩成胶囊/圆点）。
      inputRef.current?.blur();
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
                className={`sc-plan-place-search-option${option.kind === 'area' ? ' is-area' : ''}`}
              >
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
                    <span className="sc-plan-place-search-option-name">{option.place.name}</span>
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