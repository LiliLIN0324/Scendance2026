import { z } from 'zod';
import { uuid } from '../../supabase/functions/_shared/domain';
import { listSourceRecords, readSourceRecord, updateSourceForm } from './source-storage';

const nonempty = z.string().refine(value => value.trim().length > 0);
const identitySchema = z.object({ localActivityId: nonempty, userId: nonempty, apiUrl: nonempty });
const bindingSchema = z.strictObject({ ...identitySchema.shape, version: z.literal(1), cloudProjectId: uuid });
export type GeometryWorkbenchBinding = z.infer<typeof bindingSchema>;
export type GeometryWorkbenchIdentity = Pick<GeometryWorkbenchBinding, 'localActivityId' | 'userId' | 'apiUrl'>;
const BINDING_NAMESPACE = 'geometry-workbench-binding';

const failureMessages = {
  GEOMETRY_BINDING_INVALID: '本机场地关联记录无法完整读取，原记录已保留，请先核对活动资料。',
  GEOMETRY_BINDING_READ_FAILED: '本机场地关联记录读取失败，请稍后重试。',
  GEOMETRY_BINDING_WRITE_FAILED: '本机场地关联记录保存失败，请稍后重试。',
  GEOMETRY_BINDING_CONFLICT: '当前活动已关联另一云端场地，原关联已保留，请先核对后再继续。',
};
class GeometryWorkbenchBindingError extends Error {
  constructor(readonly code: keyof typeof failureMessages) { super(failureMessages[code]); }
}

export function geometryWorkbenchBindingKey(identity: GeometryWorkbenchIdentity): [string, string] {
  const result = identitySchema.safeParse(identity);
  if (!result.success) throw new GeometryWorkbenchBindingError('GEOMETRY_BINDING_INVALID');
  return [BINDING_NAMESPACE, JSON.stringify([result.data.apiUrl, result.data.userId, result.data.localActivityId])];
}

function checkedBinding(value: unknown, key: [string, string]): GeometryWorkbenchBinding | undefined {
  if (value === undefined) return undefined;
  const result = bindingSchema.safeParse(value);
  if (!result.success || geometryWorkbenchBindingKey(result.data)[1] !== key[1]) {
    throw new GeometryWorkbenchBindingError('GEOMETRY_BINDING_INVALID');
  }
  return result.data;
}

export async function readGeometryWorkbenchBinding(identity: GeometryWorkbenchIdentity): Promise<GeometryWorkbenchBinding | undefined> {
  const key = geometryWorkbenchBindingKey(identity);
  let value: unknown;
  try { value = await readSourceRecord<unknown>(key); }
  catch { throw new GeometryWorkbenchBindingError('GEOMETRY_BINDING_READ_FAILED'); }
  return checkedBinding(value, key);
}

/** 本机活动归档用的是活动编号，云端项目用的是项目编号：账户面板要按团队过滤，就得一次把这用户名下所有关联都读出来。 */
export async function listGeometryWorkbenchBindings(identity: Pick<GeometryWorkbenchIdentity, 'userId' | 'apiUrl'>): Promise<GeometryWorkbenchBinding[]> {
  const records = await listSourceRecords<unknown>(BINDING_NAMESPACE);
  const bindings: GeometryWorkbenchBinding[] = [];
  for (const record of records) {
    let scope: unknown;
    try { scope = JSON.parse(record.key[1]); } catch { continue; }
    if (!Array.isArray(scope) || scope[0] !== identity.apiUrl || scope[1] !== identity.userId) continue;
    try {
      const binding = checkedBinding(record.value, geometryWorkbenchBindingKey({ ...identity, localActivityId: String(scope[2]) }));
      if (binding) bindings.push(binding);
    } catch { /* 一条坏记录不能带走整份名单。 */ }
  }
  return bindings;
}

export async function writeGeometryWorkbenchBinding(binding: GeometryWorkbenchBinding): Promise<GeometryWorkbenchBinding> {
  const key = geometryWorkbenchBindingKey(binding), proposal = checkedBinding(binding, key);
  if (!proposal) throw new GeometryWorkbenchBindingError('GEOMETRY_BINDING_INVALID');
  try {
    return await updateSourceForm(key, value => {
      const current = checkedBinding(value, key);
      if (current && current.cloudProjectId !== proposal.cloudProjectId) {
        throw new GeometryWorkbenchBindingError('GEOMETRY_BINDING_CONFLICT');
      }
      return current ?? proposal;
    });
  } catch (error) {
    if (error instanceof GeometryWorkbenchBindingError) throw error;
    throw new GeometryWorkbenchBindingError('GEOMETRY_BINDING_WRITE_FAILED');
  }
}
