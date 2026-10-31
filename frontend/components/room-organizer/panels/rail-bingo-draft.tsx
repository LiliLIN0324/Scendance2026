'use client';

import { useEffect, useState } from 'react';
import { readReviewReturn, reviewOrbShouldTurnRed } from '../../review-share-page/review-return';

/**
 * 窄轨第三格：Bingo / 草稿。
 * 夹在晴光和场地之间，不放轨脚，也不是第二颗晴光头像。
 * 有评审回执时只加一圈红，球已经不浮在画布上。
 */
export function RailBingoDraft({ label, title, error }: {
  label: string;
  title: string;
  error: boolean;
}): JSX.Element {
  const [returned, setReturned] = useState(false);
  useEffect(() => {
    const sync = () => {
      try {
        setReturned(reviewOrbShouldTurnRed(readReviewReturn(window.localStorage)));
      } catch {
        setReturned(false);
      }
    };
    sync();
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  return (
    <p
      role="status"
      data-rail="bingo"
      className={`sc-rail-bingo sc-rail-draft${error ? ' has-error' : ''}${returned ? ' is-review-returned' : ''}`}
      title={returned ? `${title} · 评审已回` : title}
    >
      {label}
    </p>
  );
}
