import { describe, expect, it, vi } from 'vitest';
import {
  buildPlaceSearchOptions,
  fetchPlaceShapeHints,
  hintedOutlineNames,
  parseShapeHints,
  placeHasOutline,
  placeShapeHintsUrl,
} from './place-search-options';
import { isDisplayablePlaceShape, isPersistablePlaceShape, namesReferToSamePlace } from './place-shape-quality';
import { fetchPlaceShape } from './place-area';
import type { PlaceSuggestion } from './place-search';
import type { PlaceArea } from './place-area';

const in77: PlaceSuggestion = {
  id: 'poi-in77',
  name: '湖滨银泰 in77',
  address: '杭州市上城区延安路',
  lng: 120.160119,
  lat: 30.25296,
};
const tower: PlaceSuggestion = {
  id: 'poi-tower',
  name: '杭州大厦',
  address: '杭州市下城区',
  lng: 120.163,
  lat: 30.27,
};
const other: PlaceSuggestion = {
  id: 'poi-other',
  name: '西湖银泰',
  address: '杭州市西湖区',
  lng: 120.13,
  lat: 30.26,
};
const shangcheng: PlaceArea = {
  id: '156330102',
  name: '上城区',
  level: '区县',
  lng: 120.17,
  lat: 30.25,
  bounds: [120.14, 30.22, 120.20, 30.28],
  polygon: [[120.14, 30.22], [120.20, 30.22], [120.20, 30.28], [120.14, 30.28]],
};

describe('轮廓可信度（客户端）', () => {
  it('杭州大厦式 3 点 line 不是占地，也不能入库', () => {
    const garbage = {
      kind: 'line' as const,
      polygon: [[120.1630, 30.2700], [120.1631, 30.2701], [120.1632, 30.2700]] as [number, number][],
    };
    expect(isDisplayablePlaceShape(garbage)).toBe(false);
    expect(isPersistablePlaceShape(garbage)).toBe(false);
  });
});

describe('buildPlaceSearchOptions（有轮廓优先）', () => {
  it('已有轮廓的 POI 排在行政区选区之前，无轮廓 POI 在最后；垃圾线不计入轮廓', () => {
    const outlined = hintedOutlineNames([
      { name: '杭州湖滨银泰in77', nameNorm: '杭州湖滨银泰in77', kind: 'area', pts: 18 },
      { name: '杭州大厦', nameNorm: '杭州大厦', kind: 'line', pts: 3 },
    ]);
    const options = buildPlaceSearchOptions({
      query: '银泰',
      areas: [shangcheng],
      places: [tower, other, in77],
      recent: [],
      outlinedNames: outlined,
    });
    expect(options.map(item => item.kind === 'area' ? item.area.name : item.place.name)).toEqual([
      '湖滨银泰 in77',
      '上城区',
      '杭州大厦',
      '西湖银泰',
    ]);
    const in77Row = options[0];
    expect(in77Row?.kind).toBe('place');
    if (in77Row?.kind === 'place') expect(in77Row.hasOutline).toBe(true);
    const towerRow = options.find(item => item.kind === 'place' && item.place.name === '杭州大厦');
    if (towerRow?.kind === 'place') expect(towerRow.hasOutline).toBe(false);
  });

  it('没有轮廓提示时，保持「选区在前、POI 在后」的旧顺序', () => {
    const options = buildPlaceSearchOptions({
      query: '银泰',
      areas: [shangcheng],
      places: [in77, other],
      recent: [],
      outlinedNames: new Set(),
    });
    expect(options.map(item => item.kind)).toEqual(['area', 'place', 'place']);
    expect(options[0]?.kind === 'area' && options[0].area.name).toBe('上城区');
  });

  it('in77 短代码能对上库存全名「杭州湖滨银泰in77」', () => {
    expect(namesReferToSamePlace('in77', '杭州湖滨银泰in77')).toBe(true);
    expect(placeHasOutline('湖滨银泰 in77', new Set(['杭州湖滨银泰in77']))).toBe(true);
    expect(placeHasOutline('杭州大厦', new Set(['杭州湖滨银泰in77']))).toBe(false);
  });
});

describe('fetchPlaceShapeHints / parseShapeHints', () => {
  it('本机走 3199，线上走同源', () => {
    expect(placeShapeHintsUrl('in77', [], true)).toBe('http://127.0.0.1:3199/api/place-shape-hints?q=in77');
    expect(placeShapeHintsUrl('in77', ['杭州大厦'], false)).toBe('/api/place-shape-hints?q=in77&names=%E6%9D%AD%E5%B7%9E%E5%A4%A7%E5%8E%A6');
  });

  it('解析 hints；3 点 line 不会进入有轮廓集合', () => {
    const hints = parseShapeHints({
      hints: [
        { name: '湖滨银泰·IN77', nameNorm: '湖滨银泰in77', kind: 'area', pts: 18 },
        { name: '杭州大厦', kind: 'line', pts: 3 },
        { name: '' },
      ],
    });
    expect(hints).toHaveLength(2);
    const names = hintedOutlineNames(hints);
    expect([...names]).toEqual(['湖滨银泰in77']);
  });

  it('404 / 网络失败回空数组，不抛错', async () => {
    const notFound = vi.fn(async () => new Response('no', { status: 404 }));
    await expect(fetchPlaceShapeHints('in77', { local: true, fetchImpl: notFound })).resolves.toEqual([]);
    const broken = vi.fn(async () => { throw new Error('down'); });
    await expect(fetchPlaceShapeHints('in77', { local: true, fetchImpl: broken })).resolves.toEqual([]);
  });
});

describe('fetchPlaceShape 拒绝垃圾几何', () => {
  it('3 点 kind:line 不当占地，回 null 且不抛错', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      shape: {
        id: 'osm:Wbad',
        name: '杭州大厦',
        kind: 'line',
        polygon: [[120.1630, 30.2700], [120.1631, 30.2701], [120.1632, 30.2700]],
        bounds: [120.1630, 30.2700, 120.1632, 30.2701],
      },
    }), { status: 200 }));
    await expect(fetchPlaceShape('杭州大厦', { local: true, fetchImpl, cache: false })).resolves.toBeNull();
  });
});
