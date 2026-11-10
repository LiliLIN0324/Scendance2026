// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  matchRecentPlaces,
  placeRelevance,
  placeSearchUrl,
  rankPlaces,
  recentPlaces,
  rememberPlace,
  searchPlaces,
  usesLocalPlaceProxy,
  PLACE_RECENT_STORAGE,
  type PlaceSuggestion,
} from './place-search';

const PLACES = {
  places: [
    { id: 'poi-1', name: '西湖十景(平湖秋月)', address: '西湖北部孤山南麓东端滨湖地带', lng: 120.146169, lat: 30.252176 },
    { id: 'poi-2', name: '杭州大剧院', address: '浙江省杭州市上城区', lng: 120.215334, lat: 30.244534 },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('placeSearchUrl', () => {
  it('本机走 3199 代理、线上走同源 /api，关键词去空白并带上 limit', () => {
    expect(placeSearchUrl(' 平湖秋月 ', 4, true)).toBe('http://127.0.0.1:3199/api/tdt-search?keywords=%E5%B9%B3%E6%B9%96%E7%A7%8B%E6%9C%88&limit=4');
    expect(placeSearchUrl('西湖', 6, false)).toBe('/api/tdt-search?keywords=%E8%A5%BF%E6%B9%96&limit=6');
  });
});

describe('searchPlaces', () => {
  it('解析 { places } 契约：id/name/address/lng/lat', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(PLACES));
    const places = await searchPlaces('平湖秋月', { fetchImpl, local: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(places).toHaveLength(2);
    expect(places[0]).toEqual({ id: 'poi-1', name: '西湖十景(平湖秋月)', address: '西湖北部孤山南麓东端滨湖地带', lng: 120.146169, lat: 30.252176 });
  });

  it('关键词太短/太长不发请求', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(PLACES));
    expect(await searchPlaces('西', { fetchImpl })).toEqual([]);
    expect(await searchPlaces('长'.repeat(81), { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('无结果（404）与网络异常都回空数组，不抛错', async () => {
    const notFound = vi.fn(async () => jsonResponse({ error: 'no place' }, 404));
    expect(await searchPlaces('查无此地', { fetchImpl: notFound, local: false })).toEqual([]);
    const broken = vi.fn(async () => {
      throw new Error('network down');
    });
    expect(await searchPlaces('平湖秋月', { fetchImpl: broken, local: false })).toEqual([]);
  });

  it('坐标非数字的候选被丢掉，name 缺失时退回 address', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      places: [
        { id: 'a', name: '', address: '孤山路 1 号', lng: 120.1, lat: 30.2 },
        { id: 'b', name: '坏数据', address: '', lng: 'x', lat: 30.2 },
      ],
    }));
    expect(await searchPlaces('孤山', { fetchImpl, local: false })).toEqual([
      { id: 'a', name: '孤山路 1 号', address: '孤山路 1 号', lng: 120.1, lat: 30.2 },
    ]);
  });
});

describe('usesLocalPlaceProxy', () => {
  it('jsdom 下 hostname 是 localhost → 走本机代理', () => {
    expect(usesLocalPlaceProxy()).toBe(true);
  });
});

function place(id: string, name: string, address = ''): PlaceSuggestion {
  return { id, name, address, lng: 120.1, lat: 30.2 };
}

describe('placeRelevance / rankPlaces（模糊排序）', () => {
  it('名称完全命中拿满分，前缀 > 包含 > 只在地址里', () => {
    const q = '平湖秋月';
    const exact = placeRelevance(place('a', '平湖秋月'), q);
    const prefix = placeRelevance(place('b', '平湖秋月 西湖景区'), q);
    const contains = placeRelevance(place('c', '西湖十景(平湖秋月)'), q);
    const addressOnly = placeRelevance(place('d', '某茶室', '平湖秋月东侧'), q);
    const none = placeRelevance(place('e', '杭州大剧院', '上城区'), q);
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(contains);
    expect(contains).toBeGreaterThan(addressOnly);
    expect(addressOnly).toBeGreaterThan(none);
  });

  it('忽略空格/括号/大小写：用户手打的「西湖 十景」也能命中名字', () => {
    expect(placeRelevance(place('a', '西湖十景(平湖秋月)'), '西湖 十景')).toBeGreaterThan(60);
  });

  it('rankPlaces 把最相关的排前面，同分保持原序', () => {
    const places = [place('1', '杭州大剧院'), place('2', '西湖十景(平湖秋月)'), place('3', '平湖秋月')];
    expect(rankPlaces(places, '平湖秋月').map(item => item.id)).toEqual(['3', '2', '1']);
    const tied = [place('x', '西湖A'), place('y', '西湖B')];
    expect(rankPlaces(tied, '西湖').map(item => item.id)).toEqual(['x', 'y']);
  });

  it('关键词为空时原序返回，不改动调用方传入的数组', () => {
    const places = [place('1', '杭州大剧院'), place('2', '西湖十景')];
    expect(rankPlaces(places, '  ').map(item => item.id)).toEqual(['1', '2']);
    expect(places.map(item => item.id)).toEqual(['1', '2']);
  });

  it('searchPlaces 返回的结果已经排好序（天地图的顺序不保证相关度）', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      places: [...PLACES.places].reverse(),
    }));
    const found = await searchPlaces('平湖秋月', { fetchImpl, local: true });
    expect(found.map(item => item.id)).toEqual(['poi-1', 'poi-2']);
  });
});

describe('最近选过的地点', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('记住后能读回，且只保留最近 5 条、按 id 去重、最新在前', () => {
    for (let i = 1; i <= 6; i += 1) rememberPlace(place(`p${i}`, `地点 ${i}`));
    const recent = recentPlaces();
    expect(recent.map(item => item.id)).toEqual(['p6', 'p5', 'p4', 'p3', 'p2']);
    rememberPlace(place('p4', '地点 4'));
    expect(recentPlaces().map(item => item.id)).toEqual(['p4', 'p6', 'p5', 'p3', 'p2']);
  });

  it('matchRecentPlaces 按包含匹配（名字或地址），空关键词给全部', () => {
    rememberPlace(place('a', '平湖秋月', '西湖北部孤山南麓'));
    rememberPlace(place('b', '杭州大剧院', '上城区之江路'));
    expect(matchRecentPlaces('').map(item => item.id)).toEqual(['b', 'a']);
    expect(matchRecentPlaces('平湖').map(item => item.id)).toEqual(['a']);
    expect(matchRecentPlaces('上城').map(item => item.id)).toEqual(['b']);
  });

  it('坏数据/没有 localStorage 时安全回空数组', () => {
    window.localStorage.setItem(PLACE_RECENT_STORAGE, '{not json');
    expect(recentPlaces()).toEqual([]);
    window.localStorage.setItem(PLACE_RECENT_STORAGE, JSON.stringify([{ id: 'x', name: '', lng: 'bad', lat: 1 }]));
    expect(recentPlaces()).toEqual([]);
  });
});