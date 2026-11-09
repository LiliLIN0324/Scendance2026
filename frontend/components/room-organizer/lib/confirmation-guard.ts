import { isPureGreeting, isGeneralActivityQuestion } from './general-activity-question';
import { isStopCommand } from './workbench-agent';
import { isStructuralMarker } from './structural-layout';
import type { FurnitureItem, RoomLayout } from './types';

/**
 * 智能建造确认护栏（纯函数）。
 *
 * 已接入：
 * - proposal：对话「确认布置」与云端预览确认，候选票据带 candidateId + requirementVersion
 * - review：体检改法提案，以及原始场景局部移动确认
 * - rebuild：场地重建草稿勾选后的「确认应用场地修改」
 * - material：物料个性化预览确认
 * - restore：历史恢复副本确认
 *
 * 冲突（大面板未整文件改写）：
 * - agent-panel 里地图圈地、空白场地、风格历史保存仍各自返回，不在本护栏里重写状态机
 * - creative-studio 的 applyPreview / applyMaterial，以及 room-organizer 的 onApplyCreative，
 *   仍由调用前的确认入口负责票据；这里不改这两份大面板的应用状态机
 * - 重建面板里「确认结构并继续设计」仍走识别任务，不在本次最小接线内
 * - 不改 conversation-api / auth
 */

export const CONFIRMATION_ENTRIES = ['proposal', 'rebuild', 'material', 'review', 'restore'] as const;
export type ConfirmationEntry = (typeof CONFIRMATION_ENTRIES)[number];

export interface RequirementState {
  version: number;
  inputId: string;
  digest: string;
}

export interface CandidateTicket {
  entry: ConfirmationEntry;
  candidateId: string;
  requirementVersion: number;
  requirementDigest: string;
  inputId: string;
}

export interface ConfirmationClaim {
  entry: ConfirmationEntry;
  candidateId: string;
  requirementVersion: number;
}

export interface ProtectedAttributes {
  id: string;
  floorId: string;
  locked: boolean;
  structural: boolean;
  position: { x: number; z: number } | null;
  rotation: number | null;
  elevation: number | null;
  width?: number;
  depth?: number;
  height?: number;
  type?: string;
  name?: string;
  assetId?: string | null;
  notes?: string | null;
  color?: string;
}

export interface ProtectionIssue {
  code: 'MISSING' | 'MOVED' | 'ATTRIBUTE' | 'DUPLICATE' | 'UNKNOWN';
  id: string;
  attribute?: string;
}

export type ConfirmationDecision =
  | { ok: true }
  | { ok: false; code: string; message: string; ids: string[] };

const POS_EPS = 1e-9;

export function emptyRequirement(): RequirementState {
  return { version: 0, inputId: '', digest: '' };
}

export function requirementDigest(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0');
}

export function sameRequirement(left: RequirementState, right: RequirementState): boolean {
  return left.version === right.version && left.inputId === right.inputId && left.digest === right.digest;
}

/** 新的一条需求输入。同一 inputId 且正文不变时不升版本。 */
export function acceptRequirement(state: RequirementState, input: { inputId: string; text: string }): RequirementState {
  const text = input.text.normalize('NFKC').trim();
  const inputId = input.inputId.trim();
  if (!text || !inputId || text.length > 8000 || inputId.length > 8000) return state;
  if (!Number.isSafeInteger(state.version) || state.version < 0) return state;
  const digest = requirementDigest(text);
  if (state.inputId === inputId && state.digest === digest) return state;
  const version = state.version + 1;
  if (!Number.isSafeInteger(version)) return state;
  return { version, inputId, digest };
}

/** 从一段稳定正文得到版本 1 的需求。正文变了，摘要就对不上旧票据。 */
export function requirementFromText(text: string): RequirementState {
  const normalized = text.normalize('NFKC').trim();
  if (!normalized) return emptyRequirement();
  const digest = requirementDigest(normalized);
  return acceptRequirement(emptyRequirement(), { inputId: digest, text: digest });
}

