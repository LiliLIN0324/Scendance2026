import { describe, expect, it } from 'vitest';
import { matchSceneIntent } from './scene-chat-intent';
import type { ScannedVenue } from './venue-scans';

const WEST_LAKE: ScannedVenue = { assetId: 'c338f720-3f60-4adb-8f3b-023300000001', name: '西湖 0233 · 标准档' };
const PAVILION: ScannedVenue = { assetId: '9587c51d-44b4-44b7-a5ea-462444aa218b', name: '本机高斯 9587c51d' };
const scans = [WEST_LAKE, PAVILION];

describe('场景库对话的意图匹配', () => {
  it('认出拍摄、生成、重建三个入口', () => {
    expect(matchSceneIntent('拍一段场地', scans)).toEqual({ kind: 'capture' });
    expect(matchSceneIntent('生成场地', scans)).toEqual({ kind: 'generate' });
    expect(matchSceneIntent('照片重建', scans)).toEqual({ kind: 'reconstruct' });
  });

  it('按名字或资产号前 8 位认出要加的那一场（分隔符怎么打都认）', () => {
    expect(matchSceneIntent('把西湖 0233 标准档加进来', scans)).toEqual({ kind: 'add-scans', venues: [WEST_LAKE] });
    expect(matchSceneIntent('把西湖0233·标准档加入本场', scans)).toEqual({ kind: 'add-scans', venues: [WEST_LAKE] });
    expect(matchSceneIntent('加进 9587c51d', scans)).toEqual({ kind: 'add-scans', venues: [PAVILION] });
  });

  it('说「都加进来」就是全部', () => {
    expect(matchSceneIntent('本机的都加进来', scans)).toEqual({ kind: 'add-scans', venues: scans });
  });

  it('认不出来的句子交给主 Agent，不自己瞎猜', () => {
    expect(matchSceneIntent('加两把椅子', scans)).toEqual({ kind: 'agent' });
    expect(matchSceneIntent('这个场地多大', scans)).toEqual({ kind: 'agent' });
    expect(matchSceneIntent('  ', scans)).toEqual({ kind: 'agent' });
  });
});
