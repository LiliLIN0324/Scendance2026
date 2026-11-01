'use client';

import { useState } from 'react';

/** 图片没到之前先立一个占位，别让整排卡片看起来像坏掉。 */
export function MaterialThumb({ src }: { src: string }): JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="sc-material-thumb-empty">预览未载入</span>;
  return <>
    {!loaded && <span className="sc-material-thumb-loading" aria-hidden="true">◇</span>}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img className={`sc-material-thumb${loaded ? ' is-loaded' : ''}`} src={src} alt="" draggable={false} loading="lazy" decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)}/>
  </>;
}
