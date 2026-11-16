import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OFM_TILEJSON_URL,
  loadOfmTileSource,
  resetOfmTileSourceForTests,
} from "./openfreemap-tiles";

const TILEJSON = {
  tiles: ["https://tiles.openfreemap.org/planet/2025_pt/{z}/{x}/{y}.pbf"],
  maxzoom: 14,
};

const expectedSource = {
  template: TILEJSON.tiles[0],
  maxzoom: 14,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("loadOfmTileSource（共享 TileJSON 不被调用方 AbortSignal 毒死）", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetOfmTileSourceForTests();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("首次调用的 AbortSignal 被 abort 后，第二个无 signal 的调用仍能拿到 TileJSON", async () => {
    const pending = deferred<Response>();
    let calls = 0;
    fetchMock.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return pending.promise;
      return Promise.resolve(jsonResponse(TILEJSON));
    });

    const controller = new AbortController();
    const first = loadOfmTileSource(controller.signal);
    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(OFM_TILEJSON_URL);

    controller.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });

    const second = loadOfmTileSource();
    pending.resolve(jsonResponse(TILEJSON));
    await expect(second).resolves.toEqual(expectedSource);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("并发两个调用只发一次 TileJSON fetch", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);

    const a = loadOfmTileSource();
    const b = loadOfmTileSource();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(OFM_TILEJSON_URL);

    pending.resolve(jsonResponse(TILEJSON));
    const [sourceA, sourceB] = await Promise.all([a, b]);
    expect(sourceA).toEqual(expectedSource);
    expect(sourceB).toEqual(expectedSource);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetch 失败后 reset，下次调用会重试", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ tiles: [] }, 503));
    await expect(loadOfmTileSource()).rejects.toThrow(/TileJSON 503/);

    fetchMock.mockResolvedValueOnce(jsonResponse(TILEJSON));
    await expect(loadOfmTileSource()).resolves.toEqual(expectedSource);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("signal 已 abort 时立即 reject，不等待共享结果", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);

    const controller = new AbortController();
    controller.abort();
    await expect(loadOfmTileSource(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const other = loadOfmTileSource();
    pending.resolve(jsonResponse(TILEJSON));
    await expect(other).resolves.toEqual(expectedSource);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("并发一路 abort 一路正常，共享 fetch 仍只一次且未 abort 方拿到结果", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);

    const aborted = new AbortController();
    const lost = loadOfmTileSource(aborted.signal);
    const kept = loadOfmTileSource();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    aborted.abort();
    let settled = "";
    void lost.then(
      () => {
        settled = "ok";
      },
      (error: { name?: string }) => {
        settled = error.name ?? "error";
      },
    );
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(settled).toBe("AbortError");

    pending.resolve(jsonResponse(TILEJSON));
    await expect(kept).resolves.toEqual(expectedSource);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("缓存已就绪时，已 abort 的 signal 立即拒绝且不再 fetch", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(TILEJSON));
    await expect(loadOfmTileSource()).resolves.toEqual(expectedSource);

    const abort = new AbortController();
    abort.abort();
    await expect(loadOfmTileSource(abort.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(loadOfmTileSource()).resolves.toEqual(expectedSource);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("等待中 abort 后共享 fetch 失败会清缓存，下一次调用重试", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);

    const abort = new AbortController();
    const lost = loadOfmTileSource(abort.signal);
    const kept = loadOfmTileSource();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    abort.abort();
    pending.reject(new Error("network down"));
    await expect(lost).rejects.toMatchObject({ name: "AbortError" });
    await expect(kept).rejects.toThrow(/network down/);

    fetchMock.mockResolvedValueOnce(jsonResponse(TILEJSON));
    await expect(loadOfmTileSource()).resolves.toEqual(expectedSource);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toBeUndefined();
  });
});