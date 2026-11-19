/**
 * 发给客户评审时定下的权限。
 *
 * 三枚开关默认都开。关掉「可切换图层 / 可切换底图」时，评审页锁在发出时的
 * 图层和底图上。关掉「可落钉意见」与链接上的 `?view=1` 一样，只能看。
 * 权限跟短链载荷走，不改方案哈希，长短链仍对齐同一组钉。
 */

export const REVIEW_BASEMAPS = ['map', 'satellite', 'light', 'paper'] as const;
export type ReviewBasemap = (typeof REVIEW_BASEMAPS)[number];

export interface ReviewPermissions {
  pins: boolean;
  levels: boolean;
  basemap: boolean;
}

export interface ReviewAccess extends ReviewPermissions {
  /** 发出时正在看的图层。不可切换时评审页停在这一层。 */
  levelId: string | null;
  basemapStyle: ReviewBasemap;
}

export const DEFAULT_REVIEW_ACCESS: ReviewAccess = {
  pins: true,
  levels: true,
  basemap: true,
  levelId: null,
  basemapStyle: 'map',
};

export const REVIEW_BASEMAP_LABEL: Record<ReviewBasemap, string> = {
  map: '地图',
  satellite: '卫星',
  light: '浅色',
  paper: '纸面',
};

export function parseReviewAccess(value: unknown): ReviewAccess {
  if (!value || typeof value !== 'object') return { ...DEFAULT_REVIEW_ACCESS };
  const record = value as Record<string, unknown>;
  const style = REVIEW_BASEMAPS.find(item => item === record.basemapStyle) ?? 'map';
  const levelId = typeof record.levelId === 'string' && record.levelId.trim().length > 0 && record.levelId.length <= 80
    ? record.levelId
    : null;
  return {
    pins: record.pins !== false,
    levels: record.levels !== false,
    basemap: record.basemap !== false,
    levelId,
    basemapStyle: style,
  };
}

/** 工作台当前地面：纸面优先，其余按图源归到评审页的四档。 */
export function reviewBasemapFromGround(mode: string | null | undefined, source: string | null | undefined): ReviewBasemap {
  if (mode === 'paper') return 'paper';
  if (source === 'amap-satellite' || source === 'esri-satellite' || source === 'img') return 'satellite';
  if (source === 'carto-light') return 'light';
  return 'map';
}

export function reviewLinkFailureCopy(reason: string): string {
  switch (reason) {
    case 'signed-out':
      return '登录后才能生成短评审链接。这次没有改发一条很长的链接。';
    case 'disabled':
      return '评审短链服务还没接上。这次没有生成链接。';
    case 'network':
      return '评审短链暂时连不上。这次没有生成链接，请稍后再试。';
    case 'too-large':
      return '这份方案太大，短链放不下。这次没有生成链接。';
    default:
      return '评审短链没有被收下。这次没有生成链接。';
  }
}
