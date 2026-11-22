import { describe, expect, it } from 'vitest';
import { makeFloor, makeLayout } from './__testfixtures__/fixtures';
import { MAX_NAME_LENGTH } from './schema';
import { venueIdentityPatch } from './venue-identity';

const venue = { assetId: 'scan-0001', name: '江南田园村落' };

describe('venueIdentityPatch', () => {
  it('把场地身份写进布局，尺寸与其它字段原样不动', () => {
    const layout = makeLayout({ id: 'p1', name: '发布会', width: 30, height: 20, floors: [makeFloor({ items: [] })] });
    const next = venueIdentityPatch(layout, venue);
    expect(next).not.toBeNull();
    expect(next!.venueScan).toEqual({ assetId: 'scan-0001', name: '江南田园村落' });
    // 用户拍板：落位只定位置，不得顺手改场地尺寸。
    expect(next!.width).toBe(30);
    expect(next!.height).toBe(20);
    expect(next!.floors).toBe(layout.floors);
    // 纯函数：不改调用方手里那份布局。
    expect(layout.venueScan).toBeUndefined();
  });

  it('同一套重复落位返回 null，避免重复压历史', () => {
    const layout = makeLayout({ venueScan: { assetId: 'scan-0001', name: '旧名字' } });
    expect(venueIdentityPatch(layout, venue)).toBeNull();
  });

  it('换成另一套时改写身份', () => {
    const layout = makeLayout({ venueScan: { assetId: 'scan-old', name: '旧场' } });
    expect(venueIdentityPatch(layout, venue)?.venueScan).toEqual({ assetId: 'scan-0001', name: '江南田园村落' });
  });

  it('资产号去空白；空资产号不写', () => {
    const layout = makeLayout();
    expect(venueIdentityPatch(layout, { assetId: '  scan-0002 ', name: ' 茶亭 ' })?.venueScan)
      .toEqual({ assetId: 'scan-0002', name: '茶亭' });
    expect(venueIdentityPatch(layout, { assetId: '   ', name: '空' })).toBeNull();
  });

  it('空名退回资产号，超长名按 schema 上限截断', () => {
    const layout = makeLayout();
    expect(venueIdentityPatch(layout, { assetId: 'scan-0003', name: '   ' })?.venueScan)
      .toEqual({ assetId: 'scan-0003', name: 'scan-0003' });
    const long = venueIdentityPatch(layout, { assetId: 'scan-0004', name: '长'.repeat(MAX_NAME_LENGTH + 50) });
    expect(long!.venueScan!.name).toHaveLength(MAX_NAME_LENGTH);
  });
});
