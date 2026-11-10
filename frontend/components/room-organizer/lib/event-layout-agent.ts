import type { BriefMemory, BriefTurn } from './brief-agent';
import { selectFurnishing, type FurnishingChoice, type FurnishingShape } from './furnishing-select';
import { readTableRequest, resolveTableArrangement } from './table-seat-plan';
import { formatArea, HEADCOUNT_MAX, parseBriefSentence, suggestDimsFromArea, type BriefExtraction } from './workbench-agent';
import type { ScaleOrigin } from './venue-shell';

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

function countIn(clause: string): number | null {
  const digit = clause.match(/(\d{1,5})(?:个)?(?:人|位|名)/);
  if (digit) {
    const value = Number(digit[1]);
    return value >= 1 && value <= HEADCOUNT_MAX ? value : null;
  }
  const spoken = clause.match(/([零〇一二两三四五六七八九十百千]+)(?:个)?(?:人|位|名)/);
  return spoken ? chineseNumber(spoken[1]!) : null;
}

/** Attendance in this sentence. 每桌人数 is not the hall total. 个人 counts. */
export function spokenHeadcount(raw: string): number | null {
  const found = new Set<number>();
  for (const clause of raw.split(/[，,；;。！？!?\n]/)) {
    const compact = clause.replace(/\s+/g, '');
    if (!compact || /每桌|一桌/.test(compact)) continue;
    const value = countIn(compact);
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
  if (/发布会|新品发布/.test(text)) return '发布会';
  if (/展览|展会/.test(text)) return '展览';
  if (/讲座/.test(text)) return '讲座';
  if (/沙龙|分享会/.test(text)) return '沙龙';
  return null;
}

function isQuestion(raw: string): boolean {
  return /(?:怎么|如何|怎样|是什么意思|[?？吗])/.test(raw.replace(/\s+/g, ''));
}

/** 办个 / 举办 / 想办. A 办 inside 办公室, 办法, or 主办 is not a request. */
function isHold(raw: string): boolean {
  const compact = raw.replace(/\s+/g, '');
  if (/(?:不想办|不要办|别办|不办)/.test(compact)) return false;
  const verb = /举办|办(?:一场|一个|个)|(?:想|要|准备|打算|帮我)办(?![公法])/.test(compact);
  if (!verb) return false;
  return occasionFrom(compact) !== null;
}

function isBanquetFact(raw: string): boolean {
  const compact = raw.replace(/\s+/g, '');
  if (/(?:库存|现有|已有|我们有|手头有)/.test(compact)) return false;
  if (/(?:不想|不要|别|不围)围/.test(compact)) return false;
  if (/(?:不要|别用|不用|不摆)(?:圆桌|方桌|长桌)/.test(compact)) return false;
  const table = readTableRequest(raw);
  // A bare 「圆桌」 plus a headcount is the existing seating choice. Only a stated
  // size or a per-table count is enough to start this planner by itself.
  return !!table?.shape && spokenHeadcount(raw) !== null && (table.width !== undefined || table.peoplePerTable !== undefined);
}

function bareCount(raw: string): number | null {
  const compact = raw.replace(/\s+/g, '');
  if (!/^\d{1,5}$/.test(compact)) return null;
  const value = Number(compact);
  return value >= 1 && value <= HEADCOUNT_MAX ? value : null;
}

function perTableCount(raw: string): number | undefined {
  const listed = readTableRequest(raw)?.peoplePerTable;
  if (listed !== undefined) return listed;
  const match = raw.replace(/\s+/g, '').match(/每桌(?:坐|供|配|安排|容纳)?(\d{1,2})(?:个)?人/);
  if (!match) return undefined;
  const count = Number(match[1]);
  return count >= 1 && count <= 16 ? count : undefined;
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

export function eventPreviewScale(
  stated: { length: number; width: number; origin: ScaleOrigin; fromVenue: boolean },
  memory: Pick<BriefMemory, 'agentVenue' | 'lengthM' | 'widthM' | 'areaM2'>,
): { length: number; width: number; origin: ScaleOrigin; assumed: boolean } {
  const hall = memory.agentVenue;
  const noUserSize = memory.lengthM === null && memory.widthM === null && memory.areaM2 === null;
  if (hall && noUserSize && !stated.fromVenue) {
    return { length: hall.lengthM, width: hall.widthM, origin: 'canvas', assumed: true };
  }
  return { length: stated.length, width: stated.width, origin: stated.origin, assumed: false };
}

export function planHeldEvent(raw: string, memory: BriefMemory, extraction: BriefExtraction): BriefTurn | null {
  const hold = isHold(raw);
  const fact = isBanquetFact(raw);
  if (isQuestion(raw)) {
    if (!hold && !fact) return null;
    const occasion = occasionFrom(raw) ?? memory.eventIntent?.occasion;
    const next: BriefMemory = { ...memory, askedScale: false };
    if (occasion) next.event = occasion;
    delete next.furnishing;
    return {
      kind: 'ask',
      memory: next,
      extraction: occasion ? { ...extraction, event: occasion } : extraction,
      filledScaleAsk: false,
      text: occasion ? `要按这场${occasion}出预览吗？要的话直接说人数，或说「出一版」。` : '要我按这个出一版预览吗？',
    };
  }
  const awaiting = memory.eventIntent?.awaiting === 'headcount';
  const said = parseBriefSentence(raw);
  const statedCount = said.headcount ?? spokenHeadcount(raw) ?? bareCount(raw);
  const table = readTableRequest(raw);
  const perTable = perTableCount(raw);
  const resizing = !!memory.furnishing && ((table?.width !== undefined) || perTable !== undefined || (!!table?.shape && table.shape !== (memory.furnishing.shape === 'round' ? 'round' : 'rect')));
  if (!hold && !fact && !(awaiting && statedCount !== null) && !resizing) {
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
  const area = said.areaM2 ?? memory.areaM2;
  const fromArea = !hasVenue && area !== null;
  const derived = fromArea ? suggestDimsFromArea(area) : null;
  const venueFilled = !hasVenue && !fromArea;
  const hallL = hasVenue ? lengthM : derived ? derived.length : AGENT_HALL.lengthM;
  const hallW = hasVenue ? widthM : derived ? derived.width : AGENT_HALL.widthM;

  const statedShape = statedShapeOf(raw) ?? memory.furnishing?.shape;
  const explicitWidth = table?.width;
  const growToParty = perTable !== undefined && explicitWidth === undefined;
  const selection = selectFurnishing({
    occasion,
    notes: raw,
    ...(statedShape ? { statedShape } : {}),
    ...(explicitWidth !== undefined ? { statedWidth: explicitWidth } : {}),
    ...(table?.depth !== undefined ? { statedDepth: table.depth } : {}),
  });
  const arrangement = resolveTableArrangement({
    shape: selection.shape === 'round' ? 'round' : 'rect',
    guests: headcount,
    ...(growToParty && perTable !== undefined ? { peoplePerTable: perTable } : { width: selection.width, depth: selection.depth }),
  });
  const finish = selection.material.top === 'linen' ? '木边、亚麻面' : '木面';
  const fitted: FurnishingChoice = arrangement.width === selection.width && arrangement.depth === selection.depth
    ? selection
    : {
      ...selection,
      width: arrangement.width,
      depth: arrangement.depth,
      reason: `${occasion ? `${occasion}，` : ''}选用${selection.shape === 'round' ? `圆桌，直径 ${arrangement.width.toFixed(2)} 米，${finish}` : `${selection.shape === 'long' ? '长桌' : '方桌'} ${arrangement.width.toFixed(2)}×${arrangement.depth.toFixed(2)} 米，${finish}`}。`.slice(0, 200),
    };
  const next: BriefMemory = {
    ...memory,
    event: occasion ?? memory.event,
    headcount,
    headcountMode: headcount === memory.headcount ? memory.headcountMode : null,
    venueIO: said.venueIO ?? memory.venueIO ?? (venueFilled ? 'indoor' : memory.venueIO),
    lengthM: venueFilled || fromArea ? null : hallL,
    widthM: venueFilled || fromArea ? null : hallW,
    ...(fromArea ? { areaM2: area } : {}),
    layoutMode: 'dining',
    layoutModeConfirmed: true,
    layoutModeUnresolved: false,
    seatingShape: fitted.shape === 'round' ? 'ring' : 'grid',
    banquetTable: {
      shape: fitted.shape === 'round' ? 'round' : 'rect',
      width: fitted.width,
      depth: fitted.depth,
      ...(perTable !== undefined ? { peoplePerTable: perTable } : {}),
      evidence: raw.trim().slice(0, 200) || fitted.reason,
    },
    furnishing: fitted,
    askedScale: false,
  };
  if (venueFilled) next.agentVenue = { lengthM: hallL, widthM: hallW };
  else delete next.agentVenue;
  if (occasion) next.eventIntent = { occasion };
  else delete next.eventIntent;

  const who = occasion ? `${occasion}，${headcount} 人` : `${headcount} 人`;
  const indoors = (said.venueIO ?? memory.venueIO ?? 'indoor') !== 'outdoor';
  const place = fromArea
    ? `按 ${formatArea(area)} ㎡ 折成 ${formatArea(hallL)}×${formatArea(hallW)} 米`
    : venueFilled
      ? `场地没说，我先按${indoors ? '室内' : '户外'} ${formatArea(hallL)}×${formatArea(hallW)} 米`
      : `按你说的 ${formatArea(hallL)}×${formatArea(hallW)} 米`;
  const tableWords = fitted.shape === 'round'
    ? `Ø${fitted.width.toFixed(2)} 米圆桌（${finish}）`
    : `${fitted.shape === 'long' ? '长桌' : '方桌'} ${fitted.width.toFixed(2)}×${fitted.depth.toFixed(2)} 米（${finish}）`;
  const previewLead = `${who}。${place}，${tableWords}，每桌 ${arrangement.seatsPerTable} 人，约 ${arrangement.tables} 桌。先出预览，确认后才写入。`;
  const layoutTools: LayoutToolCall[] = [
    { tool: 'select_furnishing', summary: fitted.reason },
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
      ...(fromArea ? { areaM2: area } : {}),
    },
    filledScaleAsk: false,
    text: '',
    previewLead,
    layoutTools,
  };
}
