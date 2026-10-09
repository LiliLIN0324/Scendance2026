// Read-only rehearsal: actual editor helpers, memory-only storage, no provider calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';

// Node's strip-only mode cannot load the existing TS parameter properties.
registerHooks({
  resolve(specifier, context, next) {
    const source = specifier.startsWith('@/')
      ? new URL(`../frontend/${specifier.slice(2)}`, import.meta.url).href : specifier;
    try { return next(source, context); }
    catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' && (source.startsWith('.') || source.startsWith('file:')) && !/\.(ts|tsx|js|json)$/.test(source)) {
        return next(`${source}.ts`, context);
      }
      throw error;
    }
  },
  load(url, context, next) {
    if (url.endsWith('.ts')) return { format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
      }).outputText };
    if (url.endsWith('.json') && !context.importAttributes?.type) return {
      format: 'module', shortCircuit: true,
      source: `export default ${JSON.stringify(JSON.parse(readFileSync(new URL(url), 'utf8')))}`,
    };
    return next(url, context);
  },
});
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error('Network access is outside this rehearsal.'); };

const root = new URL('../', import.meta.url);
const editor = new URL('frontend/components/room-organizer/lib/', root);
const { backendSceneToLayout } = await import(new URL('backend-adapter.ts', editor));
const { handoffBasis, effectiveHandoffStatus } = await import(new URL('scene-handoff.ts', editor));
const { operationBasis, operationReview } = await import(new URL('event-operations.ts', editor));
const { saveLayout, parseLayoutJson } = await import(new URL('persistence.ts', editor));
const { STORAGE_KEY } = await import(new URL('constants.ts', editor));
const { encodeShareUrl, decodeShareUrl } = await import(new URL('share.ts', editor));
const { sceneDeliveryJson, deliveryExecution, deliveryMaterials, eventOperationsCsv } = await import(new URL('scene-delivery.ts', editor));
const { assertNoLocalHandoffCloudTransition } = await import(new URL('handoff-cloud-guard.ts', editor));
const { serializeLocalProjectBackup, parseLocalProjectBackupJson } = await import(new URL('frontend/lib/local-project-backup.ts', root));
const { eventOperationsSchema } = await import(new URL('supabase/functions/_shared/event-operations-contract.ts', root));

const objectIds = ['b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002'];
const scene = { schemaVersion: 1, venue: { shape: 'rectangle', width: 8, depth: 6, height: 3, entrances: [] },
  objects: objectIds.map((id, index) => ({ id, materialId: 'chair', position: { x: 2 + index * 3, z: 2 },
    rotation: 0, size: { width: 0.5, depth: 0.5, height: 0.85 }, color: '#ffffff', locked: false, notes: '合成演练物料' })),
  camera: 'overview', lighting: 'neutral' };
const layout = backendSceneToLayout(scene, { name: '合成演练 · 保存与交接核查', projectId: 'backend-loop-rehearsal' });
const example = JSON.parse(readFileSync(new URL('docs/examples/30-person-rehearsal-operations.json', root), 'utf8'));
layout.eventOperations = eventOperationsSchema.parse(example);
const task = layout.eventOperations.tasks[1];
Object.assign(task, { ownerName: '合成演练责任组', acceptance: '演练：核对两件物料的独立身份和尺寸',
  objectIds, plannedStartAt: '2026-10-08T15:30:00Z', plannedEndAt: '2026-10-09T00:30:00+08:00',
  status: 'accepted', evidenceNote: '合成测试说明，不代表现场检查' });
task.reviewedBasis = await operationBasis(layout, task);
for (const [index, item] of layout.floors[0].items.entries()) {
  item.handoff = { ownerName: `合成演练组${index + 1}`, dueDate: '2026-10-08', acceptance: '演练：逐件核对尺寸',
    status: 'accepted', evidenceUrls: [], evidenceNote: '合成说明，不代表真实验收' };
  item.handoff.reviewedBasis = await handoffBasis(layout, item.id, item.handoff);
}
const checks = [];
const passed = name => checks.push({ name, passed: true });
const original = JSON.stringify(layout);
const values = new Map();
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key), key: index => [...values.keys()][index] ?? null,
  get length() { return values.size; } };
assert.equal(saveLayout(layout, storage).ok, true);
const reopened = parseLayoutJson(storage.getItem(STORAGE_KEY));
assert.ok(reopened);
// JSON stores -0 as 0; compare the file representation rather than signed zero.
assert.deepEqual(reopened, JSON.parse(original));
passed('local-save-reopen-preserves-layout-and-execution');

