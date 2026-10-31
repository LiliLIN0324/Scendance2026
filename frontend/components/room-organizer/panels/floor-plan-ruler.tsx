'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from 'react';
import { containedImagePoint, type ImagePoint } from '@/lib/source-storage';
import { normalizeRulerPoints, proposeScaleMeters } from '@/lib/floor-plan-scale';
import type { VenuePhoto } from './venue-photos-panel';
import './floor-plan-ruler.css';

export type RulerConfirmation = {
  sourceImageId: string;
  sourceAssetId?: string;
  start: { x: number; z: number };
  end: { x: number; z: number };
  valueMeters: number;
  aiSuggested: boolean;
};

interface Props {
  image: VenuePhoto;
  dimensionText?: string;
  busy?: boolean;
  focusRequest?: number;
  onConfirm(value: RulerConfirmation): void | Promise<void>;
}

export function FloorPlanRuler({ image, dimensionText = '', busy = false, focusRequest = 0, onConfirm }: Props): JSX.Element {
  const mapRef = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<ImagePoint[]>([]);
  const [meters, setMeters] = useState('');
  const [aiSuggested, setAiSuggested] = useState(false);
  const [notice, setNotice] = useState('');
  const confirming = useRef(false);

  useEffect(() => {
    setPoints([]);
    setMeters('');
    setAiSuggested(false);
    setNotice('');
  }, [image.id]);

  const normalizedSpan = useMemo(() => {
    if (points.length < 2 || !image.width || !image.height) return 0;
    return normalizeRulerPoints(points[0]!, points[1]!, image.width, image.height).normalizedSpan;
  }, [points, image.width, image.height]);

  useEffect(() => {
    if (points.length !== 2 || !image.width || !image.height) return;
    const proposal = proposeScaleMeters({
      normalizedSpan,
      imageWidth: image.width,
      imageHeight: image.height,
      dimensionText,
    });
    setMeters(String(proposal.meters));
    setAiSuggested(proposal.aiSuggested);
  }, [points, normalizedSpan, image.width, image.height, dimensionText]);

  useEffect(() => {
    if (focusRequest > 0) mapRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [focusRequest]);

  function addPoint(clientX: number, clientY: number): void {
    if (busy || !image.width || !image.height || !mapRef.current) return;
    const point = containedImagePoint(clientX, clientY, mapRef.current.getBoundingClientRect(), image.width, image.height);
    if (!point) return;
    setPoints(current => (current.length >= 2 ? [point] : [...current, point]));
    setNotice('');
  }

  async function confirm(): Promise<void> {
    if (confirming.current || busy || points.length !== 2 || !image.width || !image.height) return;
    const value = Number(meters);
    if (!Number.isFinite(value) || value <= 0) {
      setNotice('请输入大于零的米数。');
      return;
    }
    const { start, end } = normalizeRulerPoints(points[0]!, points[1]!, image.width, image.height);
    confirming.current = true;
    setNotice('');
    try {
      await onConfirm({
        sourceImageId: image.id,
        ...(image.assetId ? { sourceAssetId: image.assetId } : {}),
        start,
        end,
        valueMeters: value,
        aiSuggested,
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '标尺未能确认，请重试。');
    } finally {
      confirming.current = false;
    }
  }

  const line = points.length === 2 && image.width && image.height
    ? normalizeRulerPoints(points[0]!, points[1]!, image.width, image.height)
    : null;

  // 图片元数据可能还没加载完；先落成数值，避免在回调里丢失收窄。
  const imageWidth = image.width ?? 0;
  const imageHeight = image.height ?? 0;

  return (
    <section className="rc-ruler" aria-label="两点定标尺">
      <header>
        <h4>定标尺 · 上传主路径</h4>
        <p className="cr-hint">在图上点<strong>两个端点</strong>，确认这段的真实长度（米）。{aiSuggested && meters ? ' AI 建议，可改。' : ''}</p>
      </header>
      <div
        ref={mapRef}
        className="rc-image-map rc-ruler-map"
        role="button"
        aria-label="在平面图上标记标尺两个端点"
        aria-disabled={busy}
        tabIndex={busy ? -1 : 0}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
        }}
        onClick={event => addPoint(event.clientX, event.clientY)}
      >
        <img src={image.url} alt={`平面图：${image.name}`} />
        {imageWidth > 0 && imageHeight > 0 && (
          <svg viewBox={`0 0 ${imageWidth} ${imageHeight}`} preserveAspectRatio="xMidYMid meet">
            {points.map((point, index) => (
              <g key={index}>
                <circle cx={point.x} cy={point.z} r={Math.max(4, imageWidth / 120)} fill="#4A7C59" />
                <text x={point.x} y={point.z - Math.max(6, imageWidth / 100)} fill="#141416" fontSize={Math.max(10, imageWidth / 80)} textAnchor="middle">
                  {index + 1}
                </text>
              </g>
            ))}
            {line && (
              <line
                x1={points[0]!.x}
                y1={points[0]!.z}
                x2={points[1]!.x}
                y2={points[1]!.z}
                stroke="#4A7C59"
                strokeWidth={Math.max(2, imageWidth / 200)}
              />
            )}
          </svg>
        )}
      </div>
      <p className="cr-hint" role="status">
        {points.length === 0 && '先点第一个端点。'}
        {points.length === 1 && '再点第二个端点。'}
        {points.length >= 2 && '两点已选好，可修改米数后确认进场地。'}
      </p>
      <div className="rc-measures rc-ruler-measures">
        <label className="cr-label">
          这段长度（米）
          <input
            type="number"
            min="0.02"
            step="0.01"
            aria-label="标尺长度（米）"
            value={meters}
            disabled={points.length < 2 || busy}
            onChange={event => {
              setMeters(event.target.value);
              setAiSuggested(false);
            }}
          />
        </label>
        {aiSuggested && meters && <span className="rc-ruler-ai">AI 建议，可改</span>}
        <button type="button" className="cr-generate" disabled={busy || points.length < 2 || !meters.trim()} onClick={() => void confirm()}>
          确认标尺并进场地
        </button>
        <button type="button" className="rc-secondary" disabled={busy} onClick={() => { setPoints([]); setMeters(''); setNotice(''); }}>
          重选两点
        </button>
      </div>
      {notice && <p className="cr-notice" role="alert">{notice}</p>}
    </section>
  );
}
