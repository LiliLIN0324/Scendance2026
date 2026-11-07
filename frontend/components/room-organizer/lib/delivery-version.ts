/**
 * 交付版本身份（SC-06）与分享绑版本（SC-10）的纯函数 + 本机记录。
 *
 * 规格：docs/36 §4。要点：
 * - 身份长在「确认版」上，不跟草案走：确认一次分配 v1.0，之后内容再改只出草案身份。
 * - `contentFingerprint` = sha256(规范化公开快照 JSON) 全长；`snapshotId` 取前 16 位。
 *   公开快照与 `share.ts` 的 `#layout=` 载荷同一份（`layoutForExport(layout, true)` 且去掉底图），
 *   所以评审页能从链接内容重算指纹，核对「链接里装的是不是这个号的那一版」。
 * - 同号不同指纹 = 数据被改写；确认时一律换号（次版本 +1），旧号永不回写。
 * - 记录只落 localStorage（键 `scendance.deliveryVersions.v1`），按项目键一条，
 *   不进布局、不进 schema：撤销/历史/云端发布都不该被版本身份污染。
 *
 * 已知边界：本机记录，换设备看不到；项目没有 id 时按 `local-draft` 归并
 * （与 review-share 的本机演示同一口径）。
 */
import { layoutForExport } from '../../../lib/layout-export';
import { DELIVERY_VERSION_PATTERN } from './delivery-package-spec';
import type { RoomLayout } from './types';

export const DELIVERY_VERSION_STORAGE_KEY = 'scendance.deliveryVersions.v1';
export const INITIAL_DELIVERY_VERSION = 'v1.0';
export const DRAFT_PROJECT_KEY = 'local-draft';
const SNAPSHOT_ID_LENGTH = 16;
const MAX_RECORDS = 40;
const SNAPSHOT_ID_PATTERN = /^[0-9a-f]{16}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

export interface DeliveryVersionRecord {
  projectKey: string;
  deliveryVersion: string;
  snapshotId: string;
  contentFingerprint: string;
  layoutName: string;
  confirmedAt: string;
}

export type DeliveryVersionStatus = 'none' | 'confirmed' | 'draft';

export interface DeliveryVersionState {
  projectKey: string;
  /** none = 从未确认；confirmed = 当前内容和已确认版一致；draft = 已确认过，但内容又改了。 */
  status: DeliveryVersionStatus;
  /** draft 时是「确认这一版」将要分配的号，confirmed 时就是已确认的号。 */
  deliveryVersion: string;
  snapshotId: string;
  contentFingerprint: string;
  confirmed: DeliveryVersionRecord | null;
}

/** 评审链接与导出共用的公开快照形状；改这里等于改分享载荷，测试会盯住。 */
export function deliveryShareableLayout(layout: RoomLayout): RoomLayout {
  const shareable = layoutForExport(layout, true);
  delete shareable.floorPlanImage;
  return shareable;
}

/** 键序无关的 JSON：同一份内容不管字段先后都得到同一串。 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export async function contentFingerprintOfShareable(shareable: RoomLayout): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('版本身份需要安全连接或本机浏览器。');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(shareable)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function contentFingerprintOfLayout(layout: RoomLayout): Promise<string> {
  return contentFingerprintOfShareable(deliveryShareableLayout(layout));
}

export function snapshotIdFor(fingerprint: string): string {
  return fingerprint.slice(0, SNAPSHOT_ID_LENGTH);
}

/** v1.0 → v1.1；v9 → v1.0 这类坏号一律回落到 v1.0，不抛错卡住确认。 */
export function nextDeliveryVersion(version: string): string {
  const match = /^v(\d+)\.(\d+)$/.exec(version);
  if (!match || !DELIVERY_VERSION_PATTERN.test(version)) return INITIAL_DELIVERY_VERSION;
  return `v${Number(match[1])}.${Number(match[2]) + 1}`;
}

export function deliveryProjectKey(layout: Pick<RoomLayout, 'id'>): string {
  const id = layout.id?.trim() ?? '';
  return id || DRAFT_PROJECT_KEY;
}