const brief = { event: '合成演练', guests: 30, description: '仅验证数据往返，不是实际客户活动', mustHave: '', allowIdeas: false };
const backupText = serializeLocalProjectBackup(reopened, { state: 'ready', scope: reopened.id, brief: { status: 'present', value: brief } });
const restored = parseLocalProjectBackupJson(backupText);
assert.deepEqual(restored.layout, reopened);
assert.deepEqual(restored.brief, { status: 'present', value: brief });
assert.equal((await operationReview(restored.layout, restored.layout.eventOperations.tasks[1])).status, 'accepted');
assert.equal(await effectiveHandoffStatus(restored.layout, objectIds[0]), 'accepted');
assert.equal(restored.layout.eventOperations.tasks[1].actualStartedAt, null);
assert.equal(restored.layout.eventOperations.tasks[1].actualFinishedAt, null);
passed('editable-backup-preserves-brief-bases-and-unknown-actual-times');

const snapshot = { id: 'backend-rehearsal-delivery', generatedAt: '2026-10-07T08:00:00Z' };
const deliveryText = await sceneDeliveryJson(restored.layout, snapshot);
const delivery = JSON.parse(deliveryText);
assert.deepEqual(delivery.snapshot, snapshot);
assert.equal(delivery.operations.dataKind, 'rehearsal');
assert.equal(delivery.operations.tasks.length, 6);
assert.equal(delivery.execution.length, 2);
assert.equal(delivery.materials.length, 1);
assert.equal(delivery.materials[0].quantity, 2);
assert.equal(delivery.operations.tasks[1].effectiveStatus, 'accepted');
assert.equal('reviewedBasis' in delivery.operations.tasks[1], false);
assert.equal('reviewedBasis' in delivery.execution[0], false);
assert.throws(() => parseLocalProjectBackupJson(deliveryText), /交付文件/);
passed('delivery-retains-identity-and-effective-status-without-pretending-to-be-backup');

const shared = await encodeShareUrl(restored.layout, 'https://fixture.invalid/');
const publicLayout = await decodeShareUrl(new URL(shared.url).hash);
assert.ok(publicLayout);
assert.equal(publicLayout.eventOperations, undefined);
assert.ok(publicLayout.floors[0].items.every(item => item.handoff === undefined));
assert.equal(JSON.stringify(layout), original);
passed('public-share-strips-internal-records-without-mutating-source');
assert.throws(() => assertNoLocalHandoffCloudTransition(restored.layout), /当前草稿已保留/);
passed('cloud-transition-refuses-to-drop-local-execution');

const changed = structuredClone(restored.layout);
changed.floors[0].items[0].width = 0.6;
const execution = await deliveryExecution(changed);
assert.equal(execution.find(item => item.objectId === objectIds[0]).effectiveStatus, 'needs_review');
assert.equal(execution.find(item => item.objectId === objectIds[1]).effectiveStatus, 'accepted');
assert.equal(deliveryMaterials(changed).length, 2);
assert.equal((await operationReview(changed, changed.eventOperations.tasks[1])).status, 'needs_review');
passed('one-instance-change-invalidates-linked-reviews-and-splits-procurement');

const reassigned = structuredClone(restored.layout);
const workOrder = reassigned.floors[0].items[0].handoff;
workOrder.ownerName = '合成演练新责任组'; workOrder.dueDate = '2026-10-12';
assert.equal(await effectiveHandoffStatus(reassigned, objectIds[0]), 'needs_review');
assert.equal((await deliveryExecution(reassigned))[0].effectiveStatus, 'needs_review');
assert.equal(workOrder.evidenceNote, restored.layout.floors[0].items[0].handoff.evidenceNote);
workOrder.reviewedBasis = await handoffBasis(reassigned, objectIds[0], workOrder);
assert.equal(await effectiveHandoffStatus(reassigned, objectIds[0]), 'accepted');
passed('responsibility-change-requires-explicit-handoff-reconfirmation');

const removed = structuredClone(restored.layout);
removed.floors[0].items = [removed.floors[0].items[1], { ...removed.floors[0].items[0], id: 'b1000000-0000-4000-8000-000000000003' }];
const review = await operationReview(removed, removed.eventOperations.tasks[1]);
assert.deepEqual(review, { status: 'needs_review', missingObjectIds: [objectIds[0]] });
const csv = await eventOperationsCsv(removed, snapshot);
assert.ok(csv.startsWith('\uFEFF'));
assert.ok(csv.includes('需复核') && csv.includes(objectIds[0]) && csv.includes('演练') && csv.includes(snapshot.id));
passed('same-name-replacement-keeps-missing-reference-visible-in-task-export');

const deniedStorage = { ...storage, setItem() { throw new DOMException('Synthetic blocked storage', 'SecurityError'); } };
const warn = console.warn; console.warn = () => {};
let failedSave;
try { failedSave = saveLayout(changed, deniedStorage); } finally { console.warn = warn; }
assert.equal(failedSave.ok, false);
assert.deepEqual(parseLayoutJson(storage.getItem(STORAGE_KEY)), reopened);
passed('failed-storage-write-retains-prior-save');

assert.equal(networkAttempts, 0);
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), dataKind: 'synthetic-rehearsal', checks,
  scope: 'Actual pure helpers with memory-only storage; UI restoration transaction, browser persistence and customer acceptance remain unverified.',
  networkCalls: networkAttempts, userDataChanged: false }, null, 2));
