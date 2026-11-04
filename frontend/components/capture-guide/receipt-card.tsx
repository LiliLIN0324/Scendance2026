'use client';

import { useCallback, useState } from 'react';
import { MaterialSymbol } from '@/components/room-organizer/panels/material-symbol';
import { Check, ClipboardCheck, Copy, Download } from '@/components/solid-icons';

/**
 * 采集回执卡：把现场结论做成一张能给同事看的图片 / 一段能粘贴的文字。
 * 回执是副产物——真正的交付是「出 3D」那一步，这里只负责把现场证据带走。
 */

export interface ReceiptCardProps {
  total: number;
  verdictLabel: string;
  verdictTone: string;
  stations: number;
  layers: number;
  coverageDeg: number;
  gpsCoverage: number;
  scaleText: string;
  generatedAt: number | null;
}

const CARD_W = 1080;
const CARD_H = 1350;

function stampOf(at: number | null): string {
  const date = at === null ? new Date() : new Date(at);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function cardLines(props: ReceiptCardProps): Array<[string, string]> {
  return [
    ['机位', `${props.stations} 个`],
    ['层数', `${props.layers} / 3`],
    ['环向覆盖', `${Math.round(props.coverageDeg)}°`],
    ['GPS 覆盖', `${Math.round(props.gpsCoverage * 100)}%`],
    ['真实尺度', props.scaleText],
  ];
}

function summaryText(props: ReceiptCardProps): string {
  return [
    '幕景 · 拍摄场地回执',
    stampOf(props.generatedAt),
    `评分 ${props.total}/100 · ${props.verdictLabel}`,
    cardLines(props).map(([label, value]) => `${label} ${value}`).join(' · '),
    'scendance.capture/v1',
  ].join('\n');
}

function drawCard(props: ReceiptCardProps): HTMLCanvasElement {
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W * scale;
  canvas.height = CARD_H * scale;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('这个浏览器不支持画布导出。');
  context.scale(scale, scale);
  const family = '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, CARD_W, CARD_H);

  context.fillStyle = '#4A7C59';
  context.fillRect(0, 0, CARD_W, 14);

  context.fillStyle = '#1c1c1e';
  context.font = `600 34px ${family}`;
  context.fillText('幕景 · 拍摄场地回执', 72, 116);

  context.fillStyle = '#8a8a8f';
  context.font = `400 24px ${family}`;
  context.fillText(stampOf(props.generatedAt), 72, 158);

  context.fillStyle = '#1c1c1e';
  context.font = `650 190px ${family}`;
  context.fillText(String(props.total), 72, 360);
  const width = context.measureText(String(props.total)).width;
  context.fillStyle = '#8a8a8f';
  context.font = `400 48px ${family}`;
  context.fillText('/ 100', 72 + width + 16, 360);

  const toneHex = props.verdictTone === 'ready' ? '#4A7C59' : props.verdictTone === 'supplement' ? '#96651F' : '#B4443C';
  context.fillStyle = toneHex;
  context.font = `600 34px ${family}`;
  context.fillText(props.verdictLabel, 74, 424);

  context.fillStyle = '#e6e7e9';
  context.fillRect(72, 480, CARD_W - 144, 2);

  let y = 556;
  for (const [label, value] of cardLines(props)) {
    context.fillStyle = '#6f7075';
    context.font = `400 30px ${family}`;
    context.fillText(label, 72, y);
    context.fillStyle = '#1c1c1e';
    context.font = `600 32px ${family}`;
    const valueWidth = context.measureText(value).width;
    context.fillText(value, CARD_W - 72 - valueWidth, y);
    y += 74;
  }

  context.fillStyle = '#f4f5f6';
  context.fillRect(0, CARD_H - 152, CARD_W, 152);
  context.fillStyle = '#6f7075';
  context.font = `400 24px ${family}`;
  context.fillText('scendance.capture/v1 · 现场自检，不代表重建已成功', 72, CARD_H - 92);
  return canvas;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReceiptCard(props: ReceiptCardProps): JSX.Element {
  const [note, setNote] = useState('');

  const exportImage = useCallback(async () => {
    try {
      const canvas = drawCard(props);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('画布没有生成图片。');
      const stamp = new Date(props.generatedAt ?? Date.now()).toISOString().slice(0, 10);
      downloadBlob(blob, `scendance-capture-${stamp}.png`);
      setNote('回执图片已保存，可直接发群。');
    } catch (failure) {
      setNote(failure instanceof Error ? failure.message : '导出失败，请再试一次。');
    }
  }, [props]);

  const copySummary = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(summaryText(props));
      setNote('回执文字已复制。');
    } catch {
      setNote('浏览器不允许自动复制，请手动选文字。');
    }
  }, [props]);

  const shareSummary = useCallback(async () => {
    const text = summaryText(props);
    const nav = navigator as Navigator & { share?: (data: { title: string; text: string }) => Promise<void> };
    if (typeof nav.share !== 'function') {
      setNote('这个浏览器不支持系统分享；已复制文字，粘贴给对方即可。');
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        setNote('系统分享不可用，复制也被浏览器拦住了。');
      }
      return;
    }
    try {
      await nav.share({ title: '幕景 · 拍摄场地回执', text });
      setNote('已调起系统分享。');
    } catch {
      setNote('分享被取消。');
    }
  }, [props]);

  return (
    <section className="cg-receipt-card" data-testid="receipt-card">
      <div className="cg-receipt-card-top">
        <span className="cg-receipt-card-brand">幕景</span>
        <span>{stampOf(props.generatedAt)}</span>
      </div>
      <div className="cg-receipt-card-main">
        <div className="cg-receipt-card-score">
          <strong>{props.total}</strong>
          <span>/ 100</span>
        </div>
        <span className={`cg-verdict cg-verdict--${props.verdictTone}`}>{props.verdictLabel}</span>
      </div>
      <dl className="cg-receipt-card-rows">
        {cardLines(props).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="cg-receipt-card-foot">scendance.capture/v1 · 现场自检，不代表重建已成功</p>
      <div className="cg-receipt-actions">
        <button type="button" className="cg-btn cg-btn--primary" onClick={() => void exportImage()} data-testid="receipt-image">
          <Download size={16} aria-hidden="true" />
          存成图片
        </button>
        <button type="button" className="cg-btn cg-btn--ghost" onClick={() => void copySummary()}>
          <Copy size={16} aria-hidden="true" />
          复制文字
        </button>
        <button type="button" className="cg-btn cg-btn--ghost" onClick={() => void shareSummary()}>
          <MaterialSymbol name="share" size={16} aria-hidden="true" />
          分享
        </button>
      </div>
      {note && (
        <p className="cg-note" role="status">
          <Check size={14} aria-hidden="true" /> {note}
        </p>
      )}
      <p className="cg-note">
        <ClipboardCheck size={14} aria-hidden="true" /> 回执只是现场证据；重建产物在上一步「出 3D」里导出。
      </p>
    </section>
  );
}
