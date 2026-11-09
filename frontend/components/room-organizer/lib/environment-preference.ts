import {captureWorkspaceWriteFence,rejectUnprotectedWorkspaceWrite} from '@/lib/workspace-write-fence';
import { localWriteCapabilityGuard, type LocalWriteCapability } from '@/lib/local-write-lease';
import { sameRecoveryFormValue } from '@/lib/recovery-form-value';
import { classifyStorageError } from './storage-errors';
import type { FurnitureItem } from './types';

/**
 * 项目里的高斯空间列表、摆放位置和各场地的物料布置记在本机：不写入结构场景文件，
 * 也不参与云端保存；同一个项目下次打开时会按楼层和坐标重新挂回这些点云。
 * 资产号来自随站点发布的样例或本机取回的环境包，名字只用于抽屉里的那行说明。
 */
export interface StoredEnvironment {
  assetId: string;
  name: string;
  position?: Readonly<{ x: number; y: number; z: number }>;
  /** Zero-based building storey this scanned space belongs to. */
  floorIndex?: number;
  /** Per-floor furniture placement for this Gaussian venue; local project data only. */
  itemsByFloor?: readonly (readonly FurnitureItem[])[];
}

const STORAGE_KEY = 'scendance:environment:v1';
const MAX_ENTRIES = 200;

function isStoredEnvironment(value: unknown): value is StoredEnvironment {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  const position = entry.position;
  const itemsByFloor = entry.itemsByFloor;
  const validPosition = position === undefined || (typeof position === 'object' && position !== null &&
    ['x', 'y', 'z'].every(axis => typeof (position as Record<string, unknown>)[axis] === 'number' && Number.isFinite((position as Record<string, number>)[axis])));
  const validItems = itemsByFloor === undefined || (Array.isArray(itemsByFloor) && itemsByFloor.length <= 8 &&
    itemsByFloor.every(floor => Array.isArray(floor) && floor.length <= 1000 && floor.every(item => {
      if (typeof item !== 'object' || item === null) return false;
      const candidate = item as Record<string, unknown>;
      const itemPosition = candidate.position;
      return typeof candidate.id === 'string' && typeof candidate.type === 'string' &&
        ['width', 'depth', 'height'].every(key => typeof candidate[key] === 'number' && Number.isFinite(candidate[key])) &&
        (itemPosition === undefined || (typeof itemPosition === 'object' && itemPosition !== null &&
          ['x', 'z'].every(axis => typeof (itemPosition as Record<string, unknown>)[axis] === 'number' && Number.isFinite((itemPosition as Record<string, number>)[axis]))));
    })));
  return typeof entry.assetId === 'string' && entry.assetId.length > 0 && entry.assetId.length <= 120 &&
    typeof entry.name === 'string' && entry.name.length <= 120 && validPosition && validItems &&
    (entry.floorIndex === undefined || (Number.isInteger(entry.floorIndex) && (entry.floorIndex as number) >= 0 && (entry.floorIndex as number) < 8));
}

export type EnvironmentChoice = StoredEnvironment | StoredEnvironment[] | null;

export function isEnvironmentList(value: unknown): value is StoredEnvironment[] {
  return Array.isArray(value) && value.length <= 24 && value.every(isStoredEnvironment);
}

function readAll(): Record<string, EnvironmentChoice> {
  if (typeof window === 'undefined') return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, EnvironmentChoice] =>
      entry[1] === null || isStoredEnvironment(entry[1]) || isEnvironmentList(entry[1])));
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, EnvironmentChoice>): void {
  if (typeof window === 'undefined') return;
  rejectUnprotectedWorkspaceWrite();
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // 配额满了只是这次记不住环境，画布照常挂，不打断编辑。
  }
}

export function environmentPreferenceKey(layoutId: string | undefined): string {
  return layoutId ?? 'draft';
}

