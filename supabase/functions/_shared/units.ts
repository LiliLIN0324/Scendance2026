/**
 * Drawings in this market are dimensioned in millimetres far more often than in metres, while every
 * SceneV2 length is metres. Recognition therefore passes one explicit unit gate: either the text
 * states its unit, or the numbers are proved consistent with exactly one unit inside the metre bands
 * this contract accepts. Ambiguity is reported, never guessed — a silent 100× or 1000× error is far
 * worse than one extra confirmation step.
 */

export const METRES_PER_UNIT = { mm: 0.001, cm: 0.01, m: 1, ft: 0.3048, in: 0.0254 } as const;
export type LengthUnit = keyof typeof METRES_PER_UNIT;
export type PlanUnit = Extract<LengthUnit, 'mm' | 'cm' | 'm'>;
export const PLAN_UNITS: readonly PlanUnit[] = ['mm', 'cm', 'm'];

const aliases: Record<string, LengthUnit> = {
  mm: 'mm', 毫米: 'mm', 公厘: 'mm', 粍: 'mm',
  cm: 'cm', 厘米: 'cm', 公分: 'cm', 糎: 'cm',
  m: 'm', 米: 'm', 公尺: 'm', メートル: 'm',
  ft: 'ft', feet: 'ft', foot: 'ft', 英尺: 'ft', 呎: 'ft',
  in: 'in', inch: 'in', inches: 'in', 英寸: 'in', 吋: 'in',
};

/** The unit token alone, e.g. a model-declared `unitBasis` of `"mm"` or `"毫米"`. */
export function unitFromText(text: string): LengthUnit | null {
  return aliases[text.trim().toLowerCase()] ?? null;
}

export interface ParsedLength {
  readonly metres: number;
  /** `unitless` means the drawing wrote a bare number; the caller owns the plan unit. */
  readonly unit: LengthUnit | 'unitless';
  readonly raw: string;
}

/**
 * Parse a length exactly as written on a drawing: `7200 mm`, `720 厘米`, `7.2m`, `8'6"`, `1,200`.
 * A bare number is returned unconverted with `unit: 'unitless'` — never assumed to be metres.
 */
export function parseLength(text: string): ParsedLength | null {
  const raw = text.trim();
  if (!raw) return null;
  const normalised = raw
    .replace(/[\uff10-\uff19\uff0e]/g, character => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
    .replace(/[,，](?=\d{3}(?:\D|$))/g, '')
    .replace(/\s+/g, ' ');
  const feetInches = /^(\d+(?:\.\d+)?)\s*(?:'|′|英尺|呎)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|″|英寸|吋)?)?$/.exec(normalised);
  if (feetInches) return { metres: Number(feetInches[1]) * METRES_PER_UNIT.ft + Number(feetInches[2] ?? 0) * METRES_PER_UNIT.in, unit: 'ft', raw };
  const match = /^([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z\u4e00-\u9fff]{1,3})?$/.exec(normalised);
  if (!match) return null;
  const unit = match[2] ? aliases[match[2].toLowerCase()] : 'unitless';
  if (unit === undefined) return null;
  const value = Number(match[1]);
  return { metres: unit === 'unitless' ? value : value * METRES_PER_UNIT[unit], unit, raw };
}

export type SampleKind = 'plan' | 'wall' | 'thickness' | 'height' | 'opening';
/**
 * Realistic metre range per measurement kind. These are deliberately tighter than the SceneV2 outer
 * limits (size ≤ 200 m, thickness ≤ 2 m, height ≤ 30 m): the contract bounds are so wide that
 * millimetres and centimetres both fit them, which makes them useless for telling units apart.
 * A 2 m wall, 10 m opening or 30 m storey is not a real drawing, so those readings must fail.
 */
export const METRE_BANDS: Record<SampleKind, readonly [number, number]> = {
  plan: [1, 200], wall: [0.1, 200], thickness: [0.05, 1], height: [2, 15], opening: [0.4, 6],
};

export interface ScaleSample { readonly value: number; readonly kind: SampleKind }

export interface UnitDetection {
  readonly unit: PlanUnit | null;
  readonly factor: number;
  readonly confidence: 'unique' | 'ambiguous' | 'inconsistent';
  readonly candidates: readonly PlanUnit[];
  readonly samples: number;
}

function inBand(sample: ScaleSample, unit: PlanUnit): boolean {
  const metres = sample.value * METRES_PER_UNIT[unit];
  const [min, max] = METRE_BANDS[sample.kind];
  return metres >= min && metres <= max;
}

/**
 * Which plan unit makes every observed structural length land inside its metre band. `hint` (an
 * explicit unit the drawing or the model stated) only breaks ties; it never overrides the numbers.
 */
export function detectPlanUnit(samples: readonly ScaleSample[], hint: LengthUnit | null = null): UnitDetection {
  const usable = samples.filter(sample => Number.isFinite(sample.value) && sample.value > 0);
  const fitted = PLAN_UNITS.filter(unit => usable.length > 0 && usable.every(sample => inBand(sample, unit)));
  const basis: readonly PlanUnit[] = fitted.length > 1 && hint && fitted.includes(hint as PlanUnit) ? [hint as PlanUnit] : fitted;
  const confidence = usable.length === 0 || basis.length === 0 ? 'inconsistent' : basis.length === 1 ? 'unique' : 'ambiguous';
  return {
    unit: confidence === 'unique' ? basis[0] : null,
    factor: confidence === 'unique' ? METRES_PER_UNIT[basis[0]] : 1,
    confidence, candidates: basis, samples: usable.length,
  };
}

export interface UnitFitCell { readonly metres: number; readonly band: readonly [number, number]; readonly fits: boolean }
export interface UnitFitRow { readonly value: number; readonly kind: SampleKind; readonly byUnit: Record<PlanUnit, UnitFitCell> }

/**
 * Per-sample explanation of a unit decision, so a review panel (or a preview) can show *why* one
 * unit was chosen instead of a bare verdict. Same predicate as `detectPlanUnit` — never a second copy.
 */
export function explainUnitFit(samples: readonly ScaleSample[]): UnitFitRow[] {
  return samples.map(({ value, kind }) => ({
    value, kind,
    byUnit: Object.fromEntries(PLAN_UNITS.map(unit => {
      const metres = value * METRES_PER_UNIT[unit];
      return [unit, { metres: Math.round(metres * 1e6) / 1e6, band: METRE_BANDS[kind], fits: inBand({ value, kind }, unit) }];
    })) as Record<PlanUnit, UnitFitCell>,
  }));
}

/**
 * A genuine recognition correction stays small (a wall read slightly off). A 10× jump is a unit
 * disagreement, not drift — applying it silently would rescale the whole plan by 100× or 1000×.
 */
export const PLAUSIBLE_PLAN_SCALE = { min: 0.2, max: 5 } as const;
export function isPlausiblePlanScale(factor: number): boolean {
  return Number.isFinite(factor) && factor >= PLAUSIBLE_PLAN_SCALE.min && factor <= PLAUSIBLE_PLAN_SCALE.max;
}

export interface UnitNormalisationReport {
  readonly unit: PlanUnit | 'unscaled';
  readonly factor: number;
  readonly confidence: UnitDetection['confidence'];
  readonly applied: boolean;
  readonly samples: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const records = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : []);

/** Structural lengths only: free-form object sizes would make the vote unreliable. */
export function collectRecognizedSamples(scene: Record<string, unknown>): ScaleSample[] {
  const samples: ScaleSample[] = [];
  const push = (value: unknown, kind: SampleKind) => { if (isFiniteNumber(value) && value > 0) samples.push({ value, kind }); };
  const venue = isRecord(scene.venue) ? scene.venue : {};
  push(venue.width, 'plan'); push(venue.depth, 'plan');
  const structure = isRecord(scene.structure) ? scene.structure : {};
  for (const wall of records(structure.walls)) {
    const start = isRecord(wall.start) ? wall.start : null, end = isRecord(wall.end) ? wall.end : null;
    if (start && end && isFiniteNumber(start.x) && isFiniteNumber(start.z) && isFiniteNumber(end.x) && isFiniteNumber(end.z))
      push(Math.hypot(end.x - start.x, end.z - start.z), 'wall');
    push(wall.thickness, 'thickness'); push(wall.height, 'height');
  }
  for (const opening of records(structure.openings)) { push(opening.width, 'opening'); push(opening.height, 'height'); }
  for (const dimension of records(scene.dimensions)) push(dimension.valueMeters, dimension.kind === 'height' ? 'height' : 'plan');
  return samples;
}

/**
 * Scale every length-bearing field by `factor`. Normalised image evidence (`0..1` on walls) and image
 * calibration points (`dimensions[].start/end`) are deliberately untouched — they are not metres.
 */
export function scaleRecognizedScene(scene: Record<string, unknown>, factor: number): Record<string, unknown> {
  const scale = (value: unknown) => (isFiniteNumber(value) ? Math.round(value * factor * 1e6) / 1e6 : value);
  const point = (value: unknown): unknown => (isRecord(value) ? { ...value, x: scale(value.x), z: scale(value.z) } : value);
  const size = (value: unknown): unknown => (isRecord(value) ? { ...value, width: scale(value.width), depth: scale(value.depth), height: scale(value.height) } : value);
  const venue = isRecord(scene.venue) ? scene.venue : null;
  const structure = isRecord(scene.structure) ? scene.structure : null;
  return {
    ...scene,
    ...(venue ? {
      venue: {
        ...venue,
        width: scale(venue.width), depth: scale(venue.depth), height: scale(venue.height),
        ...(Array.isArray(venue.polygon) ? { polygon: venue.polygon.map(point) } : {}),
        ...(Array.isArray(venue.entrances) ? { entrances: venue.entrances.map(entrance => (isRecord(entrance) ? { ...entrance, position: point(entrance.position), width: scale(entrance.width) } : entrance)) } : {}),
      },
    } : {}),
    ...(structure ? {
      structure: {
        ...structure,
        ...(Array.isArray(structure.walls) ? { walls: structure.walls.map(wall => (isRecord(wall) ? { ...wall, start: point(wall.start), end: point(wall.end), thickness: scale(wall.thickness), height: scale(wall.height) } : wall)) } : {}),
        ...(Array.isArray(structure.openings) ? { openings: structure.openings.map(opening => (isRecord(opening) ? { ...opening, offset: scale(opening.offset), width: scale(opening.width), height: scale(opening.height), sillHeight: scale(opening.sillHeight) } : opening)) } : {}),
        ...(Array.isArray(structure.columns) ? { columns: structure.columns.map(column => (isRecord(column) ? { ...column, position: point(column.position), size: size(column.size) } : column)) } : {}),
      },
    } : {}),
    ...(Array.isArray(scene.objects) ? { objects: scene.objects.map(object => (isRecord(object) ? { ...object, position: point(object.position), size: size(object.size), elevation: scale(object.elevation) } : object)) } : {}),
    ...(Array.isArray(scene.dimensions) ? { dimensions: scene.dimensions.map(dimension => (isRecord(dimension) ? { ...dimension, valueMeters: scale(dimension.valueMeters) } : dimension)) } : {}),
  };
}

/**
 * Bring a raw recognition payload into metres before the contract validates it. Runs on unvalidated
 * model output, so every shape is treated as unknown and anything unexpected is passed through.
 */
export function normalizeRecognizedUnits(input: unknown, hint: LengthUnit | null = null): { value: unknown; report: UnitNormalisationReport } {
  const scene = isRecord(input) && isRecord(input.scene) ? input.scene : null;
  if (!isRecord(input) || !scene || scene.schemaVersion !== 2) return { value: input, report: { unit: 'unscaled', factor: 1, confidence: 'inconsistent', applied: false, samples: 0 } };
  const samples = collectRecognizedSamples(scene);
  const detection = detectPlanUnit(samples, hint);
  const report: UnitNormalisationReport = { unit: 'unscaled', factor: 1, confidence: detection.confidence, applied: false, samples: samples.length };
  if (detection.confidence !== 'unique' || !detection.unit || detection.factor === 1) return { value: input, report };
  return { value: { ...input, scene: scaleRecognizedScene(scene, detection.factor) }, report: { ...report, unit: detection.unit, factor: detection.factor, applied: true } };
}