/** 问候、停止、确认口令、以及只读问答不算新需求，避免普通问答清掉当前预览。 */
export function isRequirementInput(text: string): boolean {
  const raw = text.normalize('NFKC').trim();
  if (!raw || raw.length > 4000) return false;
  if (isPureGreeting(raw) || isStopCommand(raw) || isGeneralActivityQuestion(raw)) return false;
  const compact = raw.replace(/\s+/g, '');
  if (/^(?:请|帮我)?(?:确认布置|确认这版(?:方案|布置)?|确认该方案|应用这版(?:方案|布置)?|应用该方案)[。！!]*$/.test(compact)) return false;
  return /(?:保留|保持|锁定|解锁|不要删|不许删|增加|加上|添加|再加|摆上|放上|移除|删除|撤掉|挪动|移动|换成|改成|人数|课桌|圆桌|\d+\s*(?:人|位|把|张|套|米))/.test(compact);
}

export function bindCandidate(entry: ConfirmationEntry, candidateId: string, requirement: RequirementState): CandidateTicket | null {
  if (!CONFIRMATION_ENTRIES.includes(entry)) return null;
  const id = candidateId.trim();
  if (!id || id.length > 200) return null;
  if (!Number.isSafeInteger(requirement.version) || requirement.version < 0) return null;
  if (requirement.version > 0 && (!requirement.inputId || !requirement.digest)) return null;
  return {
    entry,
    candidateId: id,
    requirementVersion: requirement.version,
    requirementDigest: requirement.digest,
    inputId: requirement.inputId,
  };
}

export function decideConfirmation(
  ticket: CandidateTicket | null | undefined,
  claim: ConfirmationClaim,
  live: RequirementState,
): ConfirmationDecision {
  if (!ticket) return fail('MISSING_TICKET', '这版候选没有确认票据，请重新生成后再确认。', []);
  if (claim.entry !== ticket.entry) return fail('ENTRY_MISMATCH', '确认入口与这版候选不一致，请在原来的入口重新核对。', []);
  if (!claim.candidateId || claim.candidateId !== ticket.candidateId) {
    return fail('CANDIDATE_MISMATCH', '确认的候选编号对不上，旧候选不能应用。', [ticket.candidateId]);
  }
  if (claim.requirementVersion !== ticket.requirementVersion) {
    return fail('REQUIREMENT_MISMATCH', '确认的需求版本对不上这版候选，请按当前需求重新生成。', [ticket.candidateId]);
  }
  if (!sameRequirement(live, { version: ticket.requirementVersion, inputId: ticket.inputId, digest: ticket.requirementDigest })) {
    return fail('STALE_REQUIREMENT', '新的需求已记下，上一版候选已失效。请按当前要求重新生成后再确认。', [ticket.candidateId]);
  }
  return { ok: true };
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sameAngle(left: number, right: number): boolean {
  return Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right))) <= POS_EPS;
}

function samePoint(left: { x: number; z: number } | null, right: { x: number; z: number } | null | undefined): boolean {
  if (!left || !right || !finite(left.x) || !finite(left.z) || !finite(right.x) || !finite(right.z)) return false;
  return Math.abs(left.x - right.x) <= POS_EPS && Math.abs(left.z - right.z) <= POS_EPS;
}

export function captureProtection(layout: RoomLayout): ProtectedAttributes[] | null {
  if (!Array.isArray(layout.floors)) return null;
  const seen = new Set<string>();
  const items: ProtectedAttributes[] = [];
  for (const floor of layout.floors) {
    if (!floor?.id?.trim() || !Array.isArray(floor.items)) return null;
    for (const item of floor.items) {
      if (!item?.id?.trim() || seen.has(item.id)) return null;
      seen.add(item.id);
      items.push(attributesOf(floor.id, item));
    }
  }
  return items;
}

function attributesOf(floorId: string, item: FurnitureItem): ProtectedAttributes {
  const position = item.position;
  return {
    id: item.id,
    floorId,
    locked: item.locked === true,
    structural: isStructuralMarker(item),
    position: position && finite(position.x) && finite(position.z) ? { x: position.x, z: position.z } : null,
    rotation: item.rotation === undefined ? 0 : finite(item.rotation) ? item.rotation : null,
    elevation: item.elevation === undefined ? 0 : finite(item.elevation) ? item.elevation : null,
    width: item.width,
    depth: item.depth,
    height: item.height,
    type: item.type,
    name: item.name,
    assetId: item.assetId ?? null,
    notes: item.notes ?? null,
    color: item.color,
  };
}

interface IndexedItem {
  floorId: string;
  item: FurnitureItem;
}

function indexCandidate(layout: RoomLayout): Map<string, IndexedItem> | null {
  if (!Array.isArray(layout.floors)) return null;
  const map = new Map<string, IndexedItem>();
  for (const floor of layout.floors) {
    if (!floor?.id || !Array.isArray(floor.items)) return null;
    for (const item of floor.items) {
      if (!item?.id || map.has(item.id)) return null;
      map.set(item.id, { floorId: floor.id, item });
    }
  }
  return map;
}

export interface ProtectionPolicy {
  locks: boolean;
  preserve: { keepAll: boolean; keepPositions: boolean } | null;
  /** identity：结构标记必须还在，位置可以随门窗草稿变化。full：连位置和尺寸一起核对。 */
  structural: 'off' | 'identity' | 'full';
  /** 未锁定物件允许更换资产和颜色，其余保护属性仍按 ID 核对。 */
  allowUnlockedAssetAndColor?: boolean;
}

export function protectionPolicy(entry: ConfirmationEntry, preserve: ProtectionPolicy['preserve']): ProtectionPolicy {
  if (entry === 'material') return { locks: true, preserve: { keepAll: true, keepPositions: true }, structural: 'identity', allowUnlockedAssetAndColor: true };
  if (entry === 'rebuild') return { locks: true, preserve, structural: 'identity' };
  return { locks: true, preserve, structural: 'identity' };
}

function poseIssue(old: ProtectedAttributes, found: IndexedItem): ProtectionIssue | null {
  const next = found.item;
  const rotation = next.rotation ?? 0;
  const elevation = next.elevation ?? 0;
  if (!old.position || old.rotation === null || old.elevation === null || !next.position || !finite(next.position.x) || !finite(next.position.z) || !finite(rotation) || !finite(elevation)) {
    return { code: 'UNKNOWN', id: old.id, attribute: '位置' };
  }
  if (old.floorId !== found.floorId || !samePoint(old.position, next.position) || !sameAngle(old.rotation, rotation) || Math.abs(old.elevation - elevation) > POS_EPS) {
    return { code: 'MOVED', id: old.id, attribute: '位置或方向' };
  }
  return null;
}

function attributeIssue(old: ProtectedAttributes, found: IndexedItem, allowAssetAndColor: boolean): ProtectionIssue | null {
  const next = found.item;
  const checks: Array<[string, boolean]> = [
    ['锁定', next.locked === true === old.locked],
    ['宽度', old.width === undefined || (finite(old.width) && finite(next.width) && Math.abs(old.width - next.width) <= POS_EPS)],
    ['进深', old.depth === undefined || (finite(old.depth) && finite(next.depth) && Math.abs(old.depth - next.depth) <= POS_EPS)],
    ['高度', old.height === undefined || (finite(old.height) && finite(next.height) && Math.abs(old.height - next.height) <= POS_EPS)],
    ['类型', old.type === undefined || next.type === old.type],
    ['名称', allowAssetAndColor || old.name === undefined || next.name === old.name],
    ['资产', allowAssetAndColor || old.assetId === undefined || (next.assetId ?? null) === old.assetId],
    ['备注', old.notes === undefined || (next.notes ?? null) === old.notes],
    ['颜色', allowAssetAndColor || old.color === undefined || next.color === old.color],
  ];
  if (old.width !== undefined && !finite(old.width)) return { code: 'UNKNOWN', id: old.id, attribute: '宽度' };
  for (const [attribute, ok] of checks) if (!ok) return { code: 'ATTRIBUTE', id: old.id, attribute };
  return null;
}

/**
 * 按 ID 与保护属性核对。锁定件数相同、或用新 ID 补齐数量，都不能通过。
 */
