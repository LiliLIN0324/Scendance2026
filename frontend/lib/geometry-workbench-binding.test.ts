import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  geometryWorkbenchBindingKey, readGeometryWorkbenchBinding, writeGeometryWorkbenchBinding,
  type GeometryWorkbenchBinding, type GeometryWorkbenchIdentity,
} from './geometry-workbench-binding';
import { readSourceRecord, updateSourceForm } from './source-storage';

vi.mock('./source-storage', () => ({ readSourceRecord: vi.fn(), updateSourceForm: vi.fn() }));
const records = new Map<string, unknown>();
const binding: GeometryWorkbenchBinding = {
  version: 1, localActivityId: 'house-local', cloudProjectId: 'ab900000-0000-4000-8000-000000000001',
  userId: 'owner', apiUrl: 'https://scene.example/functions/v1',
};
const address = (identity: GeometryWorkbenchIdentity) => JSON.stringify(geometryWorkbenchBindingKey(identity));
beforeEach(() => {
  records.clear(); vi.resetAllMocks();
  vi.mocked(readSourceRecord).mockImplementation(async key => structuredClone(records.get(JSON.stringify(key))) as never);
  vi.mocked(updateSourceForm).mockImplementation(async (key, update) => {
    const keyText = JSON.stringify(key), next = update(structuredClone(records.get(keyText)));
    records.set(keyText, structuredClone(next));
    return structuredClone(next) as never;
  });
});