export function readEnvironment(layoutId: string | undefined): StoredEnvironment | null {
  const value = readAll()[environmentPreferenceKey(layoutId)];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

/** Read multiple scanned spaces while migrating the previous single-space record transparently. */
export function readEnvironments(layoutId: string | undefined): StoredEnvironment[] {
  const value = readAll()[environmentPreferenceKey(layoutId)];
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

/** distinguishes a first visit (use the project default) from an intentional clear. */
export function hasEnvironmentPreference(layoutId: string | undefined): boolean {
  return Object.hasOwn(readAll(), environmentPreferenceKey(layoutId));
}

export function writeEnvironment(layoutId: string | undefined, value: StoredEnvironment): void {
  writeEnvironments(layoutId, [value]);
}

export function writeEnvironments(layoutId: string | undefined, values: readonly StoredEnvironment[]): void {
  const all = readAll();
  const key = environmentPreferenceKey(layoutId);
  const entries = { ...all, [key]: [...values].slice(0, 24) };
  const keys = Object.keys(entries);
  if (keys.length > MAX_ENTRIES) {
    for (const stale of keys.slice(0, keys.length - MAX_ENTRIES)) delete entries[stale];
  }
  writeAll(entries);
}

export function clearEnvironment(layoutId: string | undefined): void {
  const all = readAll();
  const key = environmentPreferenceKey(layoutId);
  if (Object.hasOwn(all, key) && all[key] === null) return;
  // Keep a tombstone so an explicitly cleared project does not get the default scene back on reload.
  all[key] = null;
  writeAll(all);
}


export type EnvironmentStrictWriteResult =
  | { ok: true; json: string }
  | { ok: false; reason: 'lease-invalid' | 'invalid-data' | 'invalid-scope' | 'conflict' | 'quota' | 'blocked' | 'unknown' | 'readback-mismatch'; writeStatus: 'not-attempted' | 'unknown' };

/** Explicit guarded path; legacy best-effort APIs remain separate until the workspace migrates. */
function strictEnvironmentUpdate(layoutId: string | undefined, values: readonly StoredEnvironment[] | null, capability: LocalWriteCapability, options?: {expectedRaw: string | null}): EnvironmentStrictWriteResult {
  let guard: ReturnType<typeof localWriteCapabilityGuard>;
  try { const fence=captureWorkspaceWriteFence(capability);fence?.();guard = localWriteCapabilityGuard(capability); }
  catch { return {ok:false,reason:'lease-invalid',writeStatus:'not-attempted'}; }
  let attempted=false;
  class LeaseFailure extends Error {}
  class Conflict extends Error {}
  class InvalidData extends Error {}
  class ReadbackMismatch extends Error {}
  const fence=captureWorkspaceWriteFence(capability);
  const check = () => { try { fence?.();guard.assertStillHeld(); if (guard.signal.aborted) throw new Error(); } catch { throw new LeaseFailure(); } };
  try {
    check();
    if (layoutId !== undefined && (!layoutId.trim() || layoutId.length > 128 || layoutId === 'draft')) return {ok:false,reason:'invalid-scope',writeStatus:'not-attempted'};
    if (typeof window === 'undefined' || !window.localStorage) return {ok:false,reason:'blocked',writeStatus:'not-attempted'};
    const storage=window.localStorage;
    const raw=storage.getItem(STORAGE_KEY);
    check();
    if (options && raw !== options.expectedRaw) throw new Conflict();
    let all:unknown;
    try { all=raw===null?{}:JSON.parse(raw); } catch { throw new InvalidData(); }
    if (!all || typeof all!=='object' || Array.isArray(all)) throw new InvalidData();
    const source=all as Record<string,unknown>;
    if (Object.keys(source).length>MAX_ENTRIES || !Object.values(source).every(value=>value===null || isStoredEnvironment(value) || isEnvironmentList(value))) throw new InvalidData();
    try { if (values!==null && (values.length>24 || !sameRecoveryFormValue(values,values) || !isEnvironmentList(values))) throw new InvalidData(); }
    catch { throw new InvalidData(); }
    const key=environmentPreferenceKey(layoutId);
    const next={...source,[key]:values===null?null:[...values]};
    if (Object.keys(next).length>MAX_ENTRIES) throw new InvalidData();
    const json=JSON.stringify(next);
    // Refuse values that JSON would silently alter or omit.
    try { if (!sameRecoveryFormValue(next,JSON.parse(json))) throw new InvalidData(); } catch { throw new InvalidData(); }
    check();
    if (storage.getItem(STORAGE_KEY)!==raw) throw new Conflict();
    check();attempted=true;
    storage.setItem(STORAGE_KEY,json);
    check();
    if (storage.getItem(STORAGE_KEY)!==json) throw new ReadbackMismatch();
    check();
    return {ok:true,json};
  } catch(error) {
    const writeStatus=attempted?'unknown':'not-attempted';
    if (error instanceof LeaseFailure) return {ok:false,reason:'lease-invalid',writeStatus};
    if (error instanceof InvalidData) return {ok:false,reason:'invalid-data',writeStatus};
    if (error instanceof Conflict) return {ok:false,reason:'conflict',writeStatus};
    if (error instanceof ReadbackMismatch) return {ok:false,reason:'readback-mismatch',writeStatus};
    return {ok:false,reason:classifyStorageError(error),writeStatus};
  }
}

export function writeEnvironmentsStrict(layoutId: string | undefined, values: readonly StoredEnvironment[], capability: LocalWriteCapability, options?: {expectedRaw: string | null}): EnvironmentStrictWriteResult {
  return strictEnvironmentUpdate(layoutId,values,capability,options);
}
export function clearEnvironmentStrict(layoutId: string | undefined, capability: LocalWriteCapability, options?: {expectedRaw: string | null}): EnvironmentStrictWriteResult {
  return strictEnvironmentUpdate(layoutId,null,capability,options);
}


/** Explicit scopes prevent a real project named `draft` from aliasing anonymous draft data. */
export type EnvironmentScope = { kind: 'draft' } | { kind: 'project'; id: string };
export interface EnvironmentReadSnapshot {
  scope: EnvironmentScope; key: string; raw: string | null; present: boolean; value: EnvironmentChoice;
}
export type EnvironmentStrictReadResult = { ok: true; snapshot: EnvironmentReadSnapshot } | { ok: false; reason: 'lease-invalid' | 'invalid-scope' | 'invalid-data' | 'blocked' | 'quota' | 'unknown' };

export function environmentScopeKey(scope: EnvironmentScope): string | null {
  if (!scope || typeof scope !== 'object') return null;
  if (scope.kind === 'draft' && Object.keys(scope).length === 1) return 'draft';
  if (scope.kind === 'project' && Object.keys(scope).length === 2 && typeof scope.id === 'string' && scope.id.trim() && scope.id.length <= 128 && scope.id !== 'draft') return scope.id;
  return null;
}

/** No fallback to empty or default on parse, storage, scope or lease failure. */
export function readEnvironmentsStrict(scope: EnvironmentScope, capability: LocalWriteCapability): EnvironmentStrictReadResult {
  const key=environmentScopeKey(scope);
  if (key===null) return {ok:false,reason:'invalid-scope'};
  let guard: ReturnType<typeof localWriteCapabilityGuard>;
  try { guard=localWriteCapabilityGuard(capability); } catch { return {ok:false,reason:'lease-invalid'}; }
  class LeaseFailure extends Error {}
  const check=()=>{try{guard.assertStillHeld();if(guard.signal.aborted)throw new Error();}catch{throw new LeaseFailure();}};
  try {
    check();
    if(typeof window==='undefined'||!window.localStorage)return {ok:false,reason:'blocked'};
    const raw=window.localStorage.getItem(STORAGE_KEY);
    check();
    let parsed:unknown;
    try {parsed=raw===null?{}:JSON.parse(raw);} catch {return {ok:false,reason:'invalid-data'};}
    if(!parsed || typeof parsed!=='object' || Array.isArray(parsed))return {ok:false,reason:'invalid-data'};
    const map=parsed as Record<string,unknown>;
    try {
      if (Object.keys(map).length>MAX_ENTRIES || !sameRecoveryFormValue(map,map) || !Object.values(map).every(value=>value===null || isStoredEnvironment(value) || isEnvironmentList(value))) return {ok:false,reason:'invalid-data'};
    } catch {return {ok:false,reason:'invalid-data'};}
    const present=Object.hasOwn(map,key),value=present ? map[key] as EnvironmentChoice : null;
    check();
    return {ok:true,snapshot:{scope:structuredClone(scope),key,raw,present,value:structuredClone(value)}};
  } catch(error) {
    if(error instanceof LeaseFailure)return {ok:false,reason:'lease-invalid'};
    return {ok:false,reason:classifyStorageError(error)};
  }
}
