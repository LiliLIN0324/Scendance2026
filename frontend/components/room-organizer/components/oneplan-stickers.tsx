'use client';

/**
 * OnePlan 贴纸 React 组件（H4-b）——图例/面板里用真实 OnePlan SVG，加载失败或映射缺失时
 * 回落到既有 Lucide 线条图标（`planningIcon()`），保证任何素材缺口都不会白屏。
 *
 * 画布走 `../lib/oneplan-stickers` 的 Canvas helper（同一份映射表），本文件只负责 HTML 侧：
 * `<img src="/oneplan-icons/...">` 由浏览器缓存，无需手动 Image 缓存。
 */

import { useState, type CSSProperties } from 'react';
import { planningIcon } from './outdoor-plan-icons';
import {
  ONEOPLAN_CHIP_FILL,
  oneplanStickerSrc,
  oneplanStickerUsesChip,
  type OneplanStickerDescriptor,
} from '../lib/oneplan-stickers';
import { PLANNING_ICON_SIZES } from '@/lib/outdoor-plan-tokens';
import type { PlanningIconName } from '@/lib/outdoor-plan-tokens';

export interface OneplanStickerProps {
  /** 解析好的贴纸；null/undefined 时直接用回落图标。 */
  sticker?: OneplanStickerDescriptor | null;
  /** 贴纸缺失时的 Lucide 回落名（图例条目自带 icon 字段，可直接透传）。 */
  fallbackIcon?: PlanningIconName;
  size?: number;
  color?: string;
  title?: string;
  style?: CSSProperties;
}

/**
 * OnePlan 贴纸（<img> 级别）。图片 404/解码失败时自动切回 Lucide 图标，
 * 因此素材补齐过程中任意 slug 缺文件都只是「少一张贴纸」，不会破坏布局。
 */
export function OneplanSticker({
  sticker,
  fallbackIcon,
  size = PLANNING_ICON_SIZES.legend,
  color,
  title,
  style,
}: OneplanStickerProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = sticker ? oneplanStickerSrc(sticker) : null;
  const FallbackIcon = planningIcon(sticker?.icon ?? fallbackIcon ?? 'shapes');
  const chip = oneplanStickerUsesChip(sticker);

  if (!src || failedSrc === src) {
    return <FallbackIcon size={size} color={color} strokeWidth={2} aria-hidden />;
  }

  return (
    <span
      data-oneplan-sticker-chip={chip ? `${sticker!.kind}:${sticker!.slug}` : undefined}
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        background: chip ? ONEOPLAN_CHIP_FILL : 'transparent',
        flex: '0 0 auto',
        verticalAlign: 'middle',
      }}
    >
      <img
        src={src}
        alt={title ?? ''}
        title={title}
        width={size}
        height={size}
        draggable={false}
        data-oneplan-sticker={`${sticker!.kind}:${sticker!.slug}`}
        onError={() => setFailedSrc(src)}
        style={{
          width: size,
          height: size,
          objectFit: 'contain',
          display: 'block',
          ...style,
        }}
      />
    </span>
  );
}

export type { OneplanStickerDescriptor };