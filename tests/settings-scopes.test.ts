import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, editor, outsider, owner, studio } from './fixtures.ts';

describe('settings scopes', () => {
  let f: Awaited<ReturnType<typeof database>>;
  beforeAll(async () => { f = await database(); }, 120_000);
  afterAll(async () => { await f?.db.close(); });

  it('preferences keep new keys when an old client patches the original two', async () => {
    expect(await f.rpc(owner, 'preferences.get')).toEqual({});
    const saved = await f.rpc(owner, 'preferences.put', {
      unit: 'ft', showMeasurements: false, lengthPrecisionM: 0.1, snapToGrid: true, snapToWall: false, snapToItems: true,
    });
    expect(saved.unit).toBe('ft');
    expect(saved.showMeasurements).toBe(false);
    expect(Number(saved.lengthPrecisionM)).toBeCloseTo(0.1);
    expect(saved.snapToGrid).toBe(true);
    expect(saved.snapToItems).toBe(true);
    const legacy = await f.rpc(owner, 'preferences.put', { unit: 'm', showMeasurements: true });
    expect(legacy.unit).toBe('m');
    expect(legacy.showMeasurements).toBe(true);
    expect(legacy.snapToGrid).toBe(true);
    expect(Number(legacy.lengthPrecisionM)).toBeCloseTo(0.1);
    await expect(f.rpc(owner, 'preferences.put', { lengthPrecisionM: 3 })).rejects.toThrow('INVALID_PREFERENCE_VALUE');
    await expect(f.rpc(null, 'preferences.get')).rejects.toThrow('UNAUTHENTICATED');
  });

  it('studio settings are readable by editors and writable by the owner', async () => {
    expect(await f.rpc(editor, 'studio-settings.get', { studioId: studio })).toEqual({});
    const saved = await f.rpc(owner, 'studio-settings.put', {
      studioId: studio, companyName: '幕景', quoteContact: '阿岚', currency: 'CNY', defaultUnit: 'm', defaultAisleClearM: 3,
    });
    expect(saved.companyName).toBe('幕景');
    expect(saved.currency).toBe('CNY');
    expect(Number(saved.defaultAisleClearM)).toBe(3);
    expect((await f.rpc(editor, 'studio-settings.get', { studioId: studio })).quoteContact).toBe('阿岚');
    await expect(f.rpc(editor, 'studio-settings.put', { studioId: studio, companyName: '别人' })).rejects.toThrow('FORBIDDEN');
    await expect(f.rpc(outsider, 'studio-settings.get', { studioId: studio })).rejects.toThrow('STUDIO_NOT_FOUND');
    const cleared = await f.rpc(owner, 'studio-settings.put', { studioId: studio, companyName: null });
    expect(cleared.companyName).toBeUndefined();
    expect(cleared.quoteContact).toBe('阿岚');
    await expect(f.rpc(owner, 'studio-settings.put', { studioId: studio, currency: 'BTC' })).rejects.toThrow('INVALID_STUDIO_SETTING');
  });
});
