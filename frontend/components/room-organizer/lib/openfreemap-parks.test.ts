/**
 * docs/47 A1：planet `park` 图层（leisure=park/garden）绿地面解码的定向测试。
 * 用 PbfWriter 现场编码一块最小 MVT 瓦片，走真实解码路径，不用 mock 冒充生产函数。
 */
import { PbfWriter } from "pbf";
import { describe, expect, it } from "vitest";
import { decodeParksTile } from "./openfreemap-parks";
import { tilePointToLngLat, type OfmTile } from "./openfreemap-tiles";

const tile: OfmTile = { z: 14, x: 13660, y: 6746 };
const EXTENT = 4096;

const zigzag = (n: number): number => (n << 1) ^ (n >> 31);

/** MVT polygon 命令流：命令整数 = (id & 0x7) | (count << 3)；每环 MoveTo + LineTo + Close，delta 相对上一顶点延续跨环。 */
function polygonCommands(rings: [number, number][][]): number[] {
  const out: number[] = [];
  let px = 0;
  let py = 0;
  for (const ring of rings) {
    out.push((1 << 3) | 1, zigzag(ring[0]![0]! - px), zigzag(ring[0]![1]! - py));
    px = ring[0]![0]!;
    py = ring[0]![1]!;
    out.push(((ring.length - 1) << 3) | 2);
    for (let i = 1; i < ring.length; i++) {
      out.push(zigzag(ring[i]![0]! - px), zigzag(ring[i]![1]! - py));
      px = ring[i]![0]!;
      py = ring[i]![1]!;
    }
    out.push((1 << 3) | 7);
  }
  return out;
}

interface TestFeature {
  id?: number;
  type: 1 | 2 | 3;
  /** [keyIndex, valueIndex] 交替对。 */
  tags: [number, number][];
  geometry: number[];
}

function encodeTile(layers: {
  name: string;
  keys: string[];
  values: string[];
  features: TestFeature[];
  extent?: number;
}[]): Uint8Array {
  const pbf = new PbfWriter();
  for (const layer of layers) {
    pbf.writeMessage(3, (l, p) => {
      p.writeVarintField(15, 2);
      p.writeStringField(1, l.name);
      for (const f of l.features) {
        p.writeMessage(2, (feat, fp) => {
          if (feat.id !== undefined) fp.writeVarintField(1, feat.id);
          fp.writePackedVarint(2, feat.tags.flat());
          fp.writeVarintField(3, feat.type);
          fp.writePackedVarint(4, feat.geometry);
        }, f);
      }
      for (const key of l.keys) p.writeStringField(3, key);
      for (const value of l.values) {
        p.writeMessage(4, (v, vp) => {
          vp.writeStringField(1, v);
        }, value);
      }
      p.writeVarintField(5, l.extent ?? EXTENT);
    }, layer);
  }
  return pbf.finish();
}

const squareRing = (x0: number, y0: number, size: number): [number, number][] => [
  [x0, y0],
  [x0 + size, y0],
  [x0 + size, y0 + size],
  [x0, y0 + size],
  [x0, y0],
];

describe("openfreemap-parks（planet park 图层绿地解码）", () => {
  it("park/garden 图层解码成带名字的绿地面，坐标经瓦片数学回经纬度", () => {
    const buffer = encodeTile([
      {
        name: "park",
        keys: ["class", "name"],
        values: ["park", "湖滨公园", "garden", "涌金公园"],
        features: [
          {
            id: 101,
            type: 3,
            tags: [
              [0, 0],
              [1, 1],
            ],
            geometry: polygonCommands([squareRing(100, 100, 400)]),
          },
          {
            id: 102,
            type: 3,
            tags: [
              [0, 2],
              [1, 3],
            ],
            geometry: polygonCommands([squareRing(2000, 2000, 300)]),
          },
        ],
      },
    ]);
    const patches = decodeParksTile(buffer, tile);
    expect(patches).toHaveLength(2);
    const park = patches[0]!;
    expect(park.name).toBe("湖滨公园");
    expect(park.parkClass).toBe("park");
    expect(park.id).toBe(`ofm:park/14/13660/6746/101/0`);
    // (100,100)/4096 回经纬度：与 openfreemap-tiles 的同一套数学一致
    const [lng, lat] = tilePointToLngLat(tile, EXTENT, 100, 100);
    expect(park.lngLat[0]).toEqual([lng, lat]);
    expect(patches[1]!.parkClass).toBe("garden");
    expect(patches[1]!.name).toBe("涌金公园");
  });

  it("national_park 等非 leisure=park/garden 类别不进证据", () => {
    const buffer = encodeTile([
      {
        name: "park",
        keys: ["class"],
        values: ["national_park", "nature_reserve"],
        features: [
          { id: 1, type: 3, tags: [[0, 0]], geometry: polygonCommands([squareRing(0, 0, 500)]) },
          { id: 2, type: 3, tags: [[0, 1]], geometry: polygonCommands([squareRing(1000, 1000, 500)]) },
        ],
      },
    ]);
    expect(decodeParksTile(buffer, tile)).toEqual([]);
  });

  // 2026-11-18 实测：planet 的 park 层在杭州只有 national_park/nature_reserve 大景区，
  // 城市草坪在 landcover 层（class=grass/wood）——两层都解码，farmland/sand/ice 丢。
  it("landcover 层 grass/wood 进绿地证据，farmland/sand/ice 不进，id 带层名防撞", () => {
    const buffer = encodeTile([
      {
        name: "landcover",
        keys: ["class"],
        values: ["grass", "wood", "farmland", "sand", "ice"],
        features: [
          { id: 1, type: 3, tags: [[0, 0]], geometry: polygonCommands([squareRing(0, 0, 300)]) },
          { id: 2, type: 3, tags: [[0, 1]], geometry: polygonCommands([squareRing(600, 0, 300)]) },
          { id: 3, type: 3, tags: [[0, 2]], geometry: polygonCommands([squareRing(1200, 0, 300)]) },
          { id: 4, type: 3, tags: [[0, 3]], geometry: polygonCommands([squareRing(1800, 0, 300)]) },
          { id: 5, type: 3, tags: [[0, 4]], geometry: polygonCommands([squareRing(2400, 0, 300)]) },
        ],
      },
    ]);
    const patches = decodeParksTile(buffer, tile);
    expect(patches).toHaveLength(2);
    expect(patches[0]!.id).toBe(`ofm:landcover/14/13660/6746/1/0`);
    expect(patches[0]!.parkClass).toBe("grass");
    expect(patches[1]!.parkClass).toBe("wood");
  });

  it("退化环（不足三角）只丢该环，不拖垮整块瓦片", () => {
    const buffer = encodeTile([
      {
        name: "park",
        keys: ["class"],
        values: ["park"],
        features: [
          {
            id: 1,
            type: 3,
            tags: [[0, 0]],
            geometry: polygonCommands([
              [
                [0, 0],
                [500, 500],
              ],
            ]),
          },
          {
            id: 2,
            type: 3,
            tags: [[0, 0]],
            geometry: polygonCommands([squareRing(1000, 1000, 200)]),
          },
        ],
      },
    ]);
    const patches = decodeParksTile(buffer, tile);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.id).toBe(`ofm:park/14/13660/6746/2/0`);
  });

  it("无 park 图层与空瓦片都返回空数组", () => {
    const noPark = encodeTile([
      {
        name: "building",
        keys: [],
        values: [],
        features: [],
      },
    ]);
    expect(decodeParksTile(noPark, tile)).toEqual([]);
    expect(decodeParksTile(new Uint8Array(0), tile)).toEqual([]);
  });
});
