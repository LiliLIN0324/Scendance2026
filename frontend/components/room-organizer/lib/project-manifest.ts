/**
 * 完整项目依赖清单与发布闸门（任务 B / C06）。
 *
 * 主计划 §3.7：「云端已保存」必须有服务器确认的版本和依赖完整性证据；
 * §5.2：原文件/依赖未归档完不显示「完整云端已保存」，也不能发布一个引用
 * 本机代理、blob URL 或已过期签名地址的案例。
 *
 * 这里的清单只登记「服务器上真实存在的资产 ID」：asset-cloud 已确认的映射、
 * 归档队列的上传回执、以及资料图经 uploadSource 拿到的 assetId。拿不到云端
 * ID 的一律进 gaps，绝不编造云端资产 ID（frontend/AGENTS.md 红线）。
 *
 * `registerPublishGateProvider` 是给任务 C（share-menu 发布链）的接入口：
 * room-organizer 注册当前项目的真实清单快照，C 在发布前消费；接口未接通时
 * 快照明确不可用，不声称可发布。
 */

import type { Scene } from '../../../../supabase/functions/_shared/domain';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type { StoredSource } from '@/lib/source-storage';
import { findAholoAsset } from './aholo-assets';
import { localAssetIdsInLayout } from './asset-cloud';
import type { RoomLayout } from './types';

export type ManifestDependencyKind = 'model' | 'scan' | 'source' | 'attachment';

/** 线上 wire 形状：A 的 completeManifestSchema 对依赖项是 strictObject，只收 assetId + visibility。 */
export interface ManifestDependency {
  assetId: string;
  visibility: 'private' | 'published';
}

export interface ManifestGap {
  localId: string;
  kind: ManifestDependencyKind;
  name: string;
  reason: 'not-uploaded' | 'no-cloud-id';
}

/** 与 A 契约 saveCompleteProject 的 manifest 形状对齐（scene/outdoor/sources/dependencies 严格透传）。 */
export interface CompleteProjectManifest {
  version: 1;
  scene: Scene | null;
  outdoor: SitePlanData | null;
  /** sources 是按资料 id 索引的登记表（A 契约 z.record），不含字节，不外发私有内容。 */
  sources: Record<string, Record<string, unknown>>;
  dependencies: ManifestDependency[];
}

export interface ManifestBuildInput {
  layout: RoomLayout;
  /** layoutToBackendScene 的产物；适配失败时传 null，场景依赖照常清点，缺口如实列出。 */
  scene: Scene | null;
  outdoorPlan: SitePlanData | null;
  sources: StoredSource[];
  /** asset-cloud 的 localAssetId → cloudAssetId（仅 uploaded 记录）。 */
  cloudAssetIds: Record<string, string>;
  /** 归档队列的 localId → 云端资产 ID（uploaded 任务的回执）。 */
  archiveAssetIds?: Record<string, string>;
  visibility?: 'private' | 'published';
}

export interface ManifestBuildResult {
  manifest: CompleteProjectManifest;
  gaps: ManifestGap[];
  /** gaps 为空才算「依赖已全部归档」，才能谈完整云端保存与发布。 */
  complete: boolean;
}

function scanReferencesInLayout(layout: RoomLayout): Array<{ localId: string; name: string }> {
  const refs: Array<{ localId: string; name: string }> = [];
  if (layout.venueScan?.assetId) refs.push({ localId: layout.venueScan.assetId, name: layout.venueScan.name || '当前实景扫描' });
  if (layout.researchArea?.scanAssetId) refs.push({ localId: layout.researchArea.scanAssetId, name: '调研底图对应扫描' });
  return refs;
}

export function buildCompleteManifest(input: ManifestBuildInput): ManifestBuildResult {
  const visibility = input.visibility ?? 'private';
  const dependencies: ManifestDependency[] = [];
  const gaps: ManifestGap[] = [];
  const archiveAssetIds = input.archiveAssetIds ?? {};
  const seenAssets = new Set<string>();

  const register = (localId: string, kind: ManifestDependencyKind, name: string): void => {
    const cloudId = input.cloudAssetIds[localId] ?? archiveAssetIds[localId];
    if (cloudId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cloudId)) {
      if (seenAssets.has(cloudId)) return;
      seenAssets.add(cloudId);
      dependencies.push({ assetId: cloudId, visibility });
      return;
    }
    gaps.push({ localId, kind, name, reason: cloudId ? 'no-cloud-id' : 'not-uploaded' });
  };

  for (const localId of localAssetIdsInLayout(input.layout)) {
    register(localId, 'model', findAholoAsset(localId)?.name ?? localId);
  }
  for (const scan of scanReferencesInLayout(input.layout)) {
    register(scan.localId, 'scan', scan.name);
  }
  const sources: CompleteProjectManifest['sources'] = {};
  for (const source of input.sources) {
    if (source.assetId) {
      if (!seenAssets.has(source.assetId)) {
        seenAssets.add(source.assetId);
        dependencies.push({ assetId: source.assetId, visibility: 'private' });
      }
      sources[source.id] = { name: source.name, kind: source.kind, assetId: source.assetId, width: source.width, height: source.height };
    } else {
      // 资料图只有本机 blob、从未上传：登记缺口，不假装私有资料已在云端。
      gaps.push({ localId: source.id, kind: 'source', name: source.name, reason: 'not-uploaded' });
      sources[source.id] = { name: source.name, kind: source.kind, width: source.width, height: source.height };
    }
  }

  const manifest: CompleteProjectManifest = {
    version: 1,
    scene: input.scene,
    outdoor: input.outdoorPlan ?? null,
    sources,
    dependencies,
  };
  return { manifest, gaps, complete: gaps.length === 0 };
}

