import type { BriefMemory, BriefTurn } from './brief-agent';
import { selectFurnishing, type FurnishingChoice, type FurnishingShape } from './furnishing-select';
import { readTableRequest, resolveTableArrangement } from './table-seat-plan';
import { formatArea, HEADCOUNT_MAX, parseBriefSentence, type BriefExtraction } from './workbench-agent';

/**
 * Event planner. A hold ("办个生日宴") or a complete banquet sentence is layout
 * intent. The planner asks only for a missing headcount, calls the selection
 * tool for the table, then hands size and asset to the layout preview.
 * 「想围着坐」 is a hint the selection tool may read. It is not the gate.
 */
export const AGENT_HALL = { lengthM: 20, widthM: 15 };

export interface LayoutToolCall {
  tool: 'select_furnishing' | 'layout_preview';
  summary: string;
}

function chineseNumber(raw: string): number | null {
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let result = 0;
  let digit = 0;
  for (const char of raw) {
    if (char in digits) digit = digits[char]!;
    else if (char === '十' || char === '百' || char === '千') {
      const unit = char === '十' ? 10 : char === '百' ? 100 : 1000;
      result += (digit || 1) * unit;
      digit = 0;
    } else return null;
  }
  const value = result + digit;
  return value >= 1 && value <= HEADCOUNT_MAX ? value : null;
}

/** One attendance figure written with digits or 八十. Object counts do not match. */
export function spokenHeadcount(raw: string): number | null {
  const text = raw.replace(/\s+/g, '');
  const found = new Set<number>();
  for (const match of text.matchAll(/(\d{1,5})(?:人|位|名)/g)) {
    const value = Number(match[1]);
    if (value >= 1 && value <= HEADCOUNT_MAX) found.add(value);
  }
  for (const match of text.matchAll(/([零〇一二两三四五六七八九十百千]+)(?:人|位|名)/g)) {
    const value = chineseNumber(match[1]!);
    if (value !== null) found.add(value);
  }
  if (found.size !== 1) return null;
  return [...found][0]!;
}

export function occasionFrom(raw: string): string | null {
  const text = raw.replace(/\s+/g, '');
  if (/生日/.test(text)) return '生日宴';
  if (/圆桌宴/.test(text)) return '圆桌宴';
  if (/婚/.test(text)) return '婚宴';
  if (/晚宴/.test(text)) return '晚宴';
  if (/酒会/.test(text)) return '酒会';
  if (/年会/.test(text)) return '年会';
  if (/宴会(?!厅)/.test(text)) return '宴会';
  if (/(?<![会])宴(?!会)/.test(text)) return '宴会';
  if (/派对|聚会/.test(text)) return '派对';
  return null;
}

function isQuestion(raw: string): boolean {
  return /(?:怎么|如何|怎样|是什么意思|[?？])/.test(raw.replace(/\s+/g, ''));
}

function isHold(raw: string): boolean {
  const compact = raw.replace(/\s+/g, '');
  if (/(?:不想办|不要办|别办|不办)/.test(compact)) return false;
  if (!/(?:举办|办)(?:一场|一个|个)?/.test(compact)) return false;
  return occasionFrom(compact) !== null;
}

function isBanquetFact(raw: string): boolean {
  const compact = raw.replace(/\s+/g, '');
  if (/(?:库存|现有|已有|我们有|手头有)/.test(compact)) return false;
  if (/(?:不想|不要|别|不围)围/.test(compact)) return false;
  if (/(?:不要|别用|不用|不摆)(?:圆桌|方桌|长桌)/.test(compact)) return false;
  const table = readTableRequest(raw);
  return !!table?.shape && spokenHeadcount(raw) !== null;
}

function bareCount(raw: string): number | null {
  const compact = raw.replace(/\s+/g, '');
  if (!/^\d{1,5}$/.test(compact)) return null;
  const value = Number(compact);
  return value >= 1 && value <= HEADCOUNT_MAX ? value : null;
}

function statedShapeOf(raw: string): FurnishingShape | undefined {
  const table = readTableRequest(raw);
  if (!table?.shape) {
    if (/长桌|长条/.test(raw)) return 'long';
    if (/方桌/.test(raw)) return 'rect';
    return undefined;
  }
  if (table.shape === 'round') return 'round';
  return /长桌|长条/.test(raw) ? 'long' : 'rect';
}

function ask(memory: BriefMemory, extraction: BriefExtraction, occasion: string): BriefTurn {
  const next: BriefMemory = { ...memory, event: occasion, eventIntent: { occasion, awaiting: 'headcount' }, askedScale: false };
  delete next.furnishing;
  delete next.agentVenue;
  return {
    kind: 'ask',
    memory: next,
    extraction: { ...extraction, event: occasion },
    filledScaleAsk: false,
    text: `这场${occasion}大概多少人？`,
  };
}

/**
 * Parameters the layout tool needs. Null when this memory is not an event preview.
 * The layout call does not look at the occasion.
 */
