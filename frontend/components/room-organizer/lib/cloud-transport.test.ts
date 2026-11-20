import { describe, expect, it } from 'vitest';
import { SceneApiError } from '../../../../client/scene-client';
import { describeCloudFailure } from './cloud-transport';

describe('describeCloudFailure', () => {
  it('浏览器只给 "Failed to fetch" 时判定为连不上，并说明当前来源与下一步', () => {
    const described = describeCloudFailure(new TypeError('Failed to fetch'));
    expect(described?.kind).toBe('unreachable');
    expect(described?.message).toContain('没能连上云端服务');
    expect(described?.hint).toContain('localhost:3000');
    expect(described?.hint).not.toContain('Failed to fetch');
  });

  it('其它内核的网络层文案同样判定为连不上', () => {
    expect(describeCloudFailure(new TypeError('NetworkError when attempting to fetch resource.'))?.kind).toBe('unreachable');
    expect(describeCloudFailure(new TypeError('Load failed'))?.kind).toBe('unreachable');
  });

  it('服务端明确拒绝时按状态码分类，不混进「连不上」', () => {
    expect(describeCloudFailure(new SceneApiError('UNAUTHENTICATED', 401, null))?.kind).toBe('unauthorized');
    expect(describeCloudFailure(new SceneApiError('PLATFORM_ADMIN_REQUIRED', 403, null))?.kind).toBe('forbidden');
    expect(describeCloudFailure(new SceneApiError('CLOUD_STORAGE_UNAVAILABLE', 503, null))?.kind).toBe('unavailable');
  });

  it('判不出来的错误原样交回调用方，不臆造原因', () => {
    expect(describeCloudFailure(new Error('boom'))).toBeNull();
    expect(describeCloudFailure(new SceneApiError('CASE_VERSION_CONFLICT', 409, null))).toBeNull();
    expect(describeCloudFailure(undefined)).toBeNull();
  });
});