/** 依赖清单一句话（保存状态/发布卡共用）。 */
export function manifestCompletenessLabel(result: ManifestBuildResult): string {
  if (result.complete) return `依赖已全部归档（${result.manifest.dependencies.length} 项）`;
  const byKind = new Map<ManifestDependencyKind, number>();
  for (const gap of result.gaps) byKind.set(gap.kind, (byKind.get(gap.kind) ?? 0) + 1);
  const labels: Record<ManifestDependencyKind, string> = { model: '模型', scan: '扫描', source: '资料', attachment: '附件' };
  const parts = [...byKind.entries()].map(([kind, count]) => `${labels[kind]} ×${count}`);
  return `还有 ${result.gaps.length} 项未归档：${parts.join('、')}`;
}

// ---------------------------------------------------------------------------
// 发布闸门（给任务 C 的接入口；B 的 room-organizer 注册，C 的 share-menu 消费）
// ---------------------------------------------------------------------------

export interface PublishGateSnapshot {
  /** 当前画布对应的 scope（外壳 projectId 正源）。 */
  scopeId: string;
  /** 绑定的云端项目 id；未绑定为 null。 */
  projectId: string | null;
  /** 服务器最近确认的版本（未绑定为 null）。 */
  cloudRevision: number | null;
  manifest: CompleteProjectManifest | null;
  gaps: ManifestGap[];
  /** 依赖是否全部已归档。 */
  complete: boolean;
  /** C 的发布链可以直接使用的判断：完整 + 云端有确认版本 + 无待同步。 */
  readyForPublish: boolean;
  note: string;
  /** 未解决的版本冲突（2026-11-20 集成补充）：冲突未消不解发布。 */
  conflict: { remoteRevision: number; remoteName?: string } | null;
  /**
   * 清单构建时对应的保存版本（2026-11-20 P0-A 接口要求，room-organizer 提供）：
   * provider 读画布与清单时记下当前 revision；发布链用它与落库版本核对，
   * 避免「清单是 A 版、落库/发布是 B 版」。未提供时由服务端 CAS 兼底。
   */
  capturedRevision?: number | null;
}

export type PublishGateProvider = () => Promise<PublishGateSnapshot>;

const unavailableSnapshot: PublishGateSnapshot = {
  scopeId: '',
  projectId: null,
  cloudRevision: null,
  manifest: null,
  gaps: [],
  complete: false,
  readyForPublish: false,
  note: '完整归档状态未接入，不能声称可发布。',
  conflict: null,
  capturedRevision: null,
};

let publishGateProvider: PublishGateProvider | null = null;

/** room-organizer 挂载/卸载时注册；后注册者生效，卸载传 null。 */
export function registerPublishGateProvider(provider: PublishGateProvider | null): void {
  publishGateProvider = provider;
}

/** 发布前的依赖完整性核对。未注册时返回明确不可用的快照，不伪装成「通过」。 */
export async function publishGateSnapshot(): Promise<PublishGateSnapshot> {
  if (!publishGateProvider) return unavailableSnapshot;
  try { return await publishGateProvider(); }
  catch { return { ...unavailableSnapshot, note: '完整归档状态核对失败，不能声称可发布。' }; }
}

/**
 * 发布闸门的消费端判断（2026-11-20 集成接通）：可以发布返回 null，否则返回一句
 * 给用户看的完整原因。这里只拦「依赖未全部归档」与「未解决的版本冲突」——
 * 未保存改动与未上传的本机模型由发布链既有的 dirty 检查负责，避免同一件事两套口径；
 * 快照不可用（provider 未注册/核对失败）按失败处理，不当作通过（fail-closed）。
 */
export function publishGateBlockReason(snapshot: PublishGateSnapshot): string | null {
  if (!snapshot.complete) {
    if (snapshot.gaps.length === 0) return `暂时不能发布：${snapshot.note}`;
    const names = snapshot.gaps.slice(0, 6).map(gap => gap.name).join('、');
    const more = snapshot.gaps.length > 6 ? ` 等 ${snapshot.gaps.length} 项` : '';
    return `还有 ${snapshot.gaps.length} 项依赖未归档，暂不能发布：${names}${more}。请先在账户面板「归档」页补传，本机原件都在。`;
  }
  if (snapshot.conflict) {
    return `存在版本冲突（服务器当前 v${snapshot.conflict.remoteRevision}），先在项目卡或户外提示里选择保留哪一版，再发布。`;
  }
  return null;
}
