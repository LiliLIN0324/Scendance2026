import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSourceRecord } from '../../../lib/source-storage';
import { backendSceneToLayout, layoutToBackendScene } from './backend-adapter';
import { assertNoLocalHandoffCloudTransition, assertNoLocalRecordsCloudTransition, classifyCloudGuard, collectCloudGuardRefs, hasLocalHandoff, LOCAL_CHECKIN_CLOUD_MESSAGE, LOCAL_HANDOFF_CLOUD_MESSAGE, LOCAL_RECORDS_READ_MESSAGE } from './handoff-cloud-guard';

vi.mock('../../../lib/source-storage',()=>({readSourceRecord:vi.fn(),updateSourceForm:vi.fn()}));
beforeEach(()=>{vi.mocked(readSourceRecord).mockReset().mockResolvedValue(undefined);});

const scene = { schemaVersion: 1 as const, venue: { width: 12, depth: 10, height: 3, shape: 'rectangle' as const, entrances: [] }, objects: [], camera: 'overview' as const, lighting: 'neutral' as const };
const emptyOperations = { schemaVersion: 1 as const, dataKind: 'unspecified' as const, tasks: [] };

describe('local execution cloud boundary', () => {
  it('protects an empty activity document without changing general scene conversion', () => {
    const layout = { ...backendSceneToLayout(scene), eventOperations: emptyOperations };
    expect(hasLocalHandoff(layout)).toBe(true);
    expect(() => assertNoLocalHandoffCloudTransition(layout)).toThrow(LOCAL_HANDOFF_CLOUD_MESSAGE);
    expect(layoutToBackendScene(layout)).toEqual(scene);
  });

  it('protects activity documents in nested design snapshots', () => {
    const leaf = { ...backendSceneToLayout(scene), eventOperations: emptyOperations };
    const nested = { ...backendSceneToLayout(scene), designBook: { activeId: 'leaf', variants: [{ id: 'leaf', name: '子方案', layout: leaf }] } };
    const layout = { ...backendSceneToLayout(scene), designBook: { activeId: 'nested', variants: [{ id: 'nested', name: '方案', layout: nested }] } };
    expect(() => assertNoLocalHandoffCloudTransition(layout)).toThrow(LOCAL_HANDOFF_CLOUD_MESSAGE);
    expect(leaf.eventOperations).toBe(emptyOperations);
  });

  it('allows old drafts with no execution information', () => {
    const layout = backendSceneToLayout(scene);
    expect(hasLocalHandoff(layout)).toBe(false);
    expect(() => assertNoLocalHandoffCloudTransition(layout)).not.toThrow();
  });
  it('checks the old synchronous guard before reading independent records',async()=>{
    const layout={...backendSceneToLayout(scene,{projectId:'house-guard-trial'}),eventOperations:emptyOperations};
    await expect(assertNoLocalRecordsCloudTransition(layout)).rejects.toThrow(LOCAL_HANDOFF_CLOUD_MESSAGE);
    expect(readSourceRecord).not.toHaveBeenCalled();
  });
  it('protects an independent empty ledger after the production plan was removed',async()=>{
    const layout=backendSceneToLayout(scene,{projectId:'house-guard-trial'});
    vi.mocked(readSourceRecord).mockResolvedValue({schemaVersion:1,projectId:layout.id!,dataKind:'rehearsal',sheets:[]});
    expect(hasLocalHandoff(layout)).toBe(false);
    await expect(assertNoLocalRecordsCloudTransition(layout)).rejects.toThrow(LOCAL_CHECKIN_CLOUD_MESSAGE);
    expect(readSourceRecord).toHaveBeenCalledWith(['material-checkins','house-guard-trial']);
    expect(layoutToBackendScene(layout)).toEqual(scene);
  });
  it('refuses damaged storage and read failures without pretending the ledger is absent',async()=>{
    const layout=backendSceneToLayout(scene,{projectId:'house-guard-trial'});
    vi.mocked(readSourceRecord).mockResolvedValue({schemaVersion:1,projectId:layout.id!,dataKind:'rehearsal',sheets:'damaged'});
    await expect(assertNoLocalRecordsCloudTransition(layout)).rejects.toThrow(LOCAL_RECORDS_READ_MESSAGE);
    vi.mocked(readSourceRecord).mockRejectedValue(new Error('演练读取失败'));
    await expect(assertNoLocalRecordsCloudTransition(layout)).rejects.toThrow(LOCAL_RECORDS_READ_MESSAGE);
  });
  it('allows a known project only when the latest independent storage is absent',async()=>{
    const layout=backendSceneToLayout(scene,{projectId:'house-guard-trial'});
    await expect(assertNoLocalRecordsCloudTransition(layout)).resolves.toBeUndefined();
    expect(readSourceRecord).toHaveBeenCalledWith(['material-checkins','house-guard-trial']);
    vi.mocked(readSourceRecord).mockResolvedValue({schemaVersion:1,projectId:layout.id!,dataKind:'unspecified',sheets:[]});
    await expect(assertNoLocalRecordsCloudTransition(layout)).rejects.toThrow(LOCAL_CHECKIN_CLOUD_MESSAGE);
  });
  it('never looks up a public local fallback for a scene without a real ID',async()=>{
    await expect(assertNoLocalRecordsCloudTransition(backendSceneToLayout(scene))).resolves.toBeUndefined();
    expect(readSourceRecord).not.toHaveBeenCalled();
  });
  it('blocks a pending operations ref even with no local ledger',async()=>{
    const layout=backendSceneToLayout(scene,{projectId:'house-guard-trial'});
    await expect(assertNoLocalRecordsCloudTransition(layout,'house-guard-trial',{operationsRef:'op-1'})).rejects.toThrow(LOCAL_HANDOFF_CLOUD_MESSAGE);
  });
  it('blocks a pending plan ref and a pending scan ref independently',async()=>{
    const layout=backendSceneToLayout(scene,{projectId:'house-guard-trial'});
    await expect(assertNoLocalRecordsCloudTransition(layout,'house-guard-trial',{planRef:'plan-1'})).rejects.toThrow(LOCAL_HANDOFF_CLOUD_MESSAGE);
    await expect(assertNoLocalRecordsCloudTransition(layout,'house-guard-trial',{scan:{assetId:'scan-1'}})).rejects.toThrow(LOCAL_HANDOFF_CLOUD_MESSAGE);
  });
  it('prefers the ledger message when both a pending ref and a local ledger are present',async()=>{
    const layout=backendSceneToLayout(scene,{projectId:'house-guard-trial'});
    vi.mocked(readSourceRecord).mockResolvedValue({schemaVersion:1,projectId:layout.id!,dataKind:'rehearsal',sheets:[]});
    await expect(assertNoLocalRecordsCloudTransition(layout,'house-guard-trial',{operationsRef:'op-1'})).rejects.toThrow(LOCAL_CHECKIN_CLOUD_MESSAGE);
  });
  it('passes with neither pending refs nor a local ledger',async()=>{
    const layout=backendSceneToLayout(scene,{projectId:'house-guard-trial'});
    await expect(assertNoLocalRecordsCloudTransition(layout,'house-guard-trial',{})).resolves.toBeUndefined();
  });
  it('blocks pending refs on an ID-less draft without reading a ledger',async()=>{
    vi.mocked(readSourceRecord).mockClear();
    await expect(assertNoLocalRecordsCloudTransition(backendSceneToLayout(scene),undefined,{planRef:'plan-1'})).rejects.toThrow(LOCAL_HANDOFF_CLOUD_MESSAGE);
    expect(readSourceRecord).not.toHaveBeenCalled();
  });
});