export function reviewProtection(
  baseline: readonly ProtectedAttributes[],
  candidate: RoomLayout,
  policy: ProtectionPolicy,
): { ok: true } | { ok: false; issues: ProtectionIssue[]; message: string; ids: string[] } {
  const indexed = indexCandidate(candidate);
  if (!indexed) return { ok: false, issues: [{ code: 'DUPLICATE', id: '' }], message: '物件身份无法核对，请重新生成。', ids: [] };
  const seen = new Set<string>();
  const issues: ProtectionIssue[] = [];
  for (const old of baseline) {
    if (!old.id || seen.has(old.id)) {
      issues.push({ code: 'UNKNOWN', id: old.id || '' });
      continue;
    }
    seen.add(old.id);
    const found = indexed.get(old.id);
    const structuralIdentity = policy.structural === 'identity' && old.structural;
    const protectLock = policy.locks && old.locked && !structuralIdentity;
    const protectStructural = old.structural && policy.structural !== 'off';
    const protectExistence = policy.preserve?.keepAll === true || protectLock || protectStructural;
    if (!protectExistence) continue;
    if (!found) {
      issues.push({ code: 'MISSING', id: old.id });
      continue;
    }
    if (protectStructural && policy.structural === 'identity' && !protectLock && !policy.preserve?.keepPositions) continue;
    const comparePose = protectLock || policy.structural === 'full' && old.structural || policy.preserve?.keepPositions === true;
    if (comparePose) {
      const pose = poseIssue(old, found);
      if (pose) issues.push(pose);
    }
    const compareAttributes = protectLock || policy.structural === 'full' && old.structural || policy.allowUnlockedAssetAndColor === true;
    if (compareAttributes && (protectLock || old.structural || policy.allowUnlockedAssetAndColor === true)) {
      const allowAsset = policy.allowUnlockedAssetAndColor === true && !old.locked;
      const attribute = attributeIssue(old, found, allowAsset);
      if (attribute) issues.push(attribute);
    }
  }
  if (!issues.length) return { ok: true };
  return { ok: false, issues, ids: [...new Set(issues.map(issue => issue.id).filter(Boolean))], message: protectionMessage(issues) };
}

function protectionMessage(issues: readonly ProtectionIssue[]): string {
  const missing = issues.filter(issue => issue.code === 'MISSING');
  const moved = issues.filter(issue => issue.code === 'MOVED');
  const attributes = issues.filter(issue => issue.code === 'ATTRIBUTE');
  const unknown = issues.some(issue => issue.code === 'UNKNOWN' || issue.code === 'DUPLICATE');
  const parts: string[] = [];
  if (missing.length) parts.push(`${missing.length} 件按编号缺失（${missing.map(issue => issue.id).join('、')}）`);
  if (moved.length) parts.push(`${moved.length} 件位置或方向改变（${moved.map(issue => issue.id).join('、')}）`);
  if (attributes.length) parts.push(attributes.map(issue => `物件 ${issue.id} 的${issue.attribute ?? '保护属性'}已变化`).join('，'));
  if (!parts.length && unknown) return '原物身份或保护属性无法核对，请重新生成。';
  return `锁定或保留核对未通过：${parts.join('；')}。件数相同不能代替编号和保护属性。`;
}

export interface EntryConfirmation {
  entry: ConfirmationEntry;
  ticket: CandidateTicket | null | undefined;
  claim: ConfirmationClaim;
  live: RequirementState;
  baseline: ProtectedAttributes[] | null;
  candidate: RoomLayout;
  preserve?: { keepAll: boolean; keepPositions: boolean } | null;
}

export function confirmEntry(input: EntryConfirmation): ConfirmationDecision {
  const versions = decideConfirmation(input.ticket, input.claim, input.live);
  if (!versions.ok) return versions;
  if (!input.baseline) return fail('IDENTITY_UNKNOWN', '物件身份无法核对，请重新生成。', []);
  const policy = protectionPolicy(input.entry, input.preserve ?? null);
  const protection = reviewProtection(input.baseline, input.candidate, policy);
  if (!protection.ok) return fail('PROTECTION_MISMATCH', protection.message, protection.ids);
  return { ok: true };
}

function fail(code: string, message: string, ids: string[]): ConfirmationDecision {
  return { ok: false, code, message, ids };
}
