import { describe, expect, it, vi } from "vitest";
import type { SitePlanData } from "../../../../supabase/functions/_shared/site-plan";
import type { OutdoorProjectRecord } from "./outdoor-project-store";
import { pullOutdoorPlan, forcePushOutdoorPlan, pushOutdoorPlan } from "./outdoor-plan-sync";

const plan = { anchor: { lng: 120.16, lat: 30.25 } } as unknown as SitePlanData;
const record: OutdoorProjectRecord = {
  v: 1,
  projectId: "local-1",
  name: "湖滨夜集",
  createdAt: "2026-11-17T00:00:00.000Z",
  updatedAt: "2026-11-17T00:00:00.000Z",
  plan,
};

describe("户外活动本体的同步口径", () => {
  it("首次推送不带 activityId/baseRevision，成功后带回后端发号", async () => {
    const saveOutdoorPlan = vi.fn().mockResolvedValue({ conflict: false, activityId: "a-1", revision: 1 });
    const outcome = await pushOutdoorPlan({ saveOutdoorPlan }, record, plan);
    expect(outcome).toEqual({ status: "saved", remoteActivityId: "a-1", remoteRevision: 1 });
    expect(saveOutdoorPlan.mock.calls[0][0]).toMatchObject({ localActivityId: "local-1", name: "湖滨夜集" });
    expect(saveOutdoorPlan.mock.calls[0][0]).not.toHaveProperty("activityId");
  });

  it("已同步过就带 activityId + baseRevision", async () => {
    const saveOutdoorPlan = vi.fn().mockResolvedValue({ conflict: false, activityId: "a-1", revision: 4 });
    await pushOutdoorPlan({ saveOutdoorPlan }, { ...record, remoteActivityId: "a-1", remoteRevision: 3 }, plan);
    expect(saveOutdoorPlan.mock.calls[0][0]).toMatchObject({ activityId: "a-1", baseRevision: 3 });
  });

  it("版本冲突原样上报，不当成保存成功", async () => {
    const saveOutdoorPlan = vi.fn().mockResolvedValue({
      conflict: true,
      activityId: "a-1",
      revision: 7,
      updatedAt: "2026-11-17T02:00:00.000Z",
      name: "另一台设备的版本",
    });
    await expect(
      pushOutdoorPlan({ saveOutdoorPlan }, { ...record, remoteActivityId: "a-1", remoteRevision: 5 }, plan),
    ).resolves.toEqual({ status: "conflict", remoteRevision: 7, remoteName: "另一台设备的版本" });
  });

  it("未登录 / 没有方案 / 网络失败都收敛成 skipped，不抛错", async () => {
    expect(await pushOutdoorPlan(null, record, plan)).toEqual({ status: "skipped", reason: "no-session" });
    const saveOutdoorPlan = vi.fn();
    expect(await pushOutdoorPlan({ saveOutdoorPlan }, record, null)).toEqual({ status: "skipped", reason: "no-plan" });
    saveOutdoorPlan.mockRejectedValueOnce(new Error("offline"));
    expect(await pushOutdoorPlan({ saveOutdoorPlan }, record, plan)).toEqual({ status: "skipped", reason: "failed" });
  });

  it("选「用我这版」时带 force，且不再带 baseRevision", async () => {
    const saveOutdoorPlan = vi.fn().mockResolvedValue({ conflict: false, activityId: "a-1", revision: 8 });
    const outcome = await forcePushOutdoorPlan(
      { saveOutdoorPlan },
      { ...record, remoteActivityId: "a-1", remoteRevision: 5 },
      plan,
    );
    expect(outcome).toEqual({ status: "saved", remoteActivityId: "a-1", remoteRevision: 8 });
    const body = saveOutdoorPlan.mock.calls[0][0];
    expect(body).toMatchObject({ activityId: "a-1", force: true });
    expect(body).not.toHaveProperty("baseRevision");
  });

  it("读回后端版本：找不到或失败都返回 null", async () => {
    expect(await pullOutdoorPlan(null, "a-1")).toBeNull();
    expect(await pullOutdoorPlan({ getOutdoorPlan: vi.fn().mockResolvedValue({ found: false }) }, "a-1")).toBeNull();
    expect(
      await pullOutdoorPlan({ getOutdoorPlan: vi.fn().mockRejectedValue(new Error("offline")) }, "a-1"),
    ).toBeNull();
    const found = await pullOutdoorPlan(
      { getOutdoorPlan: vi.fn().mockResolvedValue({ found: true, name: "夜集", revision: 3, plan }) },
      "a-1",
    );
    expect(found).toMatchObject({ name: "夜集", revision: 3 });
  });
});
