import { describe, expect, it } from 'vitest';
import { chipsAfterFulfilled, chipsAfterLayoutPreview, composeProcessStrip } from './turn-process';

const idle = { understanding: false, generating: false, cloudRunning: false, cloudRound: 0, cloudTool: false, failed: null } as const;

describe('process strip', () => {
  it('moves from understanding to a local preview, then a cloud round', () => {
    expect(composeProcessStrip({ ...idle, understanding: true })).toBe('正在理解活动需求…');
    expect(composeProcessStrip({ ...idle, generating: true })).toBe('正在生成布置预览');
    expect(composeProcessStrip({ ...idle, generating: true, cloudTool: true })).toBe('正在调用云端工具');
    expect(composeProcessStrip({ ...idle, generating: true, cloudTool: true, cloudRunning: true, cloudRound: 2 })).toBe('云端第 2 轮…');
  });
  it('keeps the attempt visible after a failure', () => {
    expect(composeProcessStrip({ ...idle, failed: 'understanding' })).toBe('已尝试：正在理解…');
    expect(composeProcessStrip({ ...idle, failed: 'preview' })).toBe('已尝试：正在生成布置预览');
    expect(composeProcessStrip({ ...idle, failed: 'cloud_tool' })).toBe('已尝试：正在调用云端工具');
    expect(composeProcessStrip({ ...idle, failed: 'preview', generating: true })).toBe('正在生成布置预览');
  });
});

describe('pending chips after a fulfilled turn', () => {
  it('removes only the utterance that was understood or previewed', () => {
    expect(chipsAfterFulfilled(['沙发布置', '把椅子往左挪'], ['沙发布置'])).toEqual(['把椅子往左挪']);
    expect(chipsAfterFulfilled(['把椅子往左挪'], [])).toEqual(['把椅子往左挪']);
  });
  it('clears a related seating chip when the layout preview succeeds', () => {
    expect(chipsAfterLayoutPreview(['想围着坐', '把椅子往左挪'], ['出一版'])).toEqual(['把椅子往左挪']);
    expect(chipsAfterLayoutPreview(['想围着坐'], ['想围着坐'])).toEqual([]);
    expect(chipsAfterLayoutPreview(['把椅子往左挪'], [])).toEqual(['把椅子往左挪']);
  });
});