describe('geometry workbench binding storage', () => {
  it('uses the exact service, account and local activity in a compound key', () => {
    expect(geometryWorkbenchBindingKey(binding)).toEqual([
      'geometry-workbench-binding', JSON.stringify([binding.apiUrl, binding.userId, binding.localActivityId]),
    ]);
    const identities = [binding, { ...binding, apiUrl: `${binding.apiUrl}/` }, { ...binding, userId: 'other' },
      { ...binding, localActivityId: 'house-other' }, { ...binding, apiUrl: binding.apiUrl.toUpperCase() }];
    expect(new Set(identities.map(address)).size).toBe(identities.length);
    expect(address({ apiUrl: 'service', userId: 'user,activity', localActivityId: 'local' }))
      .not.toBe(address({ apiUrl: 'service,user', userId: 'activity', localActivityId: 'local' }));
  });

  it('returns absence without creating a binding or borrowing another scope', async () => {
    expect(await readGeometryWorkbenchBinding(binding)).toBeUndefined();
    await writeGeometryWorkbenchBinding(binding);
    for (const identity of [{ ...binding, apiUrl: `${binding.apiUrl}/` }, { ...binding, userId: 'other' },
      { ...binding, localActivityId: 'house-other' }]) {
      expect(await readGeometryWorkbenchBinding(identity)).toBeUndefined();
    }
    expect(records.size).toBe(1);
  });

  it('persists exactly the five fields and accepts the same binding repeatedly', async () => {
    const input = { ...binding };
    expect(await writeGeometryWorkbenchBinding(input)).toEqual(binding);
    expect(await writeGeometryWorkbenchBinding(input)).toEqual(binding);
    expect(await readGeometryWorkbenchBinding(input)).toEqual(binding);
    expect(Object.keys(records.get(address(binding)) as object).sort()).toEqual([
      'apiUrl', 'cloudProjectId', 'localActivityId', 'userId', 'version',
    ]);
    input.cloudProjectId = 'ab900000-0000-4000-8000-000000000002';
    expect(records.get(address(binding))).toEqual(binding);
    expect(updateSourceForm).toHaveBeenCalledWith(geometryWorkbenchBindingKey(binding), expect.any(Function));
  });

  it.each([
    null, [], {}, { ...binding, version: 2 }, { ...binding, version: '1' }, { ...binding, cloudProjectId: 'not-a-uuid' },
    { ...binding, localActivityId: '' }, { ...binding, localActivityId: ' ' }, { ...binding, userId: '' },
    { ...binding, apiUrl: ' ' }, { ...binding, apiUrl: 1 }, { ...binding, accessToken: 'private-token' },
    { ...binding, lease: {} }, { ...binding, cloudProjectId: undefined },
  ])('rejects invalid records without treating them as absence or overwriting them: %#', async value => {
    records.set(address(binding), value);
    await expect(readGeometryWorkbenchBinding(binding)).rejects.toMatchObject({ code: 'GEOMETRY_BINDING_INVALID' });
    await expect(writeGeometryWorkbenchBinding(binding)).rejects.toMatchObject({ code: 'GEOMETRY_BINDING_INVALID' });
    expect(records.get(address(binding))).toEqual(value);
  });

  it.each(['localActivityId', 'userId', 'apiUrl'] as const)('rejects a stored record whose %s differs from its key', async field => {
    const mismatched = { ...binding, [field]: `${binding[field]}-other` };
    records.set(address(binding), mismatched);
    await expect(readGeometryWorkbenchBinding(binding)).rejects.toMatchObject({ code: 'GEOMETRY_BINDING_INVALID' });
    await expect(writeGeometryWorkbenchBinding(binding)).rejects.toMatchObject({ code: 'GEOMETRY_BINDING_INVALID' });
    expect(records.get(address(binding))).toEqual(mismatched);
  });

  it.each(['localActivityId', 'userId', 'apiUrl'] as const)('rejects an empty %s before accessing storage', async field => {
    const invalid = { ...binding, [field]: ' ' };
    expect(() => geometryWorkbenchBindingKey(invalid)).toThrow();
    await expect(readGeometryWorkbenchBinding(invalid)).rejects.toMatchObject({ code: 'GEOMETRY_BINDING_INVALID' });
    await expect(writeGeometryWorkbenchBinding(invalid)).rejects.toMatchObject({ code: 'GEOMETRY_BINDING_INVALID' });
    expect(readSourceRecord).not.toHaveBeenCalled(); expect(updateSourceForm).not.toHaveBeenCalled();
  });

  it('rejects malformed proposals before writing, including extra private fields', async () => {
    for (const invalid of [{ ...binding, version: 2 }, { ...binding, cloudProjectId: '' },
      { ...binding, refreshToken: 'private-token' }]) {
      await expect(writeGeometryWorkbenchBinding(invalid as GeometryWorkbenchBinding))
        .rejects.toMatchObject({ code: 'GEOMETRY_BINDING_INVALID' });
    }
    expect(updateSourceForm).not.toHaveBeenCalled(); expect(records.size).toBe(0);
  });

  it('reports read failures separately without exposing the storage error', async () => {
    vi.mocked(readSourceRecord).mockRejectedValueOnce(new Error('private-token'));
    const result = readGeometryWorkbenchBinding(binding);
    await expect(result).rejects.toMatchObject({ code: 'GEOMETRY_BINDING_READ_FAILED' });
    await expect(result).rejects.toThrow('读取失败');
    await expect(result).rejects.not.toThrow('private-token');
    expect(updateSourceForm).not.toHaveBeenCalled();
  });

  it('reports write failures separately and retains the saved binding', async () => {
    records.set(address(binding), { ...binding });
    vi.mocked(updateSourceForm).mockRejectedValueOnce(new Error('private-token'));
    const result = writeGeometryWorkbenchBinding(binding);
    await expect(result).rejects.toMatchObject({ code: 'GEOMETRY_BINDING_WRITE_FAILED' });
    await expect(result).rejects.toThrow('保存失败');
    await expect(result).rejects.not.toThrow('private-token');
    expect(records.get(address(binding))).toEqual(binding);
  });

  it('checks conflicts inside the update transaction and preserves the first binding', async () => {
    const other = { ...binding, cloudProjectId: 'ab900000-0000-4000-8000-000000000002' };
    const results = await Promise.allSettled([writeGeometryWorkbenchBinding(binding), writeGeometryWorkbenchBinding(other)]);
    expect(results[0]).toEqual({ status: 'fulfilled', value: binding });
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'GEOMETRY_BINDING_CONFLICT' } });
    expect(records.get(address(binding))).toEqual(binding);
    expect(readSourceRecord).not.toHaveBeenCalled();
  });
});
