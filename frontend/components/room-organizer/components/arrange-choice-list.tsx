'use client';

/**
 * 语义三选一的候选条。点一款只通知父组件去出预览，这里不写方案。
 * 每款带目录缩略图；没有图时用模板贴纸。底下常驻「用 Aholo 生成一款」，
 * 只通知父组件打开现成的额度确认，本组件不提交、不扣费。
 */
/* eslint-disable @next/next/no-img-element -- 缩略图用物料库现成 webp，与属性卡模型条一致 */
import { useState, type CSSProperties } from 'react';
import { PLANNING_SURFACE, PLANNING_TEXT, PLANNING_TYPOGRAPHY } from '@/lib/outdoor-plan-tokens';
import { facilitySticker } from '../lib/oneplan-stickers';
import { OneplanSticker } from './oneplan-stickers';

export interface ArrangeChoiceListItem {
  slug: string;
  name: string;
  reason: string;
  count: number;
  /** 目录缩略图。空字符串改用贴纸。 */
  thumb: string;
  /** 落库模板，用来找贴纸。 */
  templateId: string;
}

export interface ArrangeChoiceListProps {
  choices: readonly ArrangeChoiceListItem[];
  busy?: boolean;
  onPick(slug: string): void;
  onRefresh(): void;
  onCancel(): void;
  /** 打开现成的 Aholo 额度确认。调用方负责真正的表单，这里只发通知。 */
  onGenerate(): void;
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};

const buttonStyle: CSSProperties = {
  padding: '4px 8px',
  borderRadius: 6,
  border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
  background: PLANNING_SURFACE.fieldBg,
  color: PLANNING_SURFACE.panelText,
  cursor: 'pointer',
  fontSize: PLANNING_TYPOGRAPHY.panel,
};

const thumbBox: CSSProperties = {
  width: 40,
  height: 40,
  flex: '0 0 auto',
  borderRadius: 4,
  overflow: 'hidden',
  background: PLANNING_SURFACE.panelBg,
  display: 'grid',
  placeItems: 'center',
};

function ChoiceThumb({ thumb, templateId }: { thumb: string; templateId: string }) {
  const [failed, setFailed] = useState(false);
  const showPhoto = thumb.length > 0 && !failed;
  return (
    <span data-testid={showPhoto ? 'arrange-choice-thumb' : 'arrange-choice-sticker'} style={thumbBox}>
      {showPhoto ? (
        <img
          src={thumb}
          alt=""
          width={40}
          height={40}
          draggable={false}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <OneplanSticker sticker={facilitySticker(templateId)} size={28} />
      )}
    </span>
  );
}

export function ArrangeChoiceList({ choices, busy = false, onPick, onRefresh, onCancel, onGenerate }: ArrangeChoiceListProps) {
  if (choices.length === 0) return null;
  return (
    <div role="group" aria-label="候选方案" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {choices.map(choice => (
        <div key={choice.slug} style={rowStyle}>
          <button
            type="button"
            aria-label={choice.name}
            disabled={busy}
            onClick={() => onPick(choice.slug)}
            style={{
              ...buttonStyle,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              textAlign: 'left',
              padding: 4,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            <ChoiceThumb thumb={choice.thumb} templateId={choice.templateId} />
            <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontWeight: 600, lineHeight: '16px' }}>{choice.name}</span>
              <span style={{ color: PLANNING_TEXT.muted, fontSize: PLANNING_TYPOGRAPHY.hint, lineHeight: '14px' }}>
                {choice.reason} · {choice.count} 件
              </span>
            </span>
          </button>
        </div>
      ))}
      <button
        type="button"
        data-testid="arrange-aholo-generate"
        disabled={busy}
        onClick={onGenerate}
        style={{
          ...buttonStyle,
          width: '100%',
          borderColor: PLANNING_SURFACE.selectedBorder,
          background: PLANNING_SURFACE.activeBg,
          color: PLANNING_SURFACE.selectedBorder,
          fontWeight: 600,
          cursor: busy ? 'wait' : 'pointer',
        }}
      >
        用 Aholo 生成一款
      </button>
      <span style={{ color: PLANNING_TEXT.muted, fontSize: PLANNING_TYPOGRAPHY.hint, lineHeight: '14px' }}>
        确认额度后才会提交，生成完可以在这里预览。
      </span>
      <div style={rowStyle}>
        <button type="button" disabled={busy} onClick={onRefresh} style={{ ...buttonStyle, cursor: busy ? 'wait' : 'pointer' }}>
          换一批
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '2px 6px',
            border: 'none',
            background: 'transparent',
            color: PLANNING_SURFACE.panelText,
            cursor: 'pointer',
            fontSize: PLANNING_TYPOGRAPHY.hint,
          }}
        >
          取消
        </button>
      </div>
    </div>
  );
}
