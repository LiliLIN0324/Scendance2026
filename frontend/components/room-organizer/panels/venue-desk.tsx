'use client';

import { Star, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { preserveCurrentActivity } from '../../../lib/production-plan';
import { BLANK_VENUE, createBlankVenue } from '../lib/blank-venue';
import { isUntouched } from '../lib/restore-point';
import { SCENE_PRESETS, type ScenePresetKey } from '../lib/scene-presets';
import { readVenueFavorites, toggleVenueFavorite } from '../lib/venue-favorites';
import { loadScenePreset } from '../three/scene-presets';
import type { RoomLayout } from '../lib/types';
import './bingo-desk.css';

type Choice = ScenePresetKey | 'blank';

/**
 * 场地库自己的一栏：模板场馆和收藏。
 * 不打开晴光，也不打开 Bingo。
 */
export function VenueDesk({
  layout,
  onApply,
  onClose,
}: {
  layout: RoomLayout;
  onApply(layout: RoomLayout): void;
  onClose(): void;
}): JSX.Element {
  const current = useRef(layout);
  current.current = layout;
  const loading = useRef(false);
  const mounted = useRef(true);
  const [favorites, setFavorites] = useState<ScenePresetKey[]>([]);
  const [busy, setBusy] = useState<Choice | null>(null);
  const [pending, setPending] = useState<Choice | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    mounted.current = true;
    try { setFavorites(readVenueFavorites(window.localStorage)); } catch { setFavorites([]); }
    return () => { mounted.current = false; };
  }, []);

  const star = (key: ScenePresetKey) => {
    try { setFavorites(toggleVenueFavorite(window.localStorage, key)); } catch { /* 保持现状 */ }
  };

  async function applyChoice(choice: Choice): Promise<void> {
    if (loading.current) return;
    const before = current.current;
    loading.current = true;
    setPending(null);
    setBusy(choice);
    setNotice('');
    try {
      const next = choice === 'blank' ? createBlankVenue(before) : await loadScenePreset(choice);
      if (!mounted.current) return;
      if (current.current !== before) throw new Error('载入期间画布已有改动，已保留当前草稿。');
      onApply(choice === 'blank' ? next : preserveCurrentActivity(before, { ...next, ...(before.id ? { id: before.id, name: before.name } : {}) }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '场地没有换上，请重试。');
    } finally {
      loading.current = false;
      setBusy(null);
    }
  }

  const press = (choice: Choice) => {
    if (busy !== null) return;
    if (isUntouched(current.current)) { void applyChoice(choice); return; }
    setPending(choice);
  };

  const rows: { key: Choice; name: string; detail: string }[] = [
    { key: 'blank', name: '空白场地', detail: `${BLANK_VENUE.width} × ${BLANK_VENUE.depth} 米 · 可改尺寸` },
    ...(Object.keys(SCENE_PRESETS) as ScenePresetKey[]).map((key) => ({
      key,
      name: SCENE_PRESETS[key].name,
      detail: SCENE_PRESETS[key].description,
    })),
  ];
  const favoriteRows = rows.filter((row): row is { key: ScenePresetKey; name: string; detail: string } => row.key !== 'blank' && favorites.includes(row.key));

  return (
    <aside className="sc-agent-panel sc-rail-desk" data-desk="venue" aria-label="场地库">
      <header className="ap-head">
        <strong>场地</strong>
        <span className="sc-desk-kicker">模板与收藏</span>
        <button type="button" className="ap-close" aria-label="收起场地" title="收起场地" onClick={onClose}><X size={20} aria-hidden="true" /></button>
      </header>
      <div className="sc-desk-body">
        <section className="sc-desk-block" aria-label="收藏的场馆">
          <header><strong>收藏的场馆</strong></header>
          {favoriteRows.length === 0 ? <p>还没有收藏的场馆。在下面的模板上点星。</p> : (
            <ul>
              {favoriteRows.map((row) => (
                <li key={row.key}>
                  <button type="button" onClick={() => press(row.key)} disabled={busy !== null}>{row.name}</button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="sc-desk-block" aria-label="模板场馆">
          <header><strong>模板场馆</strong></header>
          <p>点一张就换上当前布置。已经在改的方案会先问一句。</p>
          <ul>
            {rows.map((row) => {
              const preset = row.key === 'blank' ? null : row.key;
              const saved = preset !== null && favorites.includes(preset);
              return (
              <li key={row.key}>
                <button type="button" disabled={busy !== null} onClick={() => press(row.key)}>
                  <span>{row.name}</span>
                  <small>{busy === row.key ? '正在换上…' : row.detail}</small>
                </button>
                {preset && (
                  <button
                    type="button"
                    aria-pressed={saved}
                    aria-label={saved ? `取消收藏 ${row.name}` : `收藏 ${row.name}`}
                    onClick={() => star(preset)}
                  >
                    <Star size={14} aria-hidden="true" fill={saved ? 'currentColor' : 'none'} />
                  </button>
                )}
                {pending === row.key && (
                  <div role="group" aria-label={`确认载入${row.name}`}>
                    <p>会替换当前布置。</p>
                    <button type="button" onClick={() => { void applyChoice(row.key); }}>确认换成</button>
                    <button type="button" onClick={() => setPending(null)}>取消</button>
                  </div>
                )}
              </li>
              );
            })}
          </ul>
          {notice && <p role="status">{notice}</p>}
        </section>
      </div>
    </aside>
  );
}
