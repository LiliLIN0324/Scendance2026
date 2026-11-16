import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MapEvidenceResult } from "@/lib/site-intelligence/types";
import { createStarterOutdoorPlan } from "./outdoor-project-store";
import type { SitePlanData } from "../../../../supabase/functions/_shared/site-plan";

const fetchOfmEvidence = vi.hoisted(() => vi.fn());

vi.mock("./openfreemap-evidence", () => ({
  fetchOfmEvidence,
}));

import { createOutdoorMapContext } from "./outdoor-map-context";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

let plan: SitePlanData;

function semanticPayload() {
  return JSON.stringify({
    schemaVersion: 1,
    crs: "wgs84",
    complete: false,
    warnings: [],
    elements: [],
  });
}

function loadPlan(
  adapter: ReturnType<typeof createOutdoorMapContext>,
  source: SitePlanData = plan,
  signal: AbortSignal = new AbortController().signal,
  projectId = "p",
) {
  return adapter.load(projectId, source, [], true, signal);
}

function evidenceFor(source: SitePlanData): MapEvidenceResult {
  const anchor = source.anchor!;
  return {
    status: "partial",
    features: [
      {
        id: "ofm:road/1",
        kind: "road",
        name: "测试路",
        geometry: {
          type: "line",
          points: [
            { x: -10, y: 0 },
            { x: 10, y: 0 },
          ],
        },
        tags: { highway: "footway" },
        evidence: {
          source: "osm",
          sourceId: "ofm:road/1",
          certainty: "mapped",
          note: "test",
        },
      },
    ],
    warnings: [],
    complete: false,
    fetchedAt: new Date().toISOString(),
    // 必须与 plan.anchor 对齐，否则快照会拒绝证据，status 变成 unavailable。
    scope: {
      anchor: { lng: anchor.lng, lat: anchor.lat },
      radiusM: 200,
      crs: "gcj-02",
    },
  };
}

beforeEach(() => {
  fetchOfmEvidence.mockReset();
  plan = {
    ...createStarterOutdoorPlan(),
    boundary: [
      { x: -40, y: -35 },
      { x: 40, y: -35 },
      { x: 40, y: 35 },
      { x: -40, y: 35 },
    ],
    zones: [],
    facilities: [],
  };
});

afterEach(() => vi.unstubAllGlobals());

