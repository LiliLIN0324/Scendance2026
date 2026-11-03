/**
 * 按风格配一套：把内置家具套按风格换色，作为物料卡里的一组建议。
 * 风格只描述色调与一句话，位置与尺寸仍由 lib/furniture-sets 的放样逻辑算。
 */
/** 只用到 localStorage 的这两个方法，测试可传替身。 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StyleBundle {
  key: string;
  name: string;
  /** 一句说明：一套里有什么。 */
  note: string;
  /** 映射到 FURNITURE_SETS 的内置套。 */
  setKey: string;
  /** 缩略图用的小色板。 */
  swatches: readonly string[];
  /** 按件型换色；套里没有的件型保持目录本色。 */
  colors: Readonly<Record<string, string>>;
}

export const STYLE_BUNDLES: readonly StyleBundle[] = [
  {
    key: 'cream-lounge', name: '奶油会客', note: '沙发、茶几、电视与绿植，一套 4 件', setKey: 'lounge',
    swatches: ['#EFE6D6', '#DCCBAE', '#8A7F70', '#B7C6A6'],
    colors: { sofa: '#E8DCC8', 'coffee-table': '#D9C7AE', tv: '#8A7F70', plant: '#B7C6A6' },
  },
  {
    key: 'walnut-dining', name: '深木就餐', note: '餐桌加四把椅，一套 5 件', setKey: 'dining',
    swatches: ['#6B4A32', '#7A5638', '#A98B6C', '#E7DDD0'],
    colors: { 'dining-table': '#6B4A32', 'dining-chair': '#7A5638' },
  },
  {
    key: 'clear-office', name: '清透办公', note: '书桌、椅、电脑与台灯，一套 4 件', setKey: 'home-office',
    swatches: ['#DCE3E8', '#C3D0DA', '#46586A', '#EDF2F5'],
    colors: { desk: '#DCE3E8', chair: '#C3D0DA', computer: '#46586A', lamp: '#EDF2F5' },
  },
];

/** 我的生成里的一条记录：风格套用一次记一条，同一套只留最新一条。 */
export interface StyleRun {
  style: string;
  at: number;
}

export const STYLE_RUNS_KEY = 'scendance:style-runs';
const MAX_STYLE_RUNS = 8;

function readStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadStyleRuns(storage?: StorageLike): StyleRun[] {
  const store = readStorage(storage);
  if (!store) return [];
  try {
    const raw = store.getItem(STYLE_RUNS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    const runs = Array.isArray(parsed) ? parsed : [];
    const known = new Set(STYLE_BUNDLES.map(bundle => bundle.key));
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