describe('cloud guard classification helper (T1 E5)', () => {
  it('flags non-empty refs as pending and blocks', () => {
    const result = classifyCloudGuard(
      { operationsRef: 'op-1', planRef: 'plan-1', scan: { assetId: 'scan-1', name: '场地' } },
      false,
    );
    expect(result.pendingRefs).toEqual(['operations', 'plan', 'scan']);
    expect(result.hasLocalLedger).toBe(false);
    expect(result.shouldBlock).toBe(true);
  });

  it('blocks when a local ledger is present, whether passed as boolean or array', () => {
    expect(classifyCloudGuard({}, true).hasLocalLedger).toBe(true);
    expect(classifyCloudGuard({}, true).shouldBlock).toBe(true);
    expect(classifyCloudGuard({}, [{ sheet: 'a' }]).hasLocalLedger).toBe(true);
    expect(classifyCloudGuard({}, []).hasLocalLedger).toBe(false);
  });

  it('passes when there are no refs and no local ledger', () => {
    const result = classifyCloudGuard({}, false);
    expect(result.pendingRefs).toEqual([]);
    expect(result.hasLocalLedger).toBe(false);
    expect(result.shouldBlock).toBe(false);
  });

  it('treats blank or whitespace refs as absent, never pending', () => {
    const result = classifyCloudGuard(
      { operationsRef: '', planRef: '   ', scan: { assetId: '  ', name: '' } },
      false,
    );
    expect(result.pendingRefs).toEqual([]);
    expect(result.shouldBlock).toBe(false);
  });

  it('mixes one pending ref with an empty ledger independently', () => {
    const result = classifyCloudGuard({ planRef: 'plan-1' }, false);
    expect(result.pendingRefs).toEqual(['plan']);
    expect(result.shouldBlock).toBe(true);
  });
});

describe('collectCloudGuardRefs', () => {
  it('collects plan refs first and fills empty slots from variants', () => {
    const refs = collectCloudGuardRefs({
      plan: { operationsRef: 'op-plan', scan: { assetId: 'scan-plan', name: '场地' } },
      variants: [{ id: 'v1', name: '提案', layout: backendSceneToLayout(scene), planRef: 'plan-variant' }],
    });
    expect(refs).toEqual({ operationsRef: 'op-plan', planRef: 'plan-variant', scan: { assetId: 'scan-plan', name: '场地' } });
  });

  it('trims blank refs and drops whitespace-only slots', () => {
    const refs = collectCloudGuardRefs({
      plan: { operationsRef: '   ', planRef: '  plan-1  ', scan: { assetId: '  ', name: '' } },
      variants: [{ id: 'v2', name: '提案', layout: backendSceneToLayout(scene), operationsRef: 'op-variant' }],
    });
    expect(refs).toEqual({ operationsRef: 'op-variant', planRef: 'plan-1' });
  });

  it('does not overwrite a plan slot from a variant when the plan already has it', () => {
    const refs = collectCloudGuardRefs({
      plan: { planRef: 'plan-plan' },
      variants: [{ id: 'v3', name: '提案', layout: backendSceneToLayout(scene), planRef: 'plan-variant' }],
    });
    expect(refs.planRef).toBe('plan-plan');
  });

  it('returns an empty input when plan and variants carry no refs', () => {
    expect(collectCloudGuardRefs({ plan: null, variants: [] })).toEqual({});
    expect(collectCloudGuardRefs({})).toEqual({});
  });
});
