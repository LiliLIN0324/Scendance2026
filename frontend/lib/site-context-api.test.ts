import { it, expect, vi } from "vitest";
import {
  handleSiteContext,
  siteWgsCenter,
} from "../../functions/api/site-context";
import { wgs84ToGcj02 } from "../../functions/api/geo-gcj";
it("GCJ中心有界反变换到WGS，查询建筑/道路/门/障碍与multipolygon成员证据", async () => {
  const center = { lng: 120.166, lat: 30.255 };
  let query = "";
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    query = decodeURIComponent(String(init?.body).slice(5));
    return new Response(
      JSON.stringify({
        elements: [
          {
            type: "node",
            id: 1,
            lon: 120.16,
            lat: 30.25,
            tags: { entrance: "yes" },
          },
        ],
      }),
    );
  });
  const res = await handleSiteContext(
    new Request(
      `https://example.test/api/site-context?lng=${center.lng}&lat=${center.lat}&radius=300`,
    ),
    fetcher as typeof fetch,
  );
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toMatchObject({
    schemaVersion: 1,
    crs: "wgs84",
    complete: true,
  });
  const back = wgs84ToGcj02(
    siteWgsCenter(center.lng, center.lat).lng,
    siteWgsCenter(center.lng, center.lat).lat,
  );
  expect(back.lng).toBeCloseTo(center.lng, 6);
  expect(back.lat).toBeCloseTo(center.lat, 6);
  expect(query).toContain('way["building"]');
  expect(query).toContain('node["entrance"]');
  expect(query).toContain('relation["type"="multipolygon"]');
  expect(query).toContain("out geom 301");
});
it("拒绝无效坐标/超750m范围，不向上游发送无界查询", async () => {
  const fetcher = vi.fn();
  for (const query of [
    "lng=120&lat=30&radius=751",
    "lng=NaN&lat=30",
    "lat=30",
    "lng=120&lat=90",
  ]) {
    const res = await handleSiteContext(
      new Request(`https://example.test/api/site-context?${query}`),
      fetcher,
    );
    expect(res.status).toBe(400);
  }
  expect(fetcher).not.toHaveBeenCalled();
});
it("上游失败真实unknown/no-store，不返回伪地图或完整覆盖", async () => {
  const fetcher = vi.fn(async () => new Response("", { status: 503 }));
  const res = await handleSiteContext(
    new Request("https://example.test/api/site-context?lng=120&lat=30"),
    fetcher as typeof fetch,
  );
  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({ elements: [], complete: false });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("内容大小和元素上限均受限；截断不能说complete", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          elements: Array.from({ length: 302 }, (_, id) => ({
            type: "node",
            id,
          })),
        }),
      ),
  );
  const res = await handleSiteContext(
    new Request("https://example.test/api/site-context?lng=120&lat=30"),
    fetcher as typeof fetch,
  );
  const body = await res.json();
  expect(body.elements).toHaveLength(300);
  expect(body.complete).toBe(false);
  expect(body.warnings).toContain("element_limit_reached");
});
it("取消请求不读取数据/不尝试其他服务", async () => {
  const c = new AbortController();
  c.abort();
  const fetcher = vi.fn();
  const res = await handleSiteContext(
    new Request("https://example.test/api/site-context?lng=120&lat=30", {
      signal: c.signal,
    }),
    fetcher,
  );
  expect(res.status).toBe(499);
  expect(fetcher).not.toHaveBeenCalled();
});
