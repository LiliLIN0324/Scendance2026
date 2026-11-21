// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@/lib/test-support-memory-storage';
import { rememberAholoAsset } from '../lib/aholo-assets';
import { EnvironmentPreview } from './environment-preview';
import type { SplatPreviewState } from '../hooks/use-splat-preview';

const LEGACY = '48245ba8-8f0c-456f-a4c4-6a13526e08b9';
const NAMED = 'c338f720-3f60-4adb-8f3b-023300000001';
/** 2026-11-08 04:00Z：任何时区都落在 11/08。 */
const SAVED_AT = Date.UTC(2026, 10, 8, 4);

const idle: SplatPreviewState = { status: 'idle', assetId: '', name: '' };

function props(overrides: Partial<Parameters<typeof EnvironmentPreview>[0]> = {}) {
  return {
    preview: idle,
    current: null,
    environments: [],
    floors: [{ id: 'ground', name: '活动场地' }],
    onSelect: vi.fn(),
    onRemove: vi.fn(),
    onSetFloor: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  } as Parameters<typeof EnvironmentPreview>[0];
}

/** 2026-11-19 用户：「没有其他和我的区分，这些都是我们的云资产」。 */
describe('项目中的场景：旧存货名字也走同一套可读名', () => {
  let mem: MemoryStorage;
  beforeEach(() => {
    cleanup();
    mem = new MemoryStorage();
    vi.stubGlobal('Storage', MemoryStorage);
    vi.stubGlobal('localStorage', mem);
    window.localStorage = mem;
    localStorage.clear();
    rememberAholoAsset({ assetId: LEGACY, kind: 'spz', name: '云端高斯 48245ba8', bytes: 10, savedAt: SAVED_AT });
    rememberAholoAsset({ assetId: NAMED, kind: 'spz', name: '西湖 0233 · 标准档', bytes: 10, savedAt: SAVED_AT });
  });
  afterEach(() => { mem?.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('gallery：存下来的「云端高斯 48245ba8」显示成日期名，点开也回传这个名', () => {
    const onSelect = vi.fn();
    render(<EnvironmentPreview {...props({
      gallery: true,
      onSelect,
      environments: [{ assetId: LEGACY, name: '云端高斯 48245ba8' }],
    })}/>);
    const button = screen.getByLabelText('预览 实景扫描 11/08');
    expect(button.querySelector('strong')?.textContent).toBe('实景扫描 11/08');
    expect(document.body.textContent).not.toMatch(/云端高斯|48245ba8/);
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith(LEGACY, '实景扫描 11/08');
  });

  it('gallery：自己起的场名一个字不改', () => {
    render(<EnvironmentPreview {...props({
      gallery: true,
      environments: [{ assetId: NAMED, name: '西湖 0233 · 标准档' }],
    })}/>);
    expect(screen.getByLabelText('预览 西湖 0233 · 标准档').querySelector('strong')?.textContent).toBe('西湖 0233 · 标准档');
  });

  it('shelf：场景列表里同样不出现来源前缀与资产号', () => {
    render(<EnvironmentPreview {...props({
      environments: [{ assetId: LEGACY, name: '云端高斯 48245ba8' }],
    })}/>);
    const list = screen.getByLabelText('项目中的空间场景');
    expect(list.textContent).toContain('实景扫描 11/08');
    expect(list.textContent).not.toMatch(/云端高斯|48245ba8/);
  });

  it('注册表里查不到落盘时间时就只叫「实景扫描」，不编日期', () => {
    cleanup();
    localStorage.clear();
    render(<EnvironmentPreview {...props({
      gallery: true,
      environments: [{ assetId: LEGACY, name: '本机高斯 26932bea' }],
    })}/>);
    expect(screen.getByLabelText('预览 实景扫描').querySelector('strong')?.textContent).toBe('实景扫描');
  });
});
