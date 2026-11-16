import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOfmEvidence } from "./openfreemap-evidence";
import { fetchOpenFreeMapRoads } from "./openfreemap-roads";
import { fetchOpenFreeMapBuildings } from "./openfreemap-buildings";
import type { RoadSegment } from "./road-network";
import { gcj02ToWgs84 } from "./geo-coords";

vi.mock("./openfreemap-roads", () => ({ fetchOpenFreeMapRoads: vi.fn() }));
vi.mock("./openfreemap-buildings", () => ({
  fetchOpenFreeMapBuildings: vi.fn(),
}));

const mockRoads = vi.mocked(fetchOpenFreeMapRoads);
const mockBuildings = vi.mocked(fetchOpenFreeMapBuildings);
const anchor = { lng: 120.16, lat: 30.25 };
// 建筑环是 WGS84 基准：先把 GCJ anchor 反算成 WGS，再在邻近布点，避免 GCJ/WGS 偏移把要素滤出半径。
const wgs = gcj02ToWgs84(anchor.lng, anchor.lat);
const buildingRing = [
  {
    id: "ofm:14/13472/6390/0",
    name: "某商场",
    lngLat: [
      [wgs.lng, wgs.lat],
      [wgs.lng + 0.0005, wgs.lat],
      [wgs.lng + 0.0005, wgs.lat + 0.0005],
      [wgs.lng, wgs.lat + 0.0005],
    ] as [number, number][],
  },
];

beforeEach(() => {
  mockRoads.mockReset();
  mockBuildings.mockReset();
});

const road = (over: Partial<RoadSegment> = {}): RoadSegment => ({
  id: "ofm:14/13472/6390/1",
  highway: "footway",
  name: "湖滨步道",
  points: [
    [120.16, 30.25],
    [120.161, 30.251],
  ],
  ...over,
});

describe("fetchOfmEvidence（OpenFreeMap 客户端证据，函数后手兜底）", () => {
  it("道路折线与建筑环转 ENU 特征，scope 对齐 anchor、partial 不宣称完整", async () => {
    mockRoads.mockResolvedValue([road()]);
    mockBuildings.mockResolvedValue(buildingRing);
    const result = await fetchOfmEvidence(anchor, 400);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("partial");
    expect(result!.complete).toBe(false);
    expect(result!.scope).toEqual({ anchor, radiusM: 400, crs: "gcj-02" });
    const r = result!.features.find((f) => f.kind === "road");
    const b = result!.features.find((f) => f.kind === "building");
    expect(r!.id).toBe("ofm:road/ofm:14/13472/6390/1");
    expect(r!.tags.highway).toBe("footway");
    expect(r!.geometry.type).toBe("line");
    expect(b!.id).toBe("ofm:building/ofm:14/13472/6390/0");
    expect(b!.geometry.type).toBe("polygon");
    expect(b!.geometry.points.length).toBe(4); // 不闭合环原样保留，首尾重合才去尾点
  });

  it("两个源都为空时返回 null，交由调用方退服务端兜底", async () => {
    mockRoads.mockResolvedValue([]);
    mockBuildings.mockResolvedValue([]);
    expect(await fetchOfmEvidence(anchor, 400)).toBeNull();
  });

  it("一个源失败不拖累另一个源（allSettled）", async () => {
    mockRoads.mockRejectedValue(new Error("tile offline"));
    mockBuildings.mockResolvedValue(buildingRing);
    const result = await fetchOfmEvidence(anchor, 400);
    expect(result).not.toBeNull();
    expect(result!.features.every((f) => f.kind === "building")).toBe(true);
  });

  it("退化几何（单点道路、不足三角的环）被丢弃", async () => {
    mockRoads.mockResolvedValue([road({ points: [[120.16, 30.25]] })]);
    mockBuildings.mockResolvedValue([
      {
        id: "ofm:14/13472/6390/0",
        name: "",
        lngLat: [
          [120.16, 30.25],
          [120.1605, 30.25],
        ],
      },
    ]);
    expect(await fetchOfmEvidence(anchor, 400)).toBeNull();
  });
});