export function eventPreviewInput(memory: BriefMemory): {
  widthM: number;
  depthM: number;
  guests: number;
  layoutMode: 'dining';
  seatingShape?: 'ring';
  table: { shape: 'round' | 'rect'; width: number; depth: number };
  furnishing: FurnishingChoice;
  stage: false;
  checkin: false;
} | null {
  const furnishing = memory.furnishing;
  if (!furnishing || memory.headcount === null) return null;
  const widthM = memory.lengthM ?? memory.agentVenue?.lengthM;
  const depthM = memory.widthM ?? memory.agentVenue?.widthM;
  if (widthM === undefined || depthM === undefined) return null;
  const shape = furnishing.shape === 'round' ? 'round' as const : 'rect' as const;
  return {
    widthM,
    depthM,
    guests: memory.headcount,
    layoutMode: 'dining',
    ...(furnishing.shape === 'round' ? { seatingShape: 'ring' as const } : {}),
    table: { shape, width: furnishing.width, depth: furnishing.depth },
    furnishing,
    stage: false,
    checkin: false,
  };
}

export function planHeldEvent(raw: string, memory: BriefMemory, extraction: BriefExtraction): BriefTurn | null {
  if (isQuestion(raw)) return null;
  const hold = isHold(raw);
  const fact = isBanquetFact(raw);
  const awaiting = memory.eventIntent?.awaiting === 'headcount';
  const said = parseBriefSentence(raw);
  const statedCount = said.headcount ?? spokenHeadcount(raw) ?? bareCount(raw);
  if (!hold && !fact && !(awaiting && statedCount !== null)) {
    if (awaiting && statedCount === null && /出方案|出一版|摆一版|先出/.test(raw.replace(/\s+/g, ''))) {
      const occasion = memory.eventIntent?.occasion;
      if (occasion) return ask(memory, extraction, occasion);
    }
    return null;
  }
  if (/课桌|课椅/.test(raw) && !/圆桌/.test(raw)) return null;

  const occasion = occasionFrom(raw) ?? memory.eventIntent?.occasion ?? null;
  const headcount = statedCount ?? memory.headcount;
  if (headcount === null) {
    if (!occasion) return null;
    return ask(memory, extraction, occasion);
  }

  const lengthM = said.lengthM ?? memory.lengthM;
  const widthM = said.widthM ?? memory.widthM;
  const hasVenue = lengthM !== null && widthM !== null;
  if (!hasVenue && (said.areaM2 ?? memory.areaM2) !== null) return null;
  const venueFilled = !hasVenue;
  const hallL = lengthM ?? AGENT_HALL.lengthM;
  const hallW = widthM ?? AGENT_HALL.widthM;

  const table = readTableRequest(raw);
  const statedShape = statedShapeOf(raw);
  const selection = selectFurnishing({
    occasion,
    notes: raw,
    ...(statedShape ? { statedShape } : {}),
    ...(table?.width !== undefined ? { statedWidth: table.width } : {}),
    ...(table?.depth !== undefined ? { statedDepth: table.depth } : {}),
  });
  const arrangement = resolveTableArrangement({
    shape: selection.shape === 'round' ? 'round' : 'rect',
    guests: headcount,
    width: selection.width,
    depth: selection.depth,
  });
  const next: BriefMemory = {
    ...memory,
    event: occasion ?? memory.event,
    headcount,
    headcountMode: headcount === memory.headcount ? memory.headcountMode : null,
    venueIO: said.venueIO ?? memory.venueIO ?? (venueFilled ? 'indoor' : memory.venueIO),
    lengthM: venueFilled ? null : hallL,
    widthM: venueFilled ? null : hallW,
    layoutMode: 'dining',
    layoutModeConfirmed: true,
    layoutModeUnresolved: false,
    seatingShape: selection.shape === 'round' ? 'ring' : 'grid',
    banquetTable: {
      shape: selection.shape === 'round' ? 'round' : 'rect',
      width: selection.width,
      depth: selection.depth,
      evidence: raw.trim().slice(0, 200) || selection.reason,
    },
    furnishing: selection,
    askedScale: false,
  };
  if (venueFilled) next.agentVenue = { lengthM: hallL, widthM: hallW };
  else delete next.agentVenue;
  if (occasion) next.eventIntent = { occasion };
  else delete next.eventIntent;

  const who = occasion ? `${occasion}，${headcount} 人` : `${headcount} 人`;
  const indoors = (said.venueIO ?? memory.venueIO ?? 'indoor') !== 'outdoor';
  const place = venueFilled
    ? `场地没说，我先按${indoors ? '室内' : '户外'} ${formatArea(hallL)}×${formatArea(hallW)} 米`
    : `按你说的 ${formatArea(hallL)}×${formatArea(hallW)} 米`;
  const tableWords = selection.shape === 'round'
    ? `Ø${selection.width.toFixed(2)} 米圆桌（木边、亚麻面）`
    : `${selection.shape === 'long' ? '长桌' : '方桌'} ${selection.width.toFixed(2)}×${selection.depth.toFixed(2)} 米`;
  const previewLead = `${who}。${place}，${tableWords}，每桌 ${arrangement.seatsPerTable} 人，约 ${arrangement.tables} 桌。先出预览，确认后才写入。`;
  const layoutTools: LayoutToolCall[] = [
    { tool: 'select_furnishing', summary: selection.reason },
    { tool: 'layout_preview', summary: arrangement.explanation },
  ];
  return {
    kind: 'generate',
    memory: next,
    extraction: {
      ...extraction,
      ...(occasion ? { event: occasion } : {}),
      headcount,
      ...(hasVenue ? { lengthM: hallL, widthM: hallW } : {}),
    },
    filledScaleAsk: false,
    text: '',
    previewLead,
    layoutTools,
  };
}
