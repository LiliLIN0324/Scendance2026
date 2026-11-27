// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveSidecarRef } from '@/lib/sidecar-records';
import { productionPlanSchema, type ProductionPlan } from '../../../../supabase/functions/_shared/production-plan-contract';
import { useSidecarResolution } from './use-sidecar-resolution';

vi.mock('@/lib/sidecar-records', () => ({ resolveSidecarRef: vi.fn() }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const legacy: ProductionPlan = productionPlanSchema.parse({});

describe('useSidecarResolution 读侧解析', () => {
  it('空 ref 同步回落旧整包，不调 IDB 解析', async () => {
    const { result } = renderHook(() => useSidecarResolution({
      projectId: 'p1', kind: 'plan', refId: undefined, legacyFallback: legacy,
    }));
    await waitFor(() => expect(result.current.status).toBe('fallback-legacy'));
    expect(result.current.data).toBe(legacy);
    expect(resolveSidecarRef).not.toHaveBeenCalled();
  });

  it('匿名项目（空编号）同样回落旧整包，不进 IDB', async () => {
    const { result } = renderHook(() => useSidecarResolution({
      projectId: '   ', kind: 'operations', refId: 'ref-1', legacyFallback: legacy,
    }));
    await waitFor(() => expect(result.current.status).toBe('fallback-legacy'));
    expect(result.current.data).toBe(legacy);
    expect(resolveSidecarRef).not.toHaveBeenCalled();
  });

  it('ref 命中独立记录：用记录 data，状态为 record', async () => {
    const recordData: ProductionPlan = structuredClone(legacy);
    vi.mocked(resolveSidecarRef).mockResolvedValue({ status: 'record', record: { id: 'ref-1', projectId: 'p1', kind: 'plan', data: recordData, savedAt: '2026-11-27' }, data: recordData });
    const { result } = renderHook(() => useSidecarResolution({
      projectId: 'p1', kind: 'plan', refId: 'ref-1', legacyFallback: legacy,
    }));
    await waitFor(() => expect(result.current.status).toBe('record'));
    expect(result.current.data).toBe(recordData);
  });

  it('missing：状态置缺失、data 置空，不用旧整包或最新记录顶替', async () => {
    vi.mocked(resolveSidecarRef).mockResolvedValue({ status: 'missing' });
    const { result } = renderHook(() => useSidecarResolution({
      projectId: 'p1', kind: 'plan', refId: 'ref-gone', legacyFallback: legacy,
    }));
    await waitFor(() => expect(result.current.status).toBe('missing'));
    expect(result.current.data).toBeUndefined();
  });

  it('读取异常时回落旧整包只读展示，不抛到组件外', async () => {
    vi.mocked(resolveSidecarRef).mockRejectedValue(new Error('IDB 不可用'));
    const { result } = renderHook(() => useSidecarResolution({
      projectId: 'p1', kind: 'plan', refId: 'ref-1', legacyFallback: legacy,
    }));
    await waitFor(() => expect(result.current.status).toBe('fallback-legacy'));
    expect(result.current.data).toBe(legacy);
  });
});
