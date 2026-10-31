'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { readReviewReturn, type ReviewReturn } from '../../review-share-page/review-return';
import {
  readBingoFavorites,
  readBingoReviews,
  toggleBingoFavorite,
  type BingoDeskEntry,
} from '../lib/bingo-desk';
import { readPlanPins, type PlanPin } from '../lib/review-pin-store';
import { ReviewIssuesCard } from './mode-shell';
import type { ReviewPin, ReviewPinFilter } from '../lib/review-pins';
import './bingo-desk.css';

/**
 * Bingo 自己的一栏。待评、收藏、回执，以及「在这块场地上点评」。
 * 不是晴光对话，也不是收起后那颗球。
 */
export function BingoDesk({
  planKey,
  layoutName,
  pins,
  items,
  pinFilter,
  activePinId,
  reviewing,
  onEnterReview,
  onClose,
  onFilter,
  onFocus,
  onResolve,
  onReturn,
  onConfirm,
}: {
  planKey: string;
  layoutName: string;
  pins: readonly ReviewPin[];
  items: readonly { id: string; name: string }[];
  pinFilter: ReviewPinFilter;
  activePinId: string | null;
  reviewing: boolean;
  onEnterReview(): void;
  onClose(): void;
  onFilter(filter: ReviewPinFilter): void;
  onFocus(id: string): void;
  onResolve(id: string): void;
  onReturn(id: string): void;
  onConfirm(): void;
}): JSX.Element {
  const [entries, setEntries] = useState<BingoDeskEntry[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<ReviewReturn | null>(null);
  const [storedPins, setStoredPins] = useState<PlanPin[]>([]);

  useEffect(() => {
    const load = () => {
      try {
        setEntries(readBingoReviews(window.localStorage));
        setFavorites(readBingoFavorites(window.localStorage));
        setReceipt(readReviewReturn(window.localStorage));
        setStoredPins(readPlanPins(planKey, window.localStorage));
      } catch {
        setEntries([]);
        setFavorites([]);
        setReceipt(null);
        setStoredPins([]);
      }
    };
    load();
    window.addEventListener('storage', load);
    window.addEventListener('scendance-bingo', load);
    return () => {
      window.removeEventListener('storage', load);
      window.removeEventListener('scendance-bingo', load);
    };
  }, [planKey, reviewing, pins.length]);

  const saved = entries.filter((entry) => favorites.includes(entry.id));
  const pinCount = reviewing ? pins.filter((pin) => pin.status === 'open').length : storedPins.filter((pin) => pin.status === 'open').length;
  const receiptMatches = receipt !== null && (receipt.planKey === planKey || entries.some((entry) => entry.planKey === receipt.planKey));

  const star = (entry: BingoDeskEntry) => {
    try {
      setFavorites(toggleBingoFavorite(window.localStorage, entry.id));
    } catch {
      /* 写不进就保持刚才读到的收藏 */
    }
  };

  return (
    <aside className="sc-agent-panel sc-rail-desk" data-desk="bingo" aria-label="Bingo">
      <header className="ap-head">
        <strong>Bingo</strong>
        <span className="sc-desk-kicker">评审</span>
        <button type="button" className="ap-close" aria-label="收起 Bingo" title="收起 Bingo" onClick={onClose}><X size={20} aria-hidden="true" /></button>
      </header>
      <div className="sc-desk-body">
        <section className="sc-desk-block" aria-label="这块场地">
          <header>
            <strong>{layoutName || '未命名活动'}</strong>
            <span>{pinCount === 0 ? '还没有钉' : `${pinCount} 条未解决`}</span>
          </header>
          <p>在平面上点位置留言。侧栏只是这些钉的清单。</p>
          <button type="button" className="sc-desk-primary" aria-pressed={reviewing} onClick={onEnterReview}>
            {reviewing ? '正在场地上点评' : '在这块场地上点评'}
          </button>
          <Link href="/review/">打开方案页，同一套落钉</Link>
        </section>
        {reviewing && (
          <ReviewIssuesCard
            pins={pins}
            items={items}
            filter={pinFilter}
            activeId={activePinId}
            onFilter={onFilter}
            onFocus={onFocus}
            onResolve={onResolve}
            onReturn={onReturn}
            onConfirm={onConfirm}
          />
        )}
        <section className="sc-desk-block" aria-label="待评">
          <header><strong>待评</strong><span>{entries.length === 0 ? '空' : `${entries.length} 份`}</span></header>
          {entries.length === 0 ? <p>还没有待评的方案。发出评审链接后，会出现在这里。</p> : (
            <ul>
              {entries.map((entry) => (
                <li key={entry.id}>
                  <Link href={entry.href}>{entry.title}</Link>
                  <span>待评</span>
                  <button type="button" aria-pressed={favorites.includes(entry.id)} aria-label={favorites.includes(entry.id) ? `取消收藏 ${entry.title}` : `收藏 ${entry.title}`} onClick={() => star(entry)}>
                    {favorites.includes(entry.id) ? '已收藏' : '收藏'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="sc-desk-block" aria-label="收藏">
          <header><strong>收藏</strong></header>
          {saved.length === 0 ? <p>还没有收藏的评审。</p> : (
            <ul>
              {saved.map((entry) => <li key={entry.id}><Link href={entry.href}>{entry.title}</Link><span>收藏</span></li>)}
            </ul>
          )}
        </section>
        <section className="sc-desk-block" aria-label="回执">
          <header><strong>回执</strong></header>
          {receipt && receiptMatches
            ? <p role="status">评审已回。{formatWhen(receipt.at)} 记下完成，球上会带红环。</p>
            : <p>还没有完成回执。对方在方案页点「完成评审」后，这里会记下。</p>}
        </section>
      </div>
    </aside>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
