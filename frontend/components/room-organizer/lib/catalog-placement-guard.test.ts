// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSession, getBackendConfig } from '@/lib/backend-session';
import { layoutStore } from '../hooks/use-layout-store';
import { makeFloor, makeLayout } from './__testfixtures__/fixtures';
import { captureCatalogPlacement } from './catalog-placement-guard';

const original = layoutStore.getState();
beforeEach(() => { layoutStore.setState({ layout: makeLayout({ id: 'rehearsal-a', floors: [makeFloor(), makeFloor({ id: 'upper' })] }), activeFloorIndex: 0 }); });
afterEach(() => { layoutStore.setState(original); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('captureCatalogPlacement', () => {
  it('rejects a floor switch back even when the immutable layout is still the very same object', () => {
    const layout = layoutStore.getState().layout, guard = captureCatalogPlacement();
    layoutStore.getState().actions.setActiveFloorIndex(1);
    layoutStore.getState().actions.setActiveFloorIndex(0);
    expect(layoutStore.getState().layout).toBe(layout);
    expect(() => guard.assertCurrent()).toThrow(/楼层.*变化/);
    guard.dispose();
  });

  it('rejects an actual edit followed by restoring the original layout content', () => {
    const layout = layoutStore.getState().layout, guard = captureCatalogPlacement();
    layoutStore.getState().actions.setWidth(layout.width + 1);
    layoutStore.getState().actions.applyLayout(layout);
    expect(layoutStore.getState().layout).toEqual(layout);
    expect(() => guard.assertCurrent()).toThrow(/变化.*重新添加/);
    guard.dispose();
  });

  it('rejects sign out and sign back in as the same user through the real BackendSession subscription', async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => String(url).includes('/auth/v1/token')
      ? new Response(JSON.stringify({ access_token: 'rehearsal-access', refresh_token: 'rehearsal-refresh', expires_in: 3600, user: { id: 'rehearsal-owner' } }), { status: 200 })
      : new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const controller = new BackendSession(getBackendConfig({ url: 'http://127.0.0.1:54399', anonKey: 'sb_publishable_rehearsal' }));
    await controller.signIn('rehearsal@example.test', 'rehearsal-only-password');
    const guard = captureCatalogPlacement(controller);
    await controller.signOut();
    await controller.signIn('rehearsal@example.test', 'rehearsal-only-password');
    expect(controller.getSnapshot().user?.id).toBe('rehearsal-owner');
    expect(() => guard.assertCurrent()).toThrow(/登录状态.*变化/);
    guard.dispose();
    controller.dispose();
  });

  it('uses the caller identity epoch for an API/controller switch back without a store notification', () => {
    const controller = new BackendSession(getBackendConfig({ url: '', anonKey: '' }));
    let epoch = 0;
    const guard = captureCatalogPlacement(controller, () => epoch);
    const originalApi = controller.config.apiUrl;
    controller.config.apiUrl = 'https://rehearsal-service.example.test/functions/v1/scene-api';
    epoch++;
    controller.config.apiUrl = originalApi;
    epoch++;
    expect(() => guard.assertCurrent()).toThrow(/变化.*重新添加/);
    guard.dispose();
    controller.dispose();
  });

  it('also compares the API at placement time when only its configuration changed', () => {
    const controller = new BackendSession(getBackendConfig({ url: '', anonKey: '' }));
    const guard = captureCatalogPlacement(controller);
    controller.config.apiUrl = 'https://rehearsal-service.example.test/functions/v1/scene-api';
    expect(() => guard.assertCurrent()).toThrow(/变化/);
    guard.dispose();
    controller.dispose();
  });

  it('releases both subscriptions exactly once after a completed or abandoned download', () => {
    const controller = new BackendSession(getBackendConfig({ url: '', anonKey: '' }));
    const stopLayout = vi.fn(), stopSession = vi.fn();
    vi.spyOn(layoutStore, 'subscribe').mockReturnValue(stopLayout);
    vi.spyOn(controller, 'subscribe').mockReturnValue(stopSession);
    const guard = captureCatalogPlacement(controller);
    expect(() => guard.assertCurrent()).not.toThrow();
    guard.dispose();
    guard.dispose();
    expect(stopLayout).toHaveBeenCalledOnce();
    expect(stopSession).toHaveBeenCalledOnce();
    controller.dispose();
  });
});
