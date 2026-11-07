/**
 * 交付包规格（MP-DEL / SC-12）——B1 版本身份与 B2 一键打包共用这一份常量。
 * 规格正文：docs/36-MP-DEL交付包规格.md。只放纯数据与纯函数，不碰 three / DOM。
 */
export const DELIVERY_PACKAGE_FORMAT = 'scendance-delivery-package';
export const DELIVERY_PACKAGE_VERSION = 1;
/** 必须与 scene-delivery.ts 的 sceneDeliveryJson 输出一致（测试会读源文件核对）。 */
export const DELIVERY_SCENE_FORMAT = 'scendance-scene-delivery';
export const DELIVERY_SCENE_FORMAT_VERSION = 2;
export const DELIVERY_VERSION_PATTERN = /^v\d+\.\d+$/;

export type DeliveryArtifactKind = 'hero' | 'floor' | 'materials' | 'share' | 'manifest' | 'readme';

export interface DeliveryArtifactSpec {
  kind: DeliveryArtifactKind;
  /** 包内目录；空串 = zip 根 */
  dir: string;
  /** 文件名主体（不含序号与扩展名） */
  base: string;
  extension: string;
  /** 同一交付里应有的份数；缺一份即整包不完整 */
  count: number;
}

/** v1 只冻结 docs/24 §1.1 要的四件套 + 清单 + 说明，不把报价/库存塞进来。 */
export const DELIVERY_ARTIFACTS: readonly DeliveryArtifactSpec[] = [
  { kind: 'hero', dir: '01-效果图', base: '效果图', extension: 'png', count: 3 },
  { kind: 'floor', dir: '02-平面图', base: '平面', extension: 'dxf', count: 1 },
  { kind: 'materials', dir: '03-物料清单', base: '物料清单', extension: 'csv', count: 1 },
  { kind: 'share', dir: '04-分享', base: '分享链接', extension: 'txt', count: 1 },
  { kind: 'manifest', dir: '', base: 'manifest', extension: 'json', count: 1 },
  { kind: 'readme', dir: '', base: 'README', extension: 'txt', count: 1 },
];

/** 交付面板的清洗规则 `[\\/:*?"<>|\s]+` → `_`；包名再剥掉首尾 `_`，避免 `幕景__项目__v1.0`。 */
export function safeFilePart(value: string, fallback: string): string {
  const cleaned = (value || fallback).replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

export function isDeliveryVersion(value: string): boolean {
  return DELIVERY_VERSION_PATTERN.test(value);
}

/** zip 根目录：幕景_<项目>_v<主>.<次>；版本号非法直接拒绝，避免包名与清单不一致。 */
export function deliveryPackageRoot(projectName: string, deliveryVersion: string): string {
  if (!isDeliveryVersion(deliveryVersion)) throw new Error(`交付版本号必须是 v<主>.<次>：${deliveryVersion}`);
  return `幕景_${safeFilePart(projectName, '项目')}_${deliveryVersion}`;
}

export function deliveryArtifactPath(spec: DeliveryArtifactSpec, index = 1, floorName?: string): string {
  const numbered = spec.count > 1 ? `${spec.base}-${String(index).padStart(2, '0')}` : spec.base;
  const name = spec.kind === 'floor' ? `${spec.base}-${safeFilePart(floorName ?? '', '1F')}` : numbered;
  return spec.dir ? `${spec.dir}/${name}.${spec.extension}` : `${name}.${spec.extension}`;
}

export interface DeliveryManifestEntry {
  kind: DeliveryArtifactKind;
  path: string;
  bytes: number;
  sha256: string;
}

export interface DeliveryManifest {
  format: typeof DELIVERY_PACKAGE_FORMAT;
  packageVersion: number;
  /** 版本身份（SC-06）：同一版重复打包必须复现同一个值 */
  deliveryVersion: string;
  /** 分享链接、包内文件、清单共用同一个快照号 */
  snapshotId: string;
  layoutId: string | null;
  projectName: string;
  generatedAt: string;
  sceneFormat: { format: typeof DELIVERY_SCENE_FORMAT; version: number };
  /** sha256(规范化场景 JSON) 的前 16 位；用于判断「内容是否变过」 */
  contentFingerprint: string;
  status: 'complete' | 'incomplete';
  files: DeliveryManifestEntry[];
  missing: Array<{ kind: DeliveryArtifactKind; code: DeliveryFailureCode; detail: string }>;
  share: { url: string } | null;
}

export const DELIVERY_MANIFEST_REQUIRED_FIELDS = [
  'format', 'packageVersion', 'deliveryVersion', 'snapshotId', 'layoutId', 'projectName',
  'generatedAt', 'sceneFormat', 'contentFingerprint', 'status', 'files', 'missing', 'share',
] as const satisfies ReadonlyArray<keyof DeliveryManifest>;

export type DeliveryFailureCode =
  | 'network'
  | 'asset-fetch'
  | 'timeout'
  | 'memory'
  | 'no-floor'
  | 'preset-unsupported'
  | 'entrance-unsupported'
  | 'share-over-budget'
  | 'render-failed';

export const DELIVERY_RETRY = {
  maxAttempts: 3,
  /** 第 1 次失败后等 1 s，第 2 次失败后等 4 s；第 3 次失败即判该产物失败。 */
  backoffMs: [1000, 4000],
  retryable: ['network', 'asset-fetch', 'timeout', 'memory'] as readonly DeliveryFailureCode[],
  /** 可恢复 = 逐产物续跑：已成功且 sha256 命中的文件直接复用，不重新渲染。 */
  resume: 'per-artifact' as const,
  /** 分享快照一旦生成不再重建：改版必须换 snapshotId，旧链接必须仍指向旧版。 */
  shareSnapshot: 'immutable' as const,
} as const;

export function isRetryableDeliveryCode(code: DeliveryFailureCode): boolean {
  return DELIVERY_RETRY.retryable.includes(code);
}