export async function deliveryVersionState(input: {
  layout: RoomLayout;
  storage: Pick<Storage, 'getItem'> | null;
}): Promise<DeliveryVersionState> {
  const shareable = deliveryShareableLayout(input.layout);
  const contentFingerprint = await contentFingerprintOfShareable(shareable);
  const projectKey = deliveryProjectKey(input.layout);
  const confirmed = readDeliveryVersionRecords(input.storage).find((record) => record.projectKey === projectKey) ?? null;
  if (!confirmed) {
    return {
      projectKey, status: 'none', deliveryVersion: INITIAL_DELIVERY_VERSION,
      snapshotId: snapshotIdFor(contentFingerprint), contentFingerprint, confirmed: null,
    };
  }
  if (confirmed.contentFingerprint === contentFingerprint) {
    return {
      projectKey, status: 'confirmed', deliveryVersion: confirmed.deliveryVersion,
      snapshotId: confirmed.snapshotId, contentFingerprint, confirmed,
    };
  }
  return {
    projectKey, status: 'draft', deliveryVersion: nextDeliveryVersion(confirmed.deliveryVersion),
    snapshotId: snapshotIdFor(contentFingerprint), contentFingerprint, confirmed,
  };
}

/**
 * 「确认这一版」：把当前内容立成一个正式交付版。
 * 同内容重复点等于读回原记录（幂等）；内容变了就换号，旧号记录被本条替换。
 */
export async function confirmDeliveryVersion(input: {
  layout: RoomLayout;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  now?: string;
}): Promise<{ record: DeliveryVersionRecord; state: DeliveryVersionState }> {
  const state = await deliveryVersionState({ layout: input.layout, storage: input.storage });
  if (state.status === 'confirmed' && state.confirmed) return { record: state.confirmed, state };
  if (!input.storage) throw new Error('这台浏览器没有存下版本身份，无法确认这一版。');
  const record: DeliveryVersionRecord = {
    projectKey: state.projectKey,
    deliveryVersion: state.deliveryVersion,
    snapshotId: state.snapshotId,
    contentFingerprint: state.contentFingerprint,
    layoutName: input.layout.name,
    confirmedAt: input.now ?? new Date().toISOString(),
  };
  const rest = readDeliveryVersionRecords(input.storage).filter((entry) => entry.projectKey !== record.projectKey);
  try {
    input.storage.setItem(DELIVERY_VERSION_STORAGE_KEY, JSON.stringify([record, ...rest].slice(0, MAX_RECORDS)));
  } catch {
    throw new Error('这台浏览器没有存下版本身份，无法确认这一版。');
  }
  return { record, state: { ...state, status: 'confirmed', deliveryVersion: record.deliveryVersion, snapshotId: record.snapshotId, confirmed: record } };
}

export function readDeliveryVersionRecords(storage: Pick<Storage, 'getItem'> | null): DeliveryVersionRecord[] {
  if (!storage) return [];
  let parsed: unknown;
  try {
    const raw = storage.getItem(DELIVERY_VERSION_STORAGE_KEY);
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const records: DeliveryVersionRecord[] = [];
  for (const entry of parsed) {
    const record = parseRecord(entry);
    if (!record) continue;
    records.push(record);
    if (records.length >= MAX_RECORDS) break;
  }
  return records;
}

/** 面板上一句话说明这个号现在的分量；不给没确认过的草案冒充正式版。 */
export function deliveryVersionLabel(state: DeliveryVersionState | null): string {
  if (!state) return '正在核对版本身份…';
  if (state.status === 'confirmed') return `${state.deliveryVersion} 已确认`;
  if (state.status === 'draft') return `${state.deliveryVersion} 草案 · 已确认的是 ${state.confirmed?.deliveryVersion ?? INITIAL_DELIVERY_VERSION}`;
  return '还没有确认过这一版';
}

function parseRecord(value: unknown): DeliveryVersionRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const projectKey = typeof record.projectKey === 'string' ? record.projectKey.trim() : '';
  const deliveryVersion = typeof record.deliveryVersion === 'string' ? record.deliveryVersion : '';
  const snapshotId = typeof record.snapshotId === 'string' ? record.snapshotId : '';
  const contentFingerprint = typeof record.contentFingerprint === 'string' ? record.contentFingerprint : '';
  const confirmedAt = typeof record.confirmedAt === 'string' ? record.confirmedAt : '';
  if (!projectKey || !confirmedAt) return null;
  if (!DELIVERY_VERSION_PATTERN.test(deliveryVersion)) return null;
  if (!SNAPSHOT_ID_PATTERN.test(snapshotId) || !FINGERPRINT_PATTERN.test(contentFingerprint)) return null;
  // 记录一旦被改过就不认：快照号必须确实是这条指纹的前缀。
  if (snapshotIdFor(contentFingerprint) !== snapshotId) return null;
  return {
    projectKey, deliveryVersion, snapshotId, contentFingerprint,
    layoutName: typeof record.layoutName === 'string' ? record.layoutName.slice(0, 120) : '',
    confirmedAt,
  };
}