describe("outdoor-map-context 共享证据 inflight 合并", () => {
  it("并发 load 只调用一次 fetchOfmEvidence", async () => {
    const pending = deferred<MapEvidenceResult | null>();
    fetchOfmEvidence.mockReturnValueOnce(pending.promise);

    const adapter = createOutdoorMapContext();
    const a = adapter.load("p", plan, [], true, new AbortController().signal);
    const b = adapter.load(
      "p",
      plan,
      ["not-in-key"],
      false,
      new AbortController().signal,
    );
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(1);
    expect(fetchOfmEvidence.mock.calls[0]?.[0]).toMatchObject({
      lng: plan.anchor!.lng,
      lat: plan.anchor!.lat,
    });
    expect(fetchOfmEvidence.mock.calls[0]?.[1]).toBe(200);
    expect(fetchOfmEvidence.mock.calls[0]?.[2]).toBeUndefined();

    pending.resolve(evidenceFor(plan));
    const [mapA, mapB] = await Promise.all([a, b]);
    expect(mapA.status).toBe("partial");
    expect(mapB.status).toBe("partial");
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(1);
  });

  it("一路 abort 后共享请求仍完成，后续 load 走缓存不再打 OFM", async () => {
    const pending = deferred<MapEvidenceResult | null>();
    fetchOfmEvidence.mockReturnValueOnce(pending.promise);

    const adapter = createOutdoorMapContext();
    const abort = new AbortController();
    const lost = adapter.load("p", plan, [], true, abort.signal);
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(1);

    pending.resolve(evidenceFor(plan));
    abort.abort();
    await expect(lost).rejects.toMatchObject({ name: "AbortError" });

    await expect(
      adapter.load("p", plan, [], true, new AbortController().signal),
    ).resolves.toMatchObject({ status: "partial" });
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(1);
  });

  it("并发一路 abort 一路正常，未 abort 方拿到上下文", async () => {
    const pending = deferred<MapEvidenceResult | null>();
    fetchOfmEvidence.mockReturnValueOnce(pending.promise);

    const adapter = createOutdoorMapContext();
    const abort = new AbortController();
    const lost = adapter.load("p", plan, [], true, abort.signal);
    const kept = adapter.load("p", plan, [], true, new AbortController().signal);
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(1);

    pending.resolve(evidenceFor(plan));
    abort.abort();
    await expect(lost).rejects.toMatchObject({ name: "AbortError" });
    await expect(kept).resolves.toMatchObject({ status: "partial" });
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(1);
    expect(fetchOfmEvidence.mock.calls[0]?.[2]).toBeUndefined();
  });

  it("9 路并发只打一次 OFM，其中 1 路 abort 不毒死其余 8 路", async () => {
    const pending = deferred<MapEvidenceResult | null>();
    fetchOfmEvidence.mockReturnValueOnce(pending.promise);

    const adapter = createOutdoorMapContext();
    const abort = new AbortController();
    const lost = adapter.load("p", plan, [], true, abort.signal);
    const kept = Array.from({ length: 8 }, () =>
      adapter.load("p", plan, [], true, new AbortController().signal),
    );
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(1);
    expect(fetchOfmEvidence.mock.calls[0]).toHaveLength(2);

    abort.abort();
    pending.resolve(evidenceFor(plan));
    const [lostResult, ...rest] = await Promise.allSettled([lost, ...kept]);
    expect(lostResult).toMatchObject({
      status: "rejected",
      reason: { name: "AbortError" },
    });
    expect(rest.every((item) => item.status === "fulfilled")).toBe(true);
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(1);
  });

  it("abort 后调用方立即结束，共享请求完成后下一次 load 走缓存", async () => {
    const pending = deferred<MapEvidenceResult | null>();
    fetchOfmEvidence.mockReturnValueOnce(pending.promise);

    const adapter = createOutdoorMapContext();
    const abort = new AbortController();
    let settled = "";
    const lost = adapter.load("p", plan, [], true, abort.signal).then(
      () => {
        settled = "ok";
      },
      (error: { name?: string }) => {
        settled = error.name ?? "error";
      },
    );
    abort.abort();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(settled).toBe("AbortError");
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(1);
    await lost;

    pending.resolve(evidenceFor(plan));
    await expect(
      adapter.load("p", plan, [], true, new AbortController().signal),
    ).resolves.toMatchObject({ status: "partial" });
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(1);
  });

  it("signal 已 abort 且没有 in-flight 时不发起 OFM", async () => {
    const abort = new AbortController();
    abort.abort();
    const adapter = createOutdoorMapContext();
    await expect(
      adapter.load("p", plan, [], true, abort.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchOfmEvidence).not.toHaveBeenCalled();
  });

  it("已 abort 的一路不挡住随后的正常 load", async () => {
    const pending = deferred<MapEvidenceResult | null>();
    fetchOfmEvidence.mockReturnValueOnce(pending.promise);
    const adapter = createOutdoorMapContext();
    const abort = new AbortController();
    abort.abort();
    const lost = adapter.load("p", plan, [], true, abort.signal);
    expect(fetchOfmEvidence).not.toHaveBeenCalled();
    const kept = adapter.load("p", plan, [], true, new AbortController().signal);
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(1);
    pending.resolve(evidenceFor(plan));
    await expect(lost).rejects.toMatchObject({ name: "AbortError" });
    await expect(kept).resolves.toMatchObject({ status: "partial" });
  });

  it("不同 key 并发不会挤掉同一 key 的 in-flight 合并", async () => {
    const gates = [
      deferred<MapEvidenceResult | null>(),
      deferred<MapEvidenceResult | null>(),
    ];
    let calls = 0;
    fetchOfmEvidence.mockImplementation(() => {
      const gate = gates[calls];
      calls += 1;
      if (!gate) throw new Error("unexpected extra OFM call");
      return gate.promise;
    });

    const adapter = createOutdoorMapContext();
    const a1 = adapter.load("a", plan, [], true, new AbortController().signal);
    const b1 = adapter.load("b", plan, [], true, new AbortController().signal);
    const a2 = adapter.load("a", plan, [], true, new AbortController().signal);
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(2);

    gates[0].resolve(evidenceFor(plan));
    gates[1].resolve(evidenceFor(plan));
    const [ra1, rb1, ra2] = await Promise.all([a1, b1, a2]);
    expect(ra1.status).toBe("partial");
    expect(rb1.status).toBe("partial");
    expect(ra2.status).toBe("partial");
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(2);
  });

  it("OFM 没有结果时，并发 load 只打一次兜底", async () => {
    fetchOfmEvidence.mockResolvedValue(null);
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            crs: "wgs84",
            complete: false,
            warnings: [],
            elements: [],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createOutdoorMapContext();
    const [a, b] = await Promise.all([
      adapter.load("p", plan, [], true, new AbortController().signal),
      adapter.load("p", plan, [], true, new AbortController().signal),
    ]);
    expect(a.status).toBe("partial");
    expect(b.status).toBe("partial");
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("兜底进行中一路 abort，另一路仍拿到结果且兜底只请求一次", async () => {
    fetchOfmEvidence.mockResolvedValue(null);
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createOutdoorMapContext();
    const abort = new AbortController();
    const lost = adapter.load("p", plan, [], true, abort.signal);
    const kept = adapter.load("p", plan, [], true, new AbortController().signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[1]?.signal).not.toBe(abort.signal);

    abort.abort();
    resolveFetch(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          crs: "wgs84",
          complete: false,
          warnings: [],
          elements: [],
        }),
      ),
    );
    await expect(lost).rejects.toMatchObject({ name: "AbortError" });
    await expect(kept).resolves.toMatchObject({ status: "partial" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("已 abort 的另一个 key 不会打断进行中的兜底", async () => {
    fetchOfmEvidence.mockResolvedValue(null);
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createOutdoorMapContext();
    const kept = adapter.load("live", plan, [], true, new AbortController().signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const abort = new AbortController();
    abort.abort();
    const lost = adapter.load("dead", plan, [], true, abort.signal);
    await expect(lost).rejects.toMatchObject({ name: "AbortError" });

    resolveFetch(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          crs: "wgs84",
          complete: false,
          warnings: [],
          elements: [],
        }),
      ),
    );
    await expect(kept).resolves.toMatchObject({ status: "partial" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("共享 OFM 尚未返回时，已取消的一路不会让后来者另起一次请求", async () => {
    const pending = deferred<MapEvidenceResult | null>();
    fetchOfmEvidence.mockReturnValueOnce(pending.promise);
    const adapter = createOutdoorMapContext();
    const abort = new AbortController();
    const lost = loadPlan(adapter, plan, abort.signal);
    abort.abort();
    await expect(lost).rejects.toMatchObject({ name: "AbortError" });

    const kept = loadPlan(adapter);
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(1);
    pending.resolve(evidenceFor(plan));
    await expect(kept).resolves.toMatchObject({ status: "partial" });
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(1);
  });

  it("兜底已经发出后，同版本后来者只加入共享请求，不会把兜底打断", async () => {
    fetchOfmEvidence.mockResolvedValue(null);
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn(
      (_input?: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createOutdoorMapContext();
    const first = loadPlan(adapter);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const sharedSignal = fetchMock.mock.calls[0]?.[1]?.signal;
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(sharedSignal).toBeInstanceOf(AbortSignal);
    expect(url).toContain("/api/site-context?");
    expect(url).toContain("radius=200");
    expect(url).toContain(`lng=${plan.anchor!.lng}`);

    const lateAbort = new AbortController();
    const second = adapter.load("p", plan, ["late"], false, lateAbort.signal);
    await Promise.resolve();
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sharedSignal?.aborted).toBe(false);

    lateAbort.abort();
    expect(sharedSignal?.aborted).toBe(false);
    resolveFetch(new Response(semanticPayload()));
    await expect(first).resolves.toMatchObject({ status: "partial" });
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetchOfmEvidence 抛错时，并发 load 只打一次兜底", async () => {
    fetchOfmEvidence.mockRejectedValue(new Error("ofm down"));
    const fetchMock = vi.fn(async () => new Response(semanticPayload()));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createOutdoorMapContext();
    const [a, b] = await Promise.all([loadPlan(adapter), loadPlan(adapter)]);
    expect(a.status).toBe("partial");
    expect(b.status).toBe("partial");
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("共享结果为 stale 或 cancelled 时两路都取消，并且不写入缓存", async () => {
    const adapter = createOutdoorMapContext();
    for (const status of ["stale", "cancelled"] as const) {
      const pending = deferred<MapEvidenceResult | null>();
      fetchOfmEvidence.mockReturnValueOnce(pending.promise);
      const first = loadPlan(adapter);
      const second = loadPlan(adapter);
      expect(fetchOfmEvidence).toHaveBeenCalledTimes(status === "stale" ? 1 : 2);
      pending.resolve({ ...evidenceFor(plan), status });
      await expect(first).rejects.toMatchObject({ name: "AbortError" });
      await expect(second).rejects.toMatchObject({ name: "AbortError" });
    }
    fetchOfmEvidence.mockResolvedValueOnce(evidenceFor(plan));
    await expect(loadPlan(adapter)).resolves.toMatchObject({ status: "partial" });
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(3);
  });

  it("failed 证据不进缓存，下一次 load 会再打 OFM", async () => {
    fetchOfmEvidence
      .mockResolvedValueOnce({
        ...evidenceFor(plan),
        status: "failed",
        features: [],
      })
      .mockResolvedValueOnce(evidenceFor(plan));
    const adapter = createOutdoorMapContext();
    await expect(loadPlan(adapter)).resolves.toMatchObject({
      status: "unavailable",
    });
    await expect(loadPlan(adapter)).resolves.toMatchObject({ status: "partial" });
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(2);
  });

  it("兜底失败后 in-flight 会清掉，下一次 load 重新打 OFM", async () => {
    fetchOfmEvidence
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(evidenceFor(plan));
    const fetchMock = vi.fn(async () => new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createOutdoorMapContext();
    await expect(loadPlan(adapter)).resolves.toMatchObject({
      status: "unavailable",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(loadPlan(adapter)).resolves.toMatchObject({ status: "partial" });
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("同一边界缓存未满 60 秒不重复打 OFM，满 60 秒会再打", async () => {
    const now = vi.spyOn(Date, "now");
    try {
      const start = 1_700_000_000_000;
      now.mockReturnValue(start);
      fetchOfmEvidence.mockResolvedValue(evidenceFor(plan));
      const adapter = createOutdoorMapContext();
      await expect(loadPlan(adapter)).resolves.toMatchObject({ status: "partial" });
      now.mockReturnValue(start + 59_999);
      await expect(loadPlan(adapter)).resolves.toMatchObject({ status: "partial" });
      expect(fetchOfmEvidence).toHaveBeenCalledTimes(1);
      now.mockReturnValue(start + 60_000);
      await expect(loadPlan(adapter)).resolves.toMatchObject({ status: "partial" });
      expect(fetchOfmEvidence).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });

  it("ready 证据写入缓存后，再来 9 路并发也不会打 OFM", async () => {
    fetchOfmEvidence.mockResolvedValue({
      ...evidenceFor(plan),
      status: "ready",
      complete: true,
    });
    const adapter = createOutdoorMapContext();
    await expect(loadPlan(adapter)).resolves.toMatchObject({ status: "ready" });
    await Promise.all(Array.from({ length: 9 }, () => loadPlan(adapter)));
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(1);
  });

  it("方案内容变了但边界没变：进行中不合并，完成后走边界缓存", async () => {
    const gates = [
      deferred<MapEvidenceResult | null>(),
      deferred<MapEvidenceResult | null>(),
    ];
    let calls = 0;
    fetchOfmEvidence.mockImplementation(() => {
      const gate = gates[calls];
      calls += 1;
      if (!gate) throw new Error("unexpected extra OFM call");
      return gate.promise;
    });
    const revised: SitePlanData = { ...plan, measurements: [] };
    const adapter = createOutdoorMapContext();
    const first = loadPlan(adapter, plan);
    const second = loadPlan(adapter, revised);
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(2);

    gates[0]!.resolve(evidenceFor(plan));
    gates[1]!.resolve(evidenceFor(revised));
    await expect(first).resolves.toMatchObject({ status: "partial" });
    await expect(second).resolves.toMatchObject({ status: "partial" });

    const unseen: SitePlanData = { ...plan, buildings: [] };
    await expect(loadPlan(adapter, unseen)).resolves.toMatchObject({
      status: "partial",
    });
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(2);
  });

  it("边界一变就错过缓存，重新打 OFM", async () => {
    fetchOfmEvidence.mockResolvedValue(evidenceFor(plan));
    const adapter = createOutdoorMapContext();
    await loadPlan(adapter);
    const moved: SitePlanData = {
      ...plan,
      boundary: plan.boundary.map((point) => ({ x: point.x + 3, y: point.y })),
    };
    await expect(loadPlan(adapter, moved)).resolves.toMatchObject({
      status: "partial",
    });
    expect(fetchOfmEvidence).toHaveBeenCalledTimes(2);
  });
});