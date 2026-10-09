import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSourceRecord } from '../../../lib/source-storage';
import { backendSceneToLayout, layoutToBackendScene } from './backend-adapter';
import { assertNoLocalHandoffCloudTransition, assertNoLocalRecordsCloudTransition, hasLocalHandoff, LOCAL_CHECKIN_CLOUD_MESSAGE, LOCAL_HANDOFF_CLOUD_MESSAGE, LOCAL_RECORDS_READ_MESSAGE } from './handoff-cloud-guard';

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
});
