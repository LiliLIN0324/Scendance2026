/**
 * 按风格配一套：内置色调 + 可存的风格提示词。
 * 入口在 Bingo；位置与尺寸仍由 lib/furniture-sets 放样，风格负责色板与一句话。
 */
import { buildFurnitureSet, FURNITURE_SETS } from './furniture-sets';
import type { FurnitureItem } from './types';

/** 只用到 localStorage 的这两个方法，测试可传替身。 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StyleBundle {
  key: string;
  name: string;
  /** 一句说明：一套里有什么，或风格气质。 */
  note: string;
  /** 风格提示词：可点可存，对话里也能说「按 xxx 配一套」。 */
  prompt: string;
  /** 映射到 FURNITURE_SETS 的内置套。 */
  setKey: string;
  /** 缩略图用的小色板。 */
  swatches: readonly string[];
  /** 按件型换色；套里没有的件型保持目录本色。 */
  colors: Readonly<Record<string, string>>;
  /** 用户自存的提示词风格。 */
  custom?: boolean;
}

export type StyleBundleBuild =
  | { ok: true; items: FurnitureItem[] }
  | { ok: false; message: string };

/** 按场地尺度算出一整套可落盘物料；放不下或套不存在时带回原因。 */
export function buildStyleBundleItems(
  bundle: StyleBundle,
  room?: { width: number; depth: number } | null,
): StyleBundleBuild {
  const set = FURNITURE_SETS.find(entry => entry.key === bundle.setKey);
  if (!set) return { ok: false, message: '这一套暂时不可用。' };
  const built = buildFurnitureSet(set, room ? { roomWidth: room.width, roomDepth: room.depth } : {});
  if (built.length === 0) return { ok: false, message: '这个场地放不下这一套，先换大一点的场地。' };
  return {
    ok: true,
    items: built.map(item => (bundle.colors[item.type] ? { ...item, color: bundle.colors[item.type]! } : item)),
  };
}

type Palette = { swatches: readonly string[]; colors: Readonly<Record<string, string>> };

function loungeColors(a: string, b: string, c: string, d: string): Palette {
  return { swatches: [a, b, c, d], colors: { sofa: a, 'coffee-table': b, tv: c, plant: d } };
}
function diningColors(a: string, b: string, c = '#E7DDD0', d = '#F4F1EA'): Palette {
  return { swatches: [a, b, c, d], colors: { 'dining-table': a, 'dining-chair': b } };
}
function officeColors(a: string, b: string, c: string, d: string): Palette {
  return { swatches: [a, b, c, d], colors: { desk: a, chair: b, computer: c, lamp: d } };
}
function bedroomColors(a: string, b: string, c: string, d: string): Palette {
  return { swatches: [a, b, c, d], colors: { bed: a, nightstand: b, lamp: c } };
}

function pack(
  key: string,
  name: string,
  prompt: string,
  note: string,
  setKey: string,
  palette: Palette,
): StyleBundle {
  return { key, name, prompt, note, setKey, swatches: palette.swatches, colors: palette.colors };
}

/** 内置风格：活动常见气质，不只三套会客/就餐/办公。 */
export const STYLE_BUNDLES: readonly StyleBundle[] = [
  pack('cream-lounge', '奶油会客', '奶油色会客区，柔和木质与绿植', '沙发、茶几、电视与绿植', 'lounge',
    loungeColors('#E8DCC8', '#D9C7AE', '#8A7F70', '#B7C6A6')),
  pack('ink-gold-lounge', '墨金发布', '深色墨金发布会客厅，低调金属感', '沙发会客，偏发布/品牌', 'lounge',
    loungeColors('#2C2A28', '#C4A574', '#1A1918', '#6B7364')),
  pack('mist-blue-lounge', '雾蓝沙龙', '雾霾蓝沙龙会客，安静冷调', '沙发会客，偏分享会', 'lounge',
    loungeColors('#A8B8C8', '#D7E0E8', '#5A6A78', '#9BB0A0')),
  pack('walnut-dining', '深木就餐', '深胡桃木餐桌椅，晚宴感', '餐桌加四把椅', 'dining',
    diningColors('#6B4A32', '#7A5638')),
  pack('white-linen-dining', '白亚麻晚宴', '白桌布亚麻质感，轻盈晚宴', '餐桌加四把椅', 'dining',
    diningColors('#F2EDE4', '#D8D0C4', '#EFEAE2', '#FFFFFF')),
  pack('black-tie-dining', '黑白晚宴', '黑白极简晚宴，高对比', '餐桌加四把椅', 'dining',
    diningColors('#1F1F1F', '#F5F5F5', '#E8E8E8', '#2A2A2A')),
  pack('clear-office', '清透办公', '浅灰办公桌椅，干净利落', '书桌、椅、电脑与台灯', 'home-office',
    officeColors('#DCE3E8', '#C3D0DA', '#46586A', '#EDF2F5')),
  pack('walnut-office', '胡桃办公', '胡桃木办公角，稳重专业', '书桌、椅、电脑与台灯', 'home-office',
    officeColors('#7A5638', '#A98B6C', '#2F3338', '#E8DFD2')),
  pack('soft-bedroom', '柔雾卧室', '柔雾粉灰卧室，休息角', '床、床头柜与灯', 'bedroom',
    bedroomColors('#E8DDE4', '#D4C8C0', '#F4EEE8', '#C8B8B0')),
  pack('cedar-outdoor', '松木户外', '浅松木户外会客，偏市集茶歇', '沙发茶几会客气质', 'lounge',
    loungeColors('#D2B48C', '#C4A484', '#6B5B4A', '#8FAE7E')),
];

