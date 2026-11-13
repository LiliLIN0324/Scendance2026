import type { BackendSession } from "@/lib/backend-session";
import { validAssetSize, type CloudAsset } from "@/lib/assets-api";
import { listAholoAssets, aholoAssetUrl } from "./aholo-assets";
import { registerGeneratedFacilityModel } from "./facility-generated-models";
import {
  ensureGlbAsset,
  getGlbAssetState,
  listImportedGlbAssets,
} from "../three/glb-assets";
import type { OutdoorLibraryItem } from "./outdoor-agent-contract";

/** Existing authenticated GET /assets used by My Materials; never a fabricated catalogue. */
export async function readOutdoorPersonalLibrary(
  controller: BackendSession | null,
  projectId: string,
  queries: string[],
  signal: AbortSignal,
): Promise<OutdoorLibraryItem[]> {
  const matches = (name: string, id?: string) =>
    queries.some(
      (q) => name.toLowerCase().includes(q.toLowerCase()) || id === q,
    );
  const records: Array<{
    id: string;
    name: string;
    url?: string;
    localKey?: string;
    size?: { width: number; depth: number; height: number };
  }> = [];
  let cloudUnavailable = false;
  if (controller) {
    let assets: CloudAsset[] = [];
    try {
      assets = await controller.businessRequest<CloudAsset[]>("/assets");
    } catch {
      cloudUnavailable = true;
    }
    if (!Array.isArray(assets))
      throw new Error("我的物料库返回格式无法核对，未替换成假候选。");
    for (const asset of assets
      .filter((a) => a.format === "glb" && matches(a.name, a.id))
      .slice(0, 20)) {
      if (signal.aborted) return [];
      const authorized = await controller.authorizeAsset(asset.id);
      records.push({
        id: asset.id,
        name: asset.name,
        url: authorized.url,
        ...(asset.metadata?.sourceSize
          ? { size: asset.metadata.sourceSize }
          : {}),
      });
    }
  }
  for (const asset of listAholoAssets()
    .filter((a) => a.kind === "glb" && matches(a.name, a.assetId))
    .slice(0, 20)) {
    const url = aholoAssetUrl(asset);
    if (url)
      records.push({
        id: asset.assetId,
        name: asset.name,
        url,
        ...(asset.meters ? { size: asset.meters } : {}),
      });
  }
  for (const asset of listImportedGlbAssets().filter((a) =>
    matches(a.name, a.key),
  ))
    records.push({
      id: asset.key,
      name: asset.name,
      url: asset.key,
      localKey: asset.key,
    });
  const result: OutdoorLibraryItem[] = [];
  for (const asset of records) {
    if (signal.aborted) return [];
    if (!asset.url) continue;
    if (!asset.localKey)
      await ensureGlbAsset(`outdoor-library:${asset.id}`, asset.url);
    if (signal.aborted) return [];
    const state = getGlbAssetState(
      asset.localKey ?? `outdoor-library:${asset.id}`,
    );
    if (state?.status !== "ready" || !state.dimensions) continue;
    const size =
      asset.size && validAssetSize(asset.size) ? asset.size : state.dimensions;
    if (!validAssetSize(size)) continue;
    const modelSlug = asset.localKey
      ? `generated:${asset.localKey}`
      : `generated:library-${asset.id}`;
    registerGeneratedFacilityModel({
      projectId,
      slug: modelSlug,
      name: asset.name,
      glbUrl: asset.url,
      ...size,
      facilityId: `library-${asset.id}`,
      facilityName: asset.name,
      createdAt: Date.now(),
      sessionOnly: true,
    });
    result.push({
      id: asset.id,
      name: asset.name,
      source: "personal",
      ...size,
      modelSlug,
      available: true,
    });
  }
  if (cloudUnavailable && !result.length)
    throw new Error(
      "云端个人库尚不可读，请登录原账户后重试；也可在本卡导入GLB在本机预览，不上传不收费。",
    );
  return result;
}

/** Reauthorize stable ownership IDs after refresh; signed URLs never enter SitePlanData/localStorage. */
export async function restoreOutdoorLibraryModels(
  controller: BackendSession | null,
  projectId: string,
  plan: import("../../../../supabase/functions/_shared/site-plan").SitePlanData,
  signal: AbortSignal,
): Promise<void> {
  if (!controller) return;
  for (const f of plan.facilities.filter(
    (f) => f.sourceAssetId && f.modelOverride?.startsWith("generated:library-"),
  )) {
    if (signal.aborted) return;
    const authorized = await controller.authorizeAsset(f.sourceAssetId!);
    if (signal.aborted) return;
    await ensureGlbAsset(`outdoor-library:${f.sourceAssetId}`, authorized.url);
    if (signal.aborted) return;
    const state = getGlbAssetState(`outdoor-library:${f.sourceAssetId}`);
    if (state?.status !== "ready" || !state.dimensions) continue;
    registerGeneratedFacilityModel({
      projectId,
      slug: f.modelOverride!,
      name: f.name,
      glbUrl: authorized.url,
      ...state.dimensions,
      facilityId: f.id,
      facilityName: f.name,
      createdAt: Date.now(),
      sessionOnly: true,
    });
  }
}
