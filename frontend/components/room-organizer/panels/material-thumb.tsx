'use client';

import { useEffect, useState } from 'react';

/**
 * 缩略图缓存：src 载入过就记在这里，之后任何一次挂载都直接给「已载入」。
 * 物料面板切 lane、换类目、关掉再开都会重建整棵卡片树；只有这里记着
 * 「这张图我见过」，才不会每次都先闪一遍 ◇ 再等 onLoad 回调。
 */
const readySrcs = new Set<string>();
const failedSrcs = new Set<string>();
const warmingSrcs = new Set<string>();

type ThumbState = 'loading' | 'ready' | 'failed';

function thumbState(src: string): ThumbState {
  if (readySrcs.has(src)) return 'ready';
  if (failedSrcs.has(src)) return 'failed';
  return 'loading';
}

/**
 * 预热一批缩略图：这一屏先取好，滚到下一屏也已经是图。
 * 幂等：已载入、已失败、已在下行队列里的地址直接跳过，重复调用不会多发请求。
 */
export function warmMaterialThumbs(sources: readonly (string | undefined)[], concurrency = 6): void {
  // 静态导出会先在服务端渲染一遍，那边没有 Image。
  if (typeof window === 'undefined' || typeof Image === 'undefined') return;
  const queue: string[] = [];
  for (const src of sources) {
    if (!src || readySrcs.has(src) || failedSrcs.has(src) || warmingSrcs.has(src) || queue.includes(src)) continue;
    queue.push(src);
  }
  const next = (): void => {
    const src = queue.shift();
    if (!src) return;
    warmingSrcs.add(src);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => { warmingSrcs.delete(src); readySrcs.add(src); next(); };
    image.onerror = () => { warmingSrcs.delete(src); failedSrcs.add(src); next(); };
    image.src = src;
  };
  for (let started = 0; started < Math.min(concurrency, queue.length); started += 1) next();
}

/** 测试与「重新载入」用：忘掉已缓存的结果。 */
export function clearMaterialThumbCache(): void {
  readySrcs.clear();
  failedSrcs.clear();
  warmingSrcs.clear();
}

/** 图片没到之前先立一个占位，别让整排卡片看起来像坏掉。 */
export function MaterialThumb({ src }: { src: string }): JSX.Element {
  // 首帧直接读缓存：命中就是「已载入」，不再走一遍占位 → 淡入。
  const [state, setState] = useState<ThumbState>(() => thumbState(src));
  // 同一张卡片节点被复用到另一个地址时按缓存重判，不沿用上一张的结果。
  useEffect(() => { setState(thumbState(src)); }, [src]);
  if (state === 'failed') return <span className="sc-material-thumb-empty">预览未载入</span>;
  return <>
    {state !== 'ready' && <span className="sc-material-thumb-loading" aria-hidden="true">◇</span>}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img className={`sc-material-thumb${state === 'ready' ? ' is-loaded' : ''}`} src={src} alt="" draggable={false} loading="lazy" decoding="async"
      onLoad={() => { readySrcs.add(src); setState('ready'); }}
      onError={() => { failedSrcs.add(src); setState('failed'); }}/>
  </>;
}
