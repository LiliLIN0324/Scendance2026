'use client';

/**
 * 画布左上角「搜地点」框（用户 m05472：要和地图 App 一样，在左上角）。
 *
 * 输入即出建议：最近选过的地点 + 天地图模糊匹配（`/api/tdt-search`），
 * ↑↓ 选择、Enter 确认、Esc 关闭；选中只做「视图飞过去 + 落定位钉」，
 * 不改 plan / anchor。组件只负责输入与建议条，落钉由调用方把 lngLat 交给画布。
 */

import { useEffect, useState, type CSSProperties, type KeyboardEvent } from 'react';
import {
  matchRecentPlaces,
  recentPlaces,
  rememberPlace,
  searchPlaces,
  type PlaceSuggestion,
} from '@/components/room-organizer/lib/place-search';

const SEARCH_DEBOUNCE_MS = 350;

export interface PlanPlaceSearchProps {
  /** 选中一条地点建议。 */
  onPick: (place: PlaceSuggestion) => void;
  /** 点「清除」时回调（调用方据此撤掉定位钉）。 */
  onClear?: () => void;
  /** 左上角偏移，默认贴画布左上 16 / 16。 */
  offset?: { left?: number; top?: number };
  width?: number;
  placeholder?: string;
  /** 便于验收脚本定位；默认 `plan-place-search`。 */
  testIdPrefix?: string;
}

export default function PlanPlaceSearch({
  onPick,
  onClear,
  offset,
  width = 320,
  placeholder = '搜地点 / 场馆 / 地址，地图飞过去',
  testIdPrefix = 'plan-place-search',
}: PlanPlaceSearchProps) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PlaceSuggestion[]>([]);
  const [recent, setRecent] = useState<PlaceSuggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    setRecent(recentPlaces());
  }, []);

  useEffect(() => {
    const keyword = query.trim();
    if (keyword.length < 2) {
      setHits([]);
      setBusy(false);
      return undefined;
    }
    const controller = new AbortController();
    setBusy(true);
    const timer = window.setTimeout(() => {
      searchPlaces(keyword, { signal: controller.signal })
        .then(found => {
          if (!controller.signal.aborted) setHits(found);
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  const keyword = query.trim();
  const options = (() => {
    const recentMatches = keyword ? matchRecentPlaces(keyword) : recent;
    const merged: PlaceSuggestion[] = [];
    const seen = new Set<string>();
    for (const item of [...recentMatches, ...hits]) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
    return merged;
  })();

  function choose(place: PlaceSuggestion) {
    setQuery(place.name);
    setPicked(place.name);
    setRecent(rememberPlace(place) ?? recentPlaces());
    setHits([]);
    setOpen(false);
    setActive(-1);
    onPick(place);
  }

  function clear() {
    setQuery('');
    setHits([]);
    setPicked(null);
    setOpen(false);
    setActive(-1);
    onClear?.();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      setOpen(false);
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
      if (hit) choose(hit);
    }
  }

  const box: CSSProperties = {
    position: 'absolute',
    left: offset?.left ?? 16,
    top: offset?.top ?? 16,
    zIndex: 6,
    width,
  };

  return (
    <div data-testid={testIdPrefix} style={box}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: 38,
          padding: '0 12px',
          borderRadius: 999,
          background: 'rgba(20, 20, 22, 0.92)',
          color: '#ffffff',
          boxShadow: '0 6px 20px rgba(20, 20, 22, 0.22)',
        }}
      >
        <span aria-hidden style={{ fontSize: 13, opacity: 0.7 }}>
          ⌕
        </span>
        <input
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
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={handleKeyDown}
          style={{
            flex: 1,
            minWidth: 0,
            height: 32,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: '#ffffff',
            fontSize: 12,
            fontFamily: 'inherit',
          }}
        />
        {busy && <span style={{ fontSize: 11, opacity: 0.6 }}>…</span>}
        {(query !== '' || picked) && (
          <button
            type="button"
            data-testid={`${testIdPrefix}-clear`}
            aria-label="清除地点搜索与定位钉"
            onClick={clear}
            style={{ all: 'unset', cursor: 'pointer', fontSize: 11, opacity: 0.72, padding: '2px 4px' }}
          >
            清除
          </button>
        )}
      </div>
      {open && options.length > 0 && (
        <ul
          id={`${testIdPrefix}-options`}
          role="listbox"
          style={{
            listStyle: 'none',
            margin: '6px 0 0',
            padding: 6,
            borderRadius: 12,
            background: '#ffffff',
            color: 'var(--sc-ink, #141416)',
            boxShadow: '0 10px 28px rgba(20, 20, 22, 0.22)',
            maxHeight: 260,
            overflowY: 'auto',
          }}
        >
          {options.map((option, index) => (
            <li key={`${option.id}-${index}`} role="none">
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                data-testid={`${testIdPrefix}-option-${index}`}
                onMouseEnter={() => setActive(index)}
                onMouseDown={event => event.preventDefault()}
                onClick={() => choose(option)}
                style={{
                  all: 'unset',
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: index === active ? 'rgba(20, 20, 22, 0.06)' : 'transparent',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600 }}>{option.name}</span>
                {option.address && <span style={{ fontSize: 11, opacity: 0.62 }}>{option.address}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}