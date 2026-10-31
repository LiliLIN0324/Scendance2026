import { parseDimensionText } from './source-storage';

export type ProposeScaleInput = {
  /** Normalized image span 0..1 between the two ruler points. */
  normalizedSpan: number;
  imageWidth: number;
  imageHeight: number;
  /** Optional natural-language hints already typed by the user. */
  dimensionText?: string;
  /** Hook for future vision / OCR backends; unused in the default heuristic. */
  externalProposer?: (input: ProposeScaleInput) => ProposeScaleResult | null | undefined;
};

export type ProposeScaleResult = {
  meters: number;
  /** Shown in UI as “AI 建议，可改”. */
  aiSuggested: boolean;
  hint: string;
  confidence: 'low' | 'medium' | 'high';
};

const clampMeters = (value: number) => Math.min(400, Math.max(0.02, value));

/** Default placeholder when nothing else is known — clearly labeled as editable AI suggestion. */
function defaultSpanMeters(normalizedSpan: number): ProposeScaleResult {
  const meters = clampMeters(normalizedSpan * 12);
  return {
    meters: +meters.toFixed(2),
    aiSuggested: true,
    hint: 'AI 建议，可改',
    confidence: 'low',
  };
}

/**
 * T-3D-03 `propose_scale` hook for the upload path. Uses typed dimensions when
 * available; otherwise returns a conservative editable default (never silent truth).
 */
export function proposeScaleMeters(input: ProposeScaleInput): ProposeScaleResult {
  const external = input.externalProposer?.(input);
  if (external && Number.isFinite(external.meters) && external.meters > 0) return external;

  const text = input.dimensionText?.trim() ?? '';
  if (text) {
    const parsed = parseDimensionText(text);
    const width = parsed.find(item => item.kind === 'width');
    const depth = parsed.find(item => item.kind === 'depth');
    const distance = parsed.find(item => item.kind === 'distance');
    const anchor = distance ?? width ?? depth;
    if (anchor && normalizedSpanIsPlausible(input.normalizedSpan)) {
      return {
        meters: clampMeters(anchor.valueMeters),
        aiSuggested: true,
        hint: 'AI 建议，可改',
        confidence: 'medium',
      };
    }
    if (width && depth && input.normalizedSpan > 0.05) {
      const aspect = input.imageWidth / input.imageHeight;
      const spanMeters = input.normalizedSpan >= 0.45
        ? width.valueMeters
        : depth.valueMeters * (input.normalizedSpan / Math.max(0.05, 1 / aspect));
      return {
        meters: clampMeters(spanMeters),
        aiSuggested: true,
        hint: 'AI 建议，可改',
        confidence: 'medium',
      };
    }
  }

  return defaultSpanMeters(input.normalizedSpan);
}

function normalizedSpanIsPlausible(span: number): boolean {
  return Number.isFinite(span) && span >= 0.02 && span <= 1.05;
}

/** Pixel endpoints → normalized 0..1 coords stored on DimensionConstraint.start/end. */
export function normalizeRulerPoints(
  start: { x: number; z: number },
  end: { x: number; z: number },
  imageWidth: number,
  imageHeight: number,
): { start: { x: number; z: number }; end: { x: number; z: number }; normalizedSpan: number } {
  const startNorm = { x: start.x / imageWidth, z: start.z / imageHeight };
  const endNorm = { x: end.x / imageWidth, z: end.z / imageHeight };
  const pxStart = { x: start.x, z: start.z };
  const pxEnd = { x: end.x, z: end.z };
  const pixelSpan = Math.hypot(pxEnd.x - pxStart.x, pxEnd.z - pxStart.z);
  const normalizedSpan = pixelSpan / Math.hypot(imageWidth, imageHeight);
  return { start: startNorm, end: endNorm, normalizedSpan };
}
