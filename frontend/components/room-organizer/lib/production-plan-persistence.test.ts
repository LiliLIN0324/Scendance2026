import { inflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { productionPlanSchema, type ProductionPlan } from '../../../../supabase/functions/_shared/production-plan-contract';
import { layoutForExport } from '../../../lib/layout-export';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { STORAGE_KEY } from './constants';
import { loadNamedLayout, saveNamedLayout } from './library';
import { loadLayout, parseLayoutJson, saveLayout } from './persistence';
import { MAX_ID_LENGTH, isRoomLayout, parseLayoutEventOperations, parseStoredLayout } from './schema';
import { decodeShareUrl, encodeShareUrl, readShareHash } from './share';
import { getSnapshot, listSnapshots, recordSnapshot } from './version-history';
import type { RoomLayout } from './types';

const id = (n: number) => `a1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const originalText = '  独立演练记录\n  第二行保留缩进  ';
function plan(): ProductionPlan {
  return productionPlanSchema.parse({ dataKind: 'rehearsal', budget: { limitMinor: 0, scopeNote: originalText, basisNote: originalText },
    staffing: [
      { id: id(1).toUpperCase(), roleName: '  演练岗位  ', shiftLabel: '  演练班次\n  ', taskIds: [id(80).toUpperCase()], headcount: null, sourceType: 'outsourced', sourceName: originalText,
        plannedArrivalAt: '2026-10-08T23:30:00+08:00', plannedDepartureAt: '2026-10-09T00:30:00+08:00' },
      { id: id(2), roleName: '明示零人数', headcount: 0 },
    ], acquisitions: [{ id: id(3), title: '  演练物料取得\n  ', taskIds: [id(81)], objectIds: ['Chair-A', 'chair-a', id(90).toUpperCase()], method: 'rental', supplierName: originalText,
      specificationNote: originalText, sourceNote: originalText, transportScope: originalText, installationScope: originalText }],
    estimates: [
      { id: id(4), title: '未知人工估算', amountMinor: null, basisNote: originalText, objectIds: ['missing-original-id'] },
      { id: id(5), title: '明示零人工估算', amountMinor: 0, basisNote: originalText, taskIds: [id(80)] },
    ],
  });
}
function layout(): RoomLayout {
  return makeLayout({ id: 'production-rehearsal', productionPlan: plan(), floors: [makeFloor({ items: [
    makeItem({ id: 'Chair-A' }), makeItem({ id: 'chair-a' }), makeItem({ id: id(90) }),
  ] })] });
}
function withDesigns(): RoomLayout {
  const base = layout();
  return { ...base, designBook: { activeId: 'first', variants: [{ id: 'first', name: '演练方案', layout: structuredClone(base) }] } };
}
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, key: index => [...data.keys()][index] ?? null,
    getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); }, clear: () => { data.clear(); } };
}
function legacyHash(value: unknown): string {
  return `#layout=${Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')}`;
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('strict local production-plan persistence', () => {
  it('keeps old current and legacy layouts absent instead of inventing an empty plan', () => {
    const old = makeLayout();
    expect(parseStoredLayout(old)).toBe(old);
    expect(parseLayoutEventOperations(old)).toBe(old);
    expect(parseStoredLayout(old)).not.toHaveProperty('productionPlan');
    const legacy = { name: '旧场地', width: 8, height: 6, items: [], floorColor: '#ffffff' };
    expect(parseStoredLayout(legacy)).not.toHaveProperty('productionPlan');
    expect(parseStoredLayout({ ...legacy, productionPlan: plan() })!.productionPlan).toEqual(plan());
  });

  it('fills only contract defaults in explicitly supplied root and variant plans', () => {
    const snapshot = makeLayout({ productionPlan: {} as ProductionPlan });
    const source = makeLayout({ productionPlan: {} as ProductionPlan, designBook: { activeId: 'one', variants: [{ id: 'one', name: '方案', layout: snapshot }] } });
    const parsed = parseStoredLayout(source)!;
    expect(parsed.productionPlan).toEqual(productionPlanSchema.parse({}));
    expect(parsed.designBook!.variants[0].layout.productionPlan).toEqual(productionPlanSchema.parse({}));
    expect(parseLayoutEventOperations(source)).toEqual(parsed);
    expect(parseStoredLayout(parsed)).toEqual(parsed);
    expect(parseLayoutEventOperations(parsed)).toBe(parsed);
  });

  it('actually saves and reloads raw text, null, zero, offset timestamps, identities and orphan references', () => {
    const source = withDesigns(), storage = memoryStorage(); vi.stubGlobal('window', { localStorage: storage });
    const original = structuredClone(source);
    expect(saveLayout(source)).toMatchObject({ ok: true });
    const saved = storage.getItem(STORAGE_KEY)!;
    expect(JSON.parse(saved).productionPlan).toEqual(plan());
    expect(loadLayout()).toEqual(source);
    expect(parseLayoutJson(saved)).toEqual(source);
    expect(source).toEqual(original);
    expect(loadLayout()!.productionPlan!.staffing[0]).toMatchObject({ roleName: '  演练岗位  ', headcount: null, sourceName: originalText, id: id(1).toUpperCase() });
    expect(loadLayout()!.productionPlan!.estimates.map(row => row.amountMinor)).toEqual([null, 0]);
    expect(loadLayout()!.productionPlan!.acquisitions[0].objectIds).toEqual(['Chair-A', 'chair-a', id(90).toUpperCase()]);
  });

  it('keeps plans in named save slots and actual historical snapshots without manufacturing a new project identity', () => {
    const source = withDesigns(), storage = memoryStorage(); vi.stubGlobal('window', { localStorage: storage });
    const result = saveNamedLayout(source, '制作计划演练');
    expect(result).not.toBeNull();
    const reloaded = loadNamedLayout(result!.entry.id)!;
    expect(reloaded.id).toBe(source.id); expect(reloaded.productionPlan).toEqual(source.productionPlan);
    expect(reloaded.designBook!.variants[0].layout.productionPlan).toEqual(plan());
    expect(recordSnapshot(source, { storage, now: () => 1000, force: true })).toBe(true);
    const [snapshot] = listSnapshots({ storage, now: () => 1000 });
    expect(getSnapshot(snapshot!.id, { storage, now: () => 1000 })).toEqual(source);
  });

  it('whitelists the layout while preserving every supplied production-plan field', () => {
    const source = withDesigns();
    const parsed = parseStoredLayout({ ...source, obsoleteLayoutField: '旧布局冗余' })!;
    expect(parsed).not.toHaveProperty('obsoleteLayoutField');
    expect(parsed.productionPlan).toEqual(plan());
    expect(parsed.designBook!.variants[0].layout.productionPlan).toEqual(plan());
    expect(layoutForExport(parsed).productionPlan).toEqual(plan());
    expect(layoutForExport(parsed).designBook!.variants[0].layout.productionPlan).toEqual(plan());
  });

  it.each([
    null,
    { ...plan(), schemaVersion: 2 },
    { ...plan(), actualPaidMinor: 0 },
    { ...plan(), budget: { ...plan().budget, futureQuote: '未知字段' } },
    { ...plan(), staffing: [{ ...plan().staffing[0], actualArrivedAt: null }] },
    { ...plan(), acquisitions: [{ ...plan().acquisitions[0], quotationConfirmed: true }] },
    { ...plan(), estimates: [{ ...plan().estimates[0], supplierQuoteMinor: 0 }] },
    { ...plan(), staffing: [{ ...plan().staffing[0], headcount: -1 }] },
    { ...plan(), estimates: [{ ...plan().estimates[0], amountMinor: NaN }] },
    { ...plan(), acquisitions: [{ ...plan().acquisitions[0], objectIds: [id(90), id(90).toUpperCase()] }] },
  ])('refuses invalid or future business fields without repairing the block', invalid => {
    const source = { ...layout(), productionPlan: invalid } as RoomLayout;
    expect(isRoomLayout(source)).toBe(false); expect(parseStoredLayout(source)).toBeNull(); expect(parseLayoutEventOperations(source)).toBeNull();
    const storage = memoryStorage(); storage.setItem(STORAGE_KEY, 'original-save');
    expect(saveLayout(source, storage)).toEqual({ ok: false, reason: 'unknown' });
    expect(storage.getItem(STORAGE_KEY)).toBe('original-save');
    const snapshot = { ...layout(), productionPlan: invalid } as RoomLayout;
    const nested = makeLayout({ designBook: { activeId: 'bad', variants: [{ id: 'bad', name: '原坏块', layout: snapshot }] } });
    expect(parseStoredLayout(nested)).toBeNull(); expect(parseLayoutEventOperations(nested)).toBeNull();
    const legacy = { name: '旧场地', width: 8, height: 6, items: [], floorColor: '#ffffff', productionPlan: invalid };
    expect(parseStoredLayout(legacy)).toBeNull();
  });

  it('retains missing references while refusing ID repairs that would create a false association', () => {
    const source = layout();
    expect(parseStoredLayout(source)!.productionPlan!.estimates[0].objectIds).toEqual(['missing-original-id']);
    const p = plan(); p.acquisitions[0].objectIds = ['new-id-2'];
    const repairedTarget = makeLayout({ productionPlan: p, floors: [makeFloor({ items: [makeItem({ id: 'new-id' }), makeItem({ id: 'new-id' })] })] });
    expect(parseStoredLayout(repairedTarget)).toBeNull();
    p.acquisitions[0].objectIds = ['x'.repeat(MAX_ID_LENGTH)];
    const shortenedTarget = makeLayout({ productionPlan: p, floors: [makeFloor({ items: [makeItem({ id: 'x'.repeat(MAX_ID_LENGTH + 1) })] })] });
    expect(parseStoredLayout(shortenedTarget)).toBeNull();
    p.acquisitions[0].objectIds = [id(90)];
    const ambiguous = makeLayout({ productionPlan: p, floors: [makeFloor({ items: [makeItem({ id: id(90) }), makeItem({ id: id(90).toUpperCase() })] })] });
    expect(parseStoredLayout(ambiguous)).toBeNull();
  });

  it('strips the complete plan from actual compressed shares and nested snapshots without mutating local data', async () => {
    const source = withDesigns(), before = structuredClone(source);
    const exported = layoutForExport(source, true);
    expect(exported).not.toHaveProperty('productionPlan');
    expect(exported.designBook!.variants[0].layout).not.toHaveProperty('productionPlan');
    const result = await encodeShareUrl(source, 'https://example.com/workspace');
    const payload = result.url.split('#layout=2.')[1];
    const raw = inflateRawSync(Buffer.from(payload, 'base64url')).toString('utf8');
    expect(raw).not.toContain('productionPlan'); expect(raw).not.toContain(originalText.trim());
    expect(await decodeShareUrl(new URL(result.url).hash)).toEqual(exported);
    expect(source).toEqual(before);
  });

  it('filters plans on old incoming shares, but rejects damaged root and nested business blocks', async () => {
    const source = withDesigns();
    expect(await decodeShareUrl(legacyHash(source))).toEqual(layoutForExport(source, true));
    const invalid = { ...source, productionPlan: { ...plan(), actualPaidMinor: 0 } };
    expect(await readShareHash(legacyHash(invalid))).toEqual({ ok: false, reason: 'unreadable' });
    await expect(encodeShareUrl(invalid as RoomLayout, 'https://example.com')).rejects.toThrow('制作计划或活动安排无效');
    const nested = structuredClone(source); Object.assign(nested.designBook!.variants[0].layout.productionPlan!, { futureField: true });
    expect(await decodeShareUrl(legacyHash(nested))).toBeNull();
    await expect(encodeShareUrl(nested, 'https://example.com')).rejects.toThrow('制作计划或活动安排无效');
  });
});
