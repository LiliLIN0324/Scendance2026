import { describe, expect, it } from 'vitest';
import {
  resolveSetting,
  sanitizePlanEditor,
  seedPlanEditor,
} from '../../../../supabase/functions/_shared/plan-editor';
import { mergeRemotePreferences, preferencesFromPartial, DEFAULT_LOCAL_PREFERENCES } from './account-preferences';

describe('settings scope', () => {
  it('方案覆盖个人，缺省再回退，false 和 0 都算数', () => {
    expect(resolveSetting('ft', 'm', 'm', 'personal')).toEqual({ value: 'ft', source: 'plan' });
    expect(resolveSetting(undefined, 'ft', 'm', 'personal')).toEqual({ value: 'ft', source: 'personal' });
    expect(resolveSetting(undefined, undefined, 'm', 'personal')).toEqual({ value: 'm', source: 'builtin' });
    expect(resolveSetting(null, null, 'm', 'personal')).toEqual({ value: 'm', source: 'builtin' });
    expect(resolveSetting(0, 2, 2.4, 'team')).toEqual({ value: 0, source: 'plan' });
    expect(resolveSetting(false, true, true, 'personal')).toEqual({ value: false, source: 'plan' });
  });

  it('坏的方案字段丢掉，旧数据缺字段仍能用', () => {
    expect(sanitizePlanEditor(undefined)).toBeUndefined();
    expect(sanitizePlanEditor({ gridSizeM: 99, displayUnit: 'ft', timeZone: 'Asia/Shanghai' })).toEqual({
      displayUnit: 'ft',
      timeZone: 'Asia/Shanghai',
    });
  });

  it('团队几何默认只在新建时复制，报价抬头不写进方案', () => {
    expect(seedPlanEditor({
      companyName: '幕景',
      defaultUnit: 'ft',
      defaultAisleClearM: 3,
      defaultBoothSpacingM: 0.8,
    })).toEqual({ displayUnit: 'ft', aisleClearM: 3, boothSpacingM: 0.8 });
    expect(seedPlanEditor({})).toBeUndefined();
  });

  it('云端缺键回退本机，不回退产品默认', () => {
    const local = { ...DEFAULT_LOCAL_PREFERENCES, snapToGrid: true, lengthPrecisionM: 0.1 as const, unit: 'ft' as const };
    expect(mergeRemotePreferences(local, {})).toEqual(local);
    expect(mergeRemotePreferences(local, { showMeasurements: false }).showMeasurements).toBe(false);
    expect(mergeRemotePreferences(local, { showMeasurements: false }).snapToGrid).toBe(true);
  });

  it('旧的本机 JSON 缺字段时用默认，不抛错', () => {
    expect(preferencesFromPartial({ unit: 'ft' })).toMatchObject({
      unit: 'ft',
      showMeasurements: true,
      lengthPrecisionM: 0.01,
      snapToGrid: false,
    });
  });
});