export const STYLE_SET_OPTIONS = [
  { key: 'lounge', label: '会客' },
  { key: 'dining', label: '就餐' },
  { key: 'home-office', label: '办公' },
  { key: 'bedroom', label: '卧室' },
] as const;

/** 我的生成里的一条记录：风格套用一次记一条，同一套只留最新一条。 */
export interface StyleRun {
  style: string;
  at: number;
}

export const STYLE_RUNS_KEY = 'scendance:style-runs';
export const STYLE_CUSTOM_KEY = 'scendance:style-custom';
const MAX_STYLE_RUNS = 12;
const MAX_CUSTOM_STYLES = 16;

function readStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function hashHue(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash % 360;
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`;
}

/**
 * 把一句风格提示词折成色板：先认关键词，认不出再用提示词哈希推一版，保证总能落色。
 */
export function paletteFromPrompt(prompt: string, setKey: string): Palette {
  const text = prompt.trim().toLowerCase();
  if (/(奶油|米色|暖白|亚麻|奶茶)/.test(text)) {
    if (setKey === 'dining') return diningColors('#E8DCC8', '#D9C7AE');
    if (setKey === 'home-office') return officeColors('#EFE6D6', '#DCCBAE', '#8A7F70', '#F7F2EA');
    if (setKey === 'bedroom') return bedroomColors('#EFE6D6', '#DCCBAE', '#F7F2EA', '#C8B8A0');
    return loungeColors('#E8DCC8', '#D9C7AE', '#8A7F70', '#B7C6A6');
  }
  if (/(黑白|极简|monochrome|高对比)/.test(text)) {
    if (setKey === 'dining') return diningColors('#1F1F1F', '#F5F5F5');
    if (setKey === 'home-office') return officeColors('#2A2A2A', '#EDEDED', '#111111', '#F7F7F7');
    if (setKey === 'bedroom') return bedroomColors('#2A2A2A', '#E8E8E8', '#F5F5F5', '#1A1A1A');
    return loungeColors('#2A2A2A', '#E8E8E8', '#111111', '#6B7364');
  }
  if (/(木|胡桃|橡木|松木|原木)/.test(text)) {
    if (setKey === 'dining') return diningColors('#6B4A32', '#7A5638');
    if (setKey === 'home-office') return officeColors('#7A5638', '#A98B6C', '#2F3338', '#E8DFD2');
    if (setKey === 'bedroom') return bedroomColors('#8B6914', '#A67C52', '#F0E6D8', '#6B5344');
    return loungeColors('#C4A484', '#A67C52', '#5C4033', '#8FAE7E');
  }
  if (/(蓝|雾蓝|海军|青)/.test(text)) {
    if (setKey === 'dining') return diningColors('#4A6678', '#D7E0E8');
    if (setKey === 'home-office') return officeColors('#D7E0E8', '#A8B8C8', '#3A4A58', '#EDF2F5');
    if (setKey === 'bedroom') return bedroomColors('#A8B8C8', '#D7E0E8', '#EEF3F7', '#5A6A78');
    return loungeColors('#A8B8C8', '#D7E0E8', '#5A6A78', '#9BB0A0');
  }
  if (/(金|香槟|墨金|铜色)/.test(text)) {
    if (setKey === 'dining') return diningColors('#2C2A28', '#C4A574');
    if (setKey === 'home-office') return officeColors('#3A342C', '#C4A574', '#1A1918', '#EFE6D6');
    if (setKey === 'bedroom') return bedroomColors('#3A342C', '#C4A574', '#EFE6D6', '#2C2A28');
    return loungeColors('#2C2A28', '#C4A574', '#1A1918', '#6B7364');
  }
  if (/(绿|森|苔|橄榄)/.test(text)) {
    if (setKey === 'dining') return diningColors('#4F6F52', '#D7E0D2');
    if (setKey === 'home-office') return officeColors('#D7E0D2', '#A8BFA8', '#3A4A3A', '#F0F5EE');
    if (setKey === 'bedroom') return bedroomColors('#A8BFA8', '#D7E0D2', '#F0F5EE', '#4F6F52');
    return loungeColors('#A8BFA8', '#D7E0D2', '#4F6F52', '#8FAE7E');
  }
  if (/(橙|暖橙|赤陶|砖红)/.test(text)) {
    if (setKey === 'dining') return diningColors('#C47A4A', '#F0E0D0');
    if (setKey === 'home-office') return officeColors('#E8D0C0', '#C47A4A', '#4A3428', '#F7EEE6');
    if (setKey === 'bedroom') return bedroomColors('#E8D0C0', '#C47A4A', '#F7EEE6', '#8A5A3A');
    return loungeColors('#E0A878', '#C47A4A', '#5A3A28', '#A8B88A');
  }

  const hue = hashHue(text || 'style');
  const a = hsl(hue, 28, 72);
  const b = hsl((hue + 18) % 360, 22, 58);
  const c = hsl((hue + 200) % 360, 18, 32);
  const d = hsl((hue + 90) % 360, 24, 68);
  if (setKey === 'dining') return diningColors(b, a, d, hsl(hue, 10, 92));
  if (setKey === 'home-office') return officeColors(a, b, c, d);
  if (setKey === 'bedroom') return bedroomColors(a, b, d, c);
  return loungeColors(a, b, c, d);
}

function slugKey(name: string): string {
  const base = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fff-]+/g, '').slice(0, 24);
  return `custom-${base || 'style'}-${Date.now().toString(36)}`;
}

export function loadCustomStyles(storage?: StorageLike): StyleBundle[] {
  const store = readStorage(storage);
  if (!store) return [];
  try {
    const raw = store.getItem(STYLE_CUSTOM_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap(entry => {
      if (!entry || typeof entry !== 'object') return [];
      const row = entry as Partial<StyleBundle>;
      if (typeof row.key !== 'string' || typeof row.name !== 'string' || typeof row.setKey !== 'string') return [];
      if (!FURNITURE_SETS.some(set => set.key === row.setKey)) return [];
      const prompt = typeof row.prompt === 'string' ? row.prompt : row.name;
      const note = typeof row.note === 'string' ? row.note : prompt;
      const palette = Array.isArray(row.swatches) && row.swatches.length >= 4 && row.colors && typeof row.colors === 'object'
        ? { swatches: row.swatches.slice(0, 4).map(String), colors: row.colors as Record<string, string> }
        : paletteFromPrompt(prompt, row.setKey);
      return [{
        key: row.key,
        name: row.name.trim().slice(0, 20) || '自定义风格',
        prompt: prompt.trim().slice(0, 80),
        note: note.trim().slice(0, 60),
        setKey: row.setKey,
        swatches: palette.swatches,
        colors: palette.colors,
        custom: true,
      }];
    }).slice(0, MAX_CUSTOM_STYLES);
  } catch {
    return [];
  }
}

function writeCustomStyles(list: readonly StyleBundle[], storage?: StorageLike): StyleBundle[] {
  const next = list.filter(item => item.custom).slice(0, MAX_CUSTOM_STYLES);
  const store = readStorage(storage);
  if (!store) return [...next];
  try {
    store.setItem(STYLE_CUSTOM_KEY, JSON.stringify(next.map(({ key, name, prompt, note, setKey, swatches, colors }) => ({
      key, name, prompt, note, setKey, swatches, colors, custom: true,
    }))));
  } catch {
    // 存不下只丢自定义列表，不影响当场放置。
  }
  return [...next];
}

/** 内置 + 自存，自存在前方便找自己的。 */
export function listStyleBundles(storage?: StorageLike): StyleBundle[] {
  return [...loadCustomStyles(storage), ...STYLE_BUNDLES];
}

export function findStyleBundle(key: string, storage?: StorageLike): StyleBundle | null {
  return listStyleBundles(storage).find(bundle => bundle.key === key) ?? null;
}

/** 用提示词新建并保存一套风格；同名会覆盖最近一条自定义。 */
export function saveCustomStyle(input: {
  name: string;
  prompt: string;
  setKey: string;
}, storage?: StorageLike): { ok: true; bundle: StyleBundle } | { ok: false; message: string } {
  const name = input.name.trim().slice(0, 20);
  const prompt = input.prompt.trim().slice(0, 80);
  if (!name) return { ok: false, message: '先给风格起个短名。' };
  if (!prompt) return { ok: false, message: '写一句风格提示词，比如「雾蓝极简发布会」。' };
  if (!STYLE_SET_OPTIONS.some(option => option.key === input.setKey)) {
    return { ok: false, message: '先选会客、就餐、办公或卧室。' };
  }
  const palette = paletteFromPrompt(prompt, input.setKey);
  const existing = loadCustomStyles(storage);
  const prior = existing.find(item => item.name === name);
  const bundle: StyleBundle = {
    key: prior?.key ?? slugKey(name),
    name,
    prompt,
    note: prompt,
    setKey: input.setKey,
    swatches: palette.swatches,
    colors: palette.colors,
    custom: true,
  };
  writeCustomStyles([bundle, ...existing.filter(item => item.key !== bundle.key)], storage);
  return { ok: true, bundle };
}

export function deleteCustomStyle(key: string, storage?: StorageLike): StyleBundle[] {
  return writeCustomStyles(loadCustomStyles(storage).filter(item => item.key !== key), storage);
}

export function loadStyleRuns(storage?: StorageLike): StyleRun[] {
  const store = readStorage(storage);
  if (!store) return [];
  try {
    const raw = store.getItem(STYLE_RUNS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    const runs = Array.isArray(parsed) ? parsed : [];
    const known = new Set(listStyleBundles(storage).map(bundle => bundle.key));
    const seen = new Set<string>();
    return runs.flatMap(entry => {
      if (!entry || typeof entry !== 'object') return [];
      const { style, at } = entry as { style?: unknown; at?: unknown };
      if (typeof style !== 'string' || !known.has(style) || seen.has(style)) return [];
      seen.add(style);
      return [{ style, at: typeof at === 'number' && Number.isFinite(at) ? at : 0 }];
    }).slice(0, MAX_STYLE_RUNS);
  } catch {
    return [];
  }
}

export const STYLE_CAPABILITY_PREFILL = '帮我按这块场地的气质配一套现成风格';

/** 「按奶油会客配一套」→ 对应套；只说「按风格配一套」→ 打开选单。 */
export function matchStyleBundleCommand(text: string, storage?: StorageLike): StyleBundle | 'open' | null {
  const compact = text.replace(/\s+/g, '');
  if (!compact) return null;
  const bundles = listStyleBundles(storage);
  for (const bundle of bundles) {
    if ((compact.includes(bundle.name) || compact.includes(bundle.prompt.replace(/\s+/g, '')))
      && /(配一套|放一套|这一套)/.test(compact)) return bundle;
  }
  // 「按雾蓝极简发布会配一套」：提示词片段也能命中自存/内置 prompt。
  for (const bundle of bundles) {
    const tip = bundle.prompt.replace(/\s+/g, '');
    if (tip.length >= 4 && compact.includes(tip) && /(配|放|风格)/.test(compact)) return bundle;
  }
  if (compact === STYLE_CAPABILITY_PREFILL || /按风格配一套|配一套风格|风格配一套/.test(compact)) return 'open';
  return null;
}

export function saveStyleRun(style: string, storage?: StorageLike): StyleRun[] {
  const store = readStorage(storage);
  const runs = [{ style, at: Date.now() }, ...loadStyleRuns(storage).filter(run => run.style !== style)].slice(0, MAX_STYLE_RUNS);
  if (!store) return runs;
  try {
    store.setItem(STYLE_RUNS_KEY, JSON.stringify(runs));
  } catch {
    // A full store only costs the record, not the placement.
  }
  return runs;
}
