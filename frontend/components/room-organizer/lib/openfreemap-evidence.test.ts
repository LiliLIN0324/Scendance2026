import { beforeEach, describe, expect, it, vi } from "vitest";
import { gcj02ToWgs84 } from "./geo-coords";
import { fetchOfmEvidence } from "./openfreemap-evidence";
import { fetchOpenFreeMapBuildings } from "./openfreemap-buildings";
import { fetchOpenFreeMapParks } from "./openfreemap-parks";
import { fetchOpenFreeMapRoads } from "./openfreemap-roads";
import { fetchOpenFreeMapWater } from "./openfreemap-water";
import type { RoadSegment } from "./road-network";

vi.mock("./openfreemap-roads", () => ({ fetchOpenFreeMapRoads: vi.fn() }));
vi.mock("./openfreemap-buildings", () => ({
  fetchOpenFreeMapBuildings: vi.fn(),
}));
vi.mock("./openfreemap-water", () => ({ fetchOpenFreeMapWater: vi.fn() }));
vi.mock("./openfreemap-parks", () => ({ fetchOpenFreeMapParks: vi.fn() }));

const mockRoads = vi.mocked(fetchOpenFreeMapRoads);
const mockBuildings = vi.mocked(fetchOpenFreeMapBuildings);
const mockWater = vi.mocked(fetchOpenFreeMapWater);
const mockParks = vi.mocked(fetchOpenFreeMapParks);
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
  mockWater.mockReset();
  mockParks.mockReset();
  mockWater.mockResolvedValue([]);
  mockParks.mockResolvedValue([]);
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
    mockWater.mockResolvedValue([]);
    mockParks.mockResolvedValue([]);
    expect(await fetchOfmEvidence(anchor, 400)).toBeNull();
  });

  // docs/47 A1：绿地（leisure=park/garden）必须进证据。修前红：planet 只解码了
  // transportation/building/water，park 图层没人消费，湖滨银泰这类场地拿不到绿地。
  it("A1 绿地面→open-space 特征，leisure 标签带出并声明不代表活动授权", async () => {
    mockRoads.mockResolvedValue([]);
    mockBuildings.mockResolvedValue([]);
    mockParks.mockResolvedValue([
      {
        id: "ofm:park/14/13472/6390/3/0",
        name: "湖滨公园",
        parkClass: "park",
        lngLat: [
          [wgs.lng, wgs.lat],
          [wgs.lng + 0.001, wgs.lat],
          [wgs.lng + 0.001, wgs.lat + 0.001],
          [wgs.lng, wgs.lat + 0.001],
          [wgs.lng, wgs.lat],
        ] as [number, number][],
      },
      {
        id: "ofm:park/14/13472/6390/4/0",
        name: "涌金公园",
        parkClass: "garden",
        lngLat: [
          [wgs.lng, wgs.lat],
          [wgs.lng + 0.0008, wgs.lat],
        ] as [number, number][],
      },
    ]);
    const result = await fetchOfmEvidence(anchor, 400);
    expect(result).not.toBeNull();
    const parks = result!.features.filter((f) => f.kind === "open-space");
    expect(parks).toHaveLength(1);
    expect(parks[0]!.id).toBe("ofm:park/14/13472/6390/3/0");
    expect(parks[0]!.name).toBe("湖滨公园");
    expect(parks[0]!.tags.leisure).toBe("park");
    expect(parks[0]!.geometry.type).toBe("polygon");
    expect(parks[0]!.evidence.note).toContain("不代表");
    // 不足三角的环丢弃，不虚称面
    expect(result!.features.some((f) => f.id === "ofm:park/14/13472/6390/4/0")).toBe(false);
  });

  // 2026-11-17「就沿着水岸线」：水体/水道必须真的进快照，否则沿岸排布无参照可绑。
  it("水体面→polygon、水道线→line，并如实带出「不是岸线测量」的证据口径", async () => {
    mockRoads.mockResolvedValue([]);
    mockBuildings.mockResolvedValue([]);
    mockWater.mockResolvedValue([
      {
        id: "ofm:water/14/13472/6390/9/0",
        name: "西湖",
        shape: "area",
        waterClass: "lake",
        lngLat: [
          [wgs.lng, wgs.lat],
          [wgs.lng + 0.002, wgs.lat],
          [wgs.lng + 0.002, wgs.lat + 0.001],
          [wgs.lng, wgs.lat + 0.001],
          [wgs.lng, wgs.lat],
        ] as [number, number][],
      },
      {
        id: "ofm:waterway/14/13472/6390/7/0",
        name: "中河",
        shape: "line",
        waterClass: "river",
        lngLat: [
          [wgs.lng, wgs.lat],
          [wgs.lng + 0.001, wgs.lat + 0.001],
        ] as [number, number][],
      },
    ]);
    const result = await fetchOfmEvidence(anchor, 400);
    expect(result).not.toBeNull();
    const water = result!.features.filter((f) => f.kind === "water");
    expect(water).toHaveLength(2);
    const lake = water.find((f) => f.name === "西湖")!;
    expect(lake.geometry.type).toBe("polygon");
    expect(lake.tags.water).toBe("lake");
    expect(lake.evidence.note).toContain("不是岸线测量");
    const river = water.find((f) => f.name === "中河")!;
    expect(river.geometry.type).toBe("line");
    expect(river.geometry.points.length).toBeGreaterThanOrEqual(2);
  });

  it("瓦片没取到水体时，warnings 明确写「不能凭底图像素推断」", async () => {
    mockRoads.mockResolvedValue([]);
    mockBuildings.mockResolvedValue(buildingRing);
    mockWater.mockResolvedValue([]);
    const result = await fetchOfmEvidence(anchor, 400);
    expect(result!.warnings.join()).toContain("未取到水体");
  });
  it("A1 瓦片没取到绿地时 warnings 如实标注，且 planet 不含停车场/广场也如实说", async () => {
    mockRoads.mockResolvedValue([road()]);
    mockBuildings.mockResolvedValue([]);
    mockWater.mockResolvedValue([]);
    mockParks.mockResolvedValue([]);
    const result = await fetchOfmEvidence(anchor, 400);
    expect(result).not.toBeNull();
    expect(result!.warnings.join()).toContain("未取到公园");
    expect(result!.warnings.join()).toContain("停车场与广场");
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
