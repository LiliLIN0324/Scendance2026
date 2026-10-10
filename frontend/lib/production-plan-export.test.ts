// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handoffSchema } from '../../supabase/functions/_shared/delivery-contract';
import { sceneSchema } from '../../supabase/functions/_shared/domain';
import { eventOperationsSchema } from '../../supabase/functions/_shared/event-operations-contract';
import {
  materialCheckinLedgerSchema, materialCheckinSheetSchema, materialCheckinSummary, projectMaterialCheckinEvents,
  type MaterialCheckinLedger, type MaterialCheckinSheet, type MaterialCheckinEvent,
} from '../../supabase/functions/_shared/material-checkin-contract';
import { productionPlanSchema, type ProductionPlan } from '../../supabase/functions/_shared/production-plan-contract';
import { makeFloor, makeItem, makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import * as operations from '../components/room-organizer/lib/event-operations';
import { operationBasis, operationReview, OPERATION_STATUS_LABELS } from '../components/room-organizer/lib/event-operations';
import * as handoffs from '../components/room-organizer/lib/scene-handoff';
import { handoffBasis } from '../components/room-organizer/lib/scene-handoff';
import { productionPlanHandoffHtml } from './production-plan-export';
import { createProjectReviewSnapshot, projectReviewHtml } from './project-review';
import type { BackupBrief } from './local-project-backup';
import type { RoomLayout } from '../components/room-organizer/lib/types';

const id = (n: number) => `ab100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const snapshot = { id: 'internal-handoff-001', generatedAt: '2026-10-09T01:30:15.123Z' };
function plan(): ProductionPlan {
  return productionPlanSchema.parse({ dataKind: 'rehearsal', budget: { limitMinor: 500000,
    scopeNote: '假设范围：岗位与取得运输', basisNote: '演练取舍，不是客户报价' },
    staffing: [{ id: id(10), roleName: '签到岗位', shiftLabel: '上午班', headcount: 2, sourceType: 'outsourced',
      sourceName: '内部协作方丙', plannedArrivalAt: '2026-10-08T21:30:15.123Z', plannedDepartureAt: '2026-10-09T06:00:00+08:00', taskIds: [id(20)] }],
    acquisitions: [{ id: id(11), title: '签到椅取得', method: 'rental', supplierName: '内部供应方乙',
      specificationNote: '实物规格须按供应方清单核对', sourceNote: '内部来源记录：纸面清单待核',
      transportScope: '运输范围及装卸窗口待确认', installationScope: '安装位置与固定方式待确认', taskIds: [id(20)], objectIds: [id(30), id(31)] }],
    estimates: [{ id: id(12), title: '岗位人工估算', amountMinor: 125050, basisNote: '演练人工估算依据', taskIds: [id(20)] },
      { id: id(13), title: '未定运输费', amountMinor: null, objectIds: [id(30)] },
      { id: id(14), title: '已录入零额', amountMinor: 0, basisNote: '演练零额仍有依据' }],
  });
}
function layout(): RoomLayout {
  return makeLayout({ id: id(1), name: '假设演练内部执行', productionPlan: plan(), roof: { style: 'none' },
    floors: [makeFloor({ name: '活动层', items: [
      makeItem({ id: id(30), name: '同名椅', width: 0.5, depth: 0.5, height: 0.85, notes: 'PRIVATE_ITEM_NOTE', price: 98765,
        assetId: id(99), glbUrl: 'https://private.example/model.glb?token=PRIVATE_TOKEN' }),
      makeItem({ id: id(31), name: '同名椅', width: 0.6, depth: 0.6, height: 0.9 }),
    ] })], eventOperations: eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [{ id: id(20), title: '签到台布置',
      phase: 'setup', ownerName: '任务负责人甲', contractorName: '任务承接方丁', acceptance: '按位置和规格清单逐件核对',
      objectIds: [id(30), id(31)], plannedStartAt: '2026-10-09T06:00:00+08:00', plannedEndAt: '2026-10-09T07:00:00+08:00' }] }),
  });
}
const doc = async (source: RoomLayout = layout(), ledger?: MaterialCheckinLedger) => new DOMParser().parseFromString(await productionPlanHandoffHtml(source, snapshot, ledger), 'text/html');
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function section(document: Document, heading: string): HTMLElement {
  return [...document.querySelectorAll('section')].find(value => value.querySelector('h2')?.textContent === heading)!;
}
function taskRow(document: Document): HTMLTableRowElement {
  return [...section(document, '明确关联的活动任务').querySelectorAll<HTMLTableRowElement>('tbody tr')].find(row => row.textContent?.includes('签到台布置'))!;
}
async function acceptedLayout(): Promise<RoomLayout> {
  const source = layout(); const task = source.eventOperations!.tasks[0];
  task.status = 'accepted'; task.evidenceNote = '演练现场按原规格和摆位点清，确认说明仍保留。';
  task.reviewedBasis = await operationBasis(source, task);
  return source;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function checkPayload(quantity: number | null, kind: 'receive' | 'return', checkState: 'pending' | 'checked' | 'disputed' = 'checked') {
  return { batchRef: kind === 'receive' ? '演练收取批次' : '演练退回批次', quantity, checkState,
    occurredAt: kind === 'receive' ? '2026-10-09T09:00:00+08:00' : '2026-10-09T17:00:00+08:00',
    fromPartyName: kind === 'receive' ? '内部供应方乙' : '演练执行方A',
    toPartyName: kind === 'receive' ? '演练执行方A' : '内部供应方乙',
    evidenceNote: kind === 'receive' ? '演练收28件，差额原因待核' : '演练退26件，差额原因待核',
    evidenceUrls: [kind === 'receive' ? 'https://evidence.example/receipt.jpg' : 'https://evidence.example/return.jpg'] };
}
function checkEvent(number: number, kind: 'receive' | 'return', quantity: number | null,
  checkState: 'pending' | 'checked' | 'disputed' = 'checked'): MaterialCheckinEvent {
  return { id: id(number), kind, ...checkPayload(quantity, kind, checkState),
    recordedAt: kind === 'receive' ? '2026-10-09T09:05:00+08:00' : '2026-10-09T17:05:00+08:00', recordedBy: '演练记录人丙' };
}
function checkSheet(seed = 200, unit: 'piece' | 'set' = 'piece'): MaterialCheckinSheet {
  return materialCheckinSheetSchema.parse({ id: id(seed), acquisitionId: id(11), unit,
    acquisitionSnapshot: { title: '签到椅取得', supplierName: '内部供应方乙', specificationNote: '实物规格须按供应方清单核对' },
    agreements: [{ id: id(seed + 1), agreedQuantity: 30, basisNote: '演练约定30件', recordedAt: '2026-10-09T08:00:00+08:00', recordedBy: '演练约定记录人' }],
    events: [checkEvent(seed + 10, 'receive', 28), checkEvent(seed + 11, 'return', 26)],
  });
}
function checkLedger(sheets: MaterialCheckinSheet[] = [checkSheet()]): MaterialCheckinLedger {
  return materialCheckinLedgerSchema.parse({ projectId: id(1), dataKind: 'rehearsal', sheets });
}
function movement(sheet: MaterialCheckinSheet, kind: 'receive' | 'return'): Extract<MaterialCheckinEvent, { kind: 'receive' | 'return' }> {
  const value = sheet.events.find(event => event.kind === kind);
  if (!value || (value.kind !== 'receive' && value.kind !== 'return')) throw new Error('Missing movement fixture');
  return value;
}
function quantityArticles(document: Document): HTMLElement[] {
  return [...section(document, '数量点验').querySelectorAll<HTMLElement>('article')];
}
function quantityValue(article: HTMLElement, label: string): string {
  const row = [...article.querySelector('table')!.querySelectorAll('tbody tr')].find(row => row.children[0].textContent === label);
  if (!row) throw new Error(`Missing quantity row: ${label}`);
  return row.children[1].textContent!;
}

// File-level checks do not replace a real editor review, download or print acceptance.
describe('internal production-plan handoff HTML', () => {
  it('prints real planning fields, internal parties, source, scopes and explicit task details in one standalone file', async () => {
    const document = (await doc()); const text = document.body.textContent!;
    for (const value of ['假设演练', '签到岗位', '上午班', '2 人（需求）', '外部协作', '内部协作方丙',
      '2026-10-09 05:30:15.123', '实物规格须按供应方清单核对', '内部供应方乙', '纸面清单待核',
      '运输范围及装卸窗口待确认', '安装位置与固定方式待确认', '任务负责人甲', '任务承接方丁',
      '按位置和规格清单逐件核对', '¥1250.50', '已知金额小计：¥1250.50', '已录入估算合计：待确认', '¥0.00']) expect(text).toContain(value);
    expect(text).toContain('不表示人员已落实或已到场');
    expect(text).toContain('场景模型不是库存');
    expect(text).toContain('估算不是供应商报价、已发生费用、付款或收款');
    expect(document.querySelector('footer')!.textContent).toContain('交接编号：internal-handoff-001');
    expect(document.querySelector('details')!.hasAttribute('open')).toBe(false);
  });

  it('is detached output and neither mutates source nor automatically includes model URLs, prices, images or item notes', async () => {
    const source = layout(); source.floorPlanImage = 'data:image/png;base64,PRIVATE_PHOTO';
    Object.assign(source, { accessToken: 'PRIVATE_ACCOUNT_TOKEN' });
    const before = JSON.stringify(source); const html = await productionPlanHandoffHtml(source, snapshot);
    expect(JSON.stringify(source)).toBe(before);
    for (const privateValue of ['PRIVATE_', '98765', 'private.example', 'reviewedBasis']) expect(html).not.toContain(privateValue);
    source.productionPlan!.staffing[0].roleName = '后改岗位';
    expect(html).not.toContain('后改岗位');
  });

  it('keeps unknown and zero distinct and does not sum an empty or all-unknown estimate block as free', async () => {
    const source = layout();
    source.productionPlan = productionPlanSchema.parse({ staffing: [{ id: id(10), roleName: '零人岗位', headcount: 0 }],
      budget: { limitMinor: 0, scopeNote: '零上限覆盖范围', basisNote: '零上限人工依据' },
      estimates: [{ id: id(12), title: '零额', amountMinor: 0, basisNote: '零额依据' }, { id: id(13), title: '未知额' }] });
    const mixed = (await doc(source)).body.textContent!;
    expect(mixed).toContain('0 人（需求）'); expect(mixed).toContain('已知金额小计：¥0.00');
    expect(mixed).toContain('已录入估算合计：待确认'); expect(mixed).toContain('上限比较待确认');
    source.productionPlan = productionPlanSchema.parse({ estimates: [{ id: id(13), title: '全部未知' }] });
    expect((await doc(source)).body.textContent).toContain('已知金额小计：待确认（暂无已知金额）');
    expect((await doc(source)).body.textContent).not.toContain('已知金额小计：¥0.00');
    source.productionPlan = productionPlanSchema.parse({});
    expect((await doc(source)).body.textContent).toContain('尚无人工估算记录');
    expect((await doc(source)).body.textContent).toContain('不视为零费用');
  });

  it('uses the exact shared monetary summary including safe-integer maxima and partial over-limit records', async () => {
    const source = layout(); source.productionPlan = productionPlanSchema.parse({ budget: { limitMinor: 0, scopeNote: '范围', basisNote: '依据' },
      estimates: [{ id: id(12), title: '最大合法估算', amountMinor: Number.MAX_SAFE_INTEGER, basisNote: '人工记录' },
        { id: id(13), title: '未知额' }] });
    const text = (await doc(source)).body.textContent!;
    expect(text).toContain('¥90071992547409.91');
    expect(text).toContain('已知部分估算已超过人工预算上限');
    expect(text).toContain('已录入估算合计：待确认');
  });

  it('maps unique UUIDs case-insensitively and preserves separate same-name objects', async () => {
    const source = layout(); source.productionPlan!.staffing[0].taskIds = [id(20).toUpperCase()];
    source.productionPlan!.acquisitions[0].objectIds = [id(30).toUpperCase(), id(31)];
    const document = (await doc(source)); document.querySelector('details')!.remove();
    expect(document.body.textContent).toContain('任务1 · 签到台布置');
    expect(document.body.textContent).toContain('物件1 · 同名椅');
    expect(document.body.textContent).toContain('物件2 · 同名椅');
    expect(document.body.textContent).toContain('0.5 × 0.5 × 0.85');
    expect(document.body.textContent).toContain('0.6 × 0.6 × 0.9');
    expect(document.body.textContent).not.toContain('编号歧义');
    expect(document.body.textContent).not.toContain(id(30));
  });

  it('flags cross-floor UUID ambiguity and missing references without choosing the first or matching names', async () => {
    const source = layout(); source.floors.push(makeFloor({ id: 'second-floor', name: '二层',
      items: [makeItem({ id: id(30).toUpperCase(), name: '不能自动选中的替代名' })] }));
    source.productionPlan!.acquisitions[0].objectIds = [id(30), 'missing-original'];
    source.productionPlan!.staffing[0].taskIds = [id(88)];
    const document = (await doc(source)); const appendix = document.querySelector('details')!;
    expect(appendix.textContent).toContain('missing-original'); expect(appendix.textContent).toContain(id(88));
    appendix.remove();
    expect(document.body.textContent).toContain('物件编号歧义，需核对');
    expect(document.body.textContent).toContain('任务缺失，需核对');
    expect(document.body.textContent).not.toContain('不能自动选中的替代名');
    expect(document.body.textContent).not.toContain('物件1 · 同名椅');
  });

  it('keeps non-UUID legacy IDs case-sensitive rather than rebinding by equal names', async () => {
    const source = layout(); source.floors[0].items[0].id = 'Legacy-A'; source.floors[0].items[1].id = 'legacy-a';
    source.productionPlan!.acquisitions[0].objectIds = ['Legacy-A', 'LEGACY-A'];
    source.eventOperations!.tasks[0].objectIds = [];
    source.productionPlan!.estimates.forEach(row => { row.objectIds = []; });
    const document = (await doc(source)); document.querySelector('details')!.remove();
    expect(document.body.textContent).toContain('物件1 · 同名椅');
    expect(document.body.textContent).not.toContain('物件2 · 同名椅');
    expect(document.body.textContent).toContain('物件缺失，需核对');
  });

  it('retains duplicated source task identities as a diagnostic, without exporting first-match task details', async () => {
    const source = layout(); source.eventOperations!.tasks.push({ ...source.eventOperations!.tasks[0], id: id(20).toUpperCase(), title: '歧义替代任务' });
    const document = (await doc(source));
    expect(document.querySelector('details')!.textContent).toContain('歧义替代任务');
    document.querySelector('details')!.remove();
    expect(document.body.textContent).toContain('任务编号歧义，需核对');
    expect(document.body.textContent).not.toContain('任务1 · 签到台布置');
    expect(document.body.textContent).not.toContain('歧义替代任务');
    expect(document.body.textContent).not.toContain('任务负责人甲');
  });

  it('marks UUID case-duplicate object references inside a task without counting them twice', async () => {
    const source = layout(); source.eventOperations!.tasks[0].objectIds = [id(30), id(30).toUpperCase()];
    expect((await doc(source)).body.textContent).toContain('同一编号重复引用，需核对；不按多件计算');
    const tables = [...(await doc(source)).querySelectorAll('section')];
    const section = tables.find(s => s.querySelector('h2')?.textContent === '明确关联的活动任务')!;
    expect(section.textContent!.match(/物件1/g)).toHaveLength(1);
  });

  it('keeps missing task owners and conditions unknown instead of deriving them or completion from staffing and suppliers', async () => {
    const source = layout(); source.eventOperations!.tasks[0].ownerName = ''; source.eventOperations!.tasks[0].acceptance = '';
    const document = (await doc(source)); const section = [...document.querySelectorAll('section')].find(s => s.querySelector('h2')?.textContent === '明确关联的活动任务')!;
    expect(section.textContent).toContain('负责人：待确认'); expect(section.textContent).toContain('完成条件');
    expect(section.textContent).not.toContain('内部协作方丙'); expect(section.textContent).not.toContain('内部供应方乙');
    expect(section.textContent).toContain('记录状态');
    expect(section.textContent).toContain('有效状态');
    expect(taskRow(document).textContent).toContain(OPERATION_STATUS_LABELS.todo);
    expect(taskRow(document).textContent).not.toContain(OPERATION_STATUS_LABELS.accepted);
  });

  it('preserves conflicting rehearsal/real markings instead of upgrading both sources to confirmed facts', async () => {
    const source = layout(); source.productionPlan!.dataKind = 'real';
    const text = (await doc(source)).body.textContent!;
    expect(text).toContain('制作计划：真实资料标识（确认状态另行核对）');
    expect(text).toContain('活动任务：假设演练');
    expect(text).toContain('资料性质不同，需先核对');
    expect(source.eventOperations!.dataKind).toBe('rehearsal');
  });

  it('labels an independent estimate as having no references, without demanding a task or object link', async () => {
    const document = (await doc());
    const section = [...document.querySelectorAll('section')].find(s => s.querySelector('h2')?.textContent === '预算范围与人工估算')!;
    const row = [...section.querySelectorAll('tr')].find(r => r.textContent?.includes('已录入零额'))!;
    expect(row.textContent).toContain('无关联引用（独立估算）');
    expect(row.textContent).toContain('未关联任务');
    expect(row.textContent).toContain('未关联物件');
    expect(row.textContent).not.toContain('尚未关联，待确认');
    expect(row.textContent).not.toContain('编号关联唯一');
    expect(row.textContent).not.toContain('需核对：未明确关联');
  });

  it('keeps 39 task object references compact while retaining names, dimensions and every original ID elsewhere', async () => {
    const source = layout();
    source.floors[0].items = Array.from({ length: 39 }, (_, index) => makeItem({ id: id(100 + index), name: `执行物件长名称${index + 1}` }));
    source.eventOperations!.tasks[0].objectIds = source.floors[0].items.map(item => item.id);
    const document = (await doc(source));
    const section = [...document.querySelectorAll('section')].find(s => s.querySelector('h2')?.textContent === '明确关联的活动任务')!;
    const references = section.querySelector('tbody tr td:last-child')!.textContent!;
    expect(references).toContain('物件1、物件2、物件3');
    expect(references).toContain('物件39');
    expect(references).not.toContain('执行物件长名称');
    expect(references).not.toContain('\n');
    const instances = [...document.querySelectorAll('section')].find(s => s.querySelector('h2')?.textContent === '关联场景实例')!;
    expect(instances.textContent).toContain('执行物件长名称39');
    for (const item of source.floors[0].items) expect(document.querySelector('details')!.textContent).toContain(item.id);
  });

  it('escapes all dynamic text and has no scripts, external resources, inline events or automatic printing', async () => {
    const source = layout(); const payload = '<img src="https://private.example/x" onerror="alert(1)"><script>alert(2)</script>&';
    source.name = payload; source.productionPlan!.acquisitions[0].supplierName = '<script>alert(1)</script>';
    source.productionPlan!.acquisitions[0].sourceNote = payload;
    source.eventOperations!.tasks[0].acceptance = payload;
    const html = await productionPlanHandoffHtml(source, { ...snapshot, id: '"><iframe src="https://private.example"></iframe>' });
    const document = new DOMParser().parseFromString(html, 'text/html');
    expect(document.querySelectorAll('script,img,iframe,link,object,[onload],[onerror]')).toHaveLength(0);
    expect(document.body.textContent).toContain(payload);
    expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute('content')).toContain("default-src 'none'");
    expect(html).not.toContain('window.print');
    expect(html).toContain('@media print');
  });

  it('rejects absent/invalid plans, unsupported snapshot time and invalid tasks with readable errors', async () => {
    const source = layout(); delete source.productionPlan;
    await expect(productionPlanHandoffHtml(source, snapshot)).rejects.toThrow('尚未记录制作计划');
    source.productionPlan = { ...plan(), currency: 'USD' } as never;
    await expect(productionPlanHandoffHtml(source, snapshot)).rejects.toThrow('制作计划字段无效');
    source.productionPlan = plan();
    await expect(productionPlanHandoffHtml(source, { ...snapshot, generatedAt: '2026-10-09' })).rejects.toThrow('冻结时间无效');
    source.eventOperations!.tasks[0].plannedEndAt = '2026-10-09T05:00:00+08:00';
    await expect(productionPlanHandoffHtml(source, snapshot)).rejects.toThrow('活动任务资料无效');
  });

  it('rejects executable getters and serializers without calling them', async () => {
    const source = layout(); const callback = vi.fn(() => plan());
    Object.defineProperty(source, 'productionPlan', { enumerable: true, get: callback });
    await expect(productionPlanHandoffHtml(source, snapshot)).rejects.toThrow('取值器');
    expect(callback).not.toHaveBeenCalled();
    const other = layout(); Object.assign(other.productionPlan!, { toJSON: callback });
    await expect(productionPlanHandoffHtml(other, snapshot)).rejects.toThrow('非普通数据');
    expect(callback).not.toHaveBeenCalled();
  });

  it('awaits internal review and does not depend on a Scene JSON/model gate, network, browser state or downloads', async () => {
    const source = layout(); source.scenePreset = 'gym'; source.floors[0].items[0].glbNode = 'Preset_Object_0';
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    try { expect(typeof await productionPlanHandoffHtml(source, snapshot)).toBe('string'); expect(fetch).not.toHaveBeenCalled(); }
    finally { vi.unstubAllGlobals(); }
  });

  it('keeps recorded accepted and current effective accepted separate using the actual operation basis and review', async () => {
    const source = await acceptedLayout(); const task = source.eventOperations!.tasks[0];
    expect((await operationReview(source, task)).status).toBe('accepted');
    const document = await doc(source); const row = taskRow(document);
    expect(section(document, '明确关联的活动任务').textContent).toContain('记录状态');
    expect(section(document, '明确关联的活动任务').textContent).toContain('有效状态');
    expect(row.textContent!.match(new RegExp(OPERATION_STATUS_LABELS.accepted, 'g'))).toHaveLength(2);
    expect(row.textContent).not.toContain(OPERATION_STATUS_LABELS.needs_review);
    expect(source.eventOperations!.tasks[0].status).toBe('accepted');
  });

  it.each(['size', 'position'] as const)('preserves a recorded acceptance but exports effective needs-review after %s changes', async change => {
    const source = await acceptedLayout(); const task = source.eventOperations!.tasks[0];
    if (change === 'size') source.floors[0].items[0].width += 0.2;
    else {
      // The placement case has only production-plan object links, no direct task links.
      task.objectIds = []; task.reviewedBasis = await operationBasis(source, task);
      expect((await operationReview(source, task)).status).toBe('accepted');
      source.floors[0].items[0].position = { x: 2, z: 1 };
    }
    expect((await operationReview(source, task)).status).toBe('needs_review');
    const row = taskRow(await doc(source));
    expect(row.textContent).toContain(OPERATION_STATUS_LABELS.accepted);
    expect(row.textContent).toContain(OPERATION_STATUS_LABELS.needs_review);
    expect(row.textContent!.match(new RegExp(OPERATION_STATUS_LABELS.accepted, 'g'))).toHaveLength(1);
    expect(task.status).toBe('accepted');
    expect(task.evidenceNote).toBe('演练现场按原规格和摆位点清，确认说明仍保留。');
  });

  it('exports the actual shortage note, actual Shanghai times and evidence URLs as text rather than loaded media', async () => {
    const source = layout(); const task = source.eventOperations!.tasks[0];
    task.status = 'review'; task.evidenceNote = '演练现场少2把椅，已记录差异，替代方案待确认。';
    task.actualStartedAt = '2026-10-08T22:12:03.456Z';
    task.actualFinishedAt = '2026-10-09T06:28:05+08:00';
    task.evidenceUrls = ['https://evidence.example.test/arrivals.jpg', 'https://evidence.example.test/count.txt'];
    const document = await doc(source); const row = taskRow(document);
    expect(row.textContent).toContain('少2把椅');
    expect(row.textContent).toContain('2026-10-09 06:12:03.456');
    expect(row.textContent).toContain('2026-10-09 06:28:05');
    for (const url of task.evidenceUrls) expect(row.textContent).toContain(url);
    expect(row.textContent).toContain(OPERATION_STATUS_LABELS.review);
    expect(row.textContent).not.toContain(OPERATION_STATUS_LABELS.accepted);
    expect(document.querySelectorAll('img,iframe,object,link,a[href]')).toHaveLength(0);
    expect(source.eventOperations!.tasks[0].status).toBe('review');
  });

  it.each(['throws', 'crypto unavailable'] as const)('retains raw acceptance but marks an unfinished effective review when operation review %s', async failure => {
    const source = await acceptedLayout();
    if (failure === 'throws') vi.spyOn(operations, 'operationReview').mockRejectedValue(new Error('PRIVATE_REVIEW_ERROR https://private.example/?token=SECRET'));
    else vi.stubGlobal('crypto', undefined);
    const document = await doc(source); const row = taskRow(document);
    expect(row.textContent).toContain('待核对（复核未完成）');
    expect(row.textContent!.match(new RegExp(OPERATION_STATUS_LABELS.accepted, 'g'))).toHaveLength(1);
    expect(document.body.textContent).not.toContain('PRIVATE_REVIEW_ERROR');
    expect(document.body.textContent).not.toContain('private.example');
    expect(source.eventOperations!.tasks[0].status).toBe('accepted');
  });

  it('does not upgrade an ambiguous object source to an effective accepted task', async () => {
    const source = await acceptedLayout();
    source.floors[0].items.push(makeItem({ id: id(30).toUpperCase(), name: '歧义来源' }));
    expect((await operationReview(source, source.eventOperations!.tasks[0])).status).toBe('needs_review');
    const row = taskRow(await doc(source));
    expect(row.textContent).toContain('需核对（关联编号不唯一）');
    expect(row.textContent!.match(new RegExp(OPERATION_STATUS_LABELS.accepted, 'g'))).toHaveLength(1);
    expect(source.eventOperations!.tasks[0].status).toBe('accepted');
  });

  it('uses the same instance numbers in the rectangular SVG and details, with readable centre coordinates and degree headings', async () => {
    const source = layout();
    source.floors[0].items[0].position = { x: -1.7999999999999998, z: 2.5 };
    source.floors[0].items[0].rotation = Math.PI / 2;
    source.floors[0].items[1].position = { x: 1.234567, z: -0.00000001 };
    source.floors[0].items[1].rotation = -Math.PI / 4;
    source.floorPlanImage = 'data:image/png;base64,PRIVATE_REFERENCE_PHOTO';
    const html = await productionPlanHandoffHtml(source, snapshot);
    const document = new DOMParser().parseFromString(html, 'text/html');
    const planSection = section(document, '同快照摆位示意');
    expect(planSection.querySelectorAll('svg')).toHaveLength(1);
    const labels = [...planSection.querySelectorAll('svg text[aria-label]')];
    expect(labels.map(label => label.getAttribute('aria-label'))).toEqual(['物件1', '物件2']);
    expect(labels.map(label => label.textContent)).toEqual(['1', '2']);
    expect(planSection.textContent).toContain('非实测');
    const instances = section(document, '关联场景实例');
    const rows = [...instances.querySelectorAll('tbody tr')];
    expect(rows[0].textContent).toContain('物件1 · 同名椅');
    expect(rows[0].textContent).toContain('-1.8'); expect(rows[0].textContent).toContain('2.5');
    expect(rows[0].textContent).toContain('90°');
    expect(rows[1].textContent).toContain('物件2 · 同名椅'); expect(rows[1].textContent).toContain('-45°');
    expect(rows[1].textContent).toContain('横向 1.23 米 / 纵向 0 米');
    expect(instances.textContent).toContain('中心'); expect(instances.textContent).toContain('米');
    expect(instances.textContent).not.toContain('-1.7999999999999998');
    expect(instances.textContent).not.toContain('旋转弧度');
    for (const secret of ['PRIVATE_', 'private.example', '98765']) expect(html).not.toContain(secret);
    expect(document.querySelectorAll('img')).toHaveLength(0);
  });

  it.each(['scene preset', 'V2 structure'] as const)('keeps %s readable without a simplified SVG and asks for current drawings', async kind => {
    const source = layout();
    if (kind === 'scene preset') source.scenePreset = 'gym';
    else {
      const scene = sceneSchema.parse({ schemaVersion: 2,
        venue: { width: 8, depth: 8, height: 3, shape: 'rectangle', entrances: [] }, camera: 'overview', lighting: 'neutral',
        structure: { walls: [{ id: id(40), start: { x: -4, z: 0 }, end: { x: 4, z: 0 }, thickness: 0.1, height: 3, kind: 'interior', status: 'confirmed' }], columns: [], openings: [] },
        objects: [],
      });
      if (scene.schemaVersion !== 2) throw new Error('Expected V2 fixture');
      source.backendSceneV2 = scene;
    }
    const document = await doc(source);
    expect(document.querySelectorAll('svg')).toHaveLength(0);
    expect(section(document, '同快照摆位示意').textContent).toContain('需附当前图纸');
    expect(document.body.textContent).toContain('物件1 · 同名椅');
    expect(document.body.textContent).toContain('按位置和规格清单逐件核对');
  });

  it('freezes source layout, task and object fields before a deferred review finishes', async () => {
    const source = await acceptedLayout(); const task = source.eventOperations!.tasks[0];
    source.floors[0].items[0].position = { x: -1.8, z: 2.5 };
    task.reviewedBasis = await operationBasis(source, task);
    const review = await operationReview(source, task);
    const started = deferred<void>(), pending = deferred<Awaited<ReturnType<typeof operationReview>>>();
    // Controlled module delay tests export isolation; it does not prove real UI saving or canvas capture.
    const spy = vi.spyOn(operations, 'operationReview').mockImplementation(() => { started.resolve(); return pending.promise; });
    const output = productionPlanHandoffHtml(source, snapshot);
    await started.promise;
    expect(spy.mock.calls[0][0]).not.toBe(source); expect(spy.mock.calls[0][1]).not.toBe(task);
    source.name = '后改项目'; source.productionPlan!.staffing[0].roleName = '后改岗位';
    task.title = '后改任务'; task.evidenceNote = '后改现场说明'; task.acceptance = '后改完成条件';
    source.floors[0].items[0].position = { x: 99, z: 88 }; source.floors[0].items[0].width = 55;
    pending.resolve(review);
    const document = new DOMParser().parseFromString(await output, 'text/html');
    const text = document.body.textContent!;
    for (const changed of ['后改项目', '后改岗位', '后改任务', '后改现场说明', '后改完成条件']) expect(text).not.toContain(changed);
    expect(text).toContain('签到岗位'); expect(text).toContain('签到台布置');
    expect(text).toContain('演练现场按原规格和摆位点清，确认说明仍保留。');
    const row = section(document, '关联场景实例').querySelector('tbody tr')!;
    expect(row.textContent).toContain('-1.8'); expect(row.textContent).toContain('2.5');
    expect(row.textContent).toContain('0.5 × 0.5 × 0.85');
    expect(row.textContent).not.toContain('99'); expect(row.textContent).not.toContain('88');
  });
});

describe('material-checkin facts in internal handoff HTML', () => {
  it.each(['production', 'activity'] as const)('keeps the 20/18/18 outstanding receipt visible in %s handoff even without validation anomalies', async scope => {
    const source = layout(), facts = checkLedger(), sheet = facts.sheets[0];
    sheet.agreements[0].agreedQuantity = 20; sheet.agreements[0].basisNote = '原约定20件，差额原因待现场核对';
    movement(sheet, 'receive').quantity = 18; movement(sheet, 'receive').evidenceNote = '原收取18件说明';
    movement(sheet, 'return').quantity = 18; movement(sheet, 'return').evidenceNote = '原退回18件说明';
    const before = JSON.stringify({ source, facts });
    expect(materialCheckinSummary(sheet)).toMatchObject({ issues: [], notReceivedQuantity: 2, notReturnedQuantity: 0 });
    const document = new DOMParser().parseFromString(await productionPlanHandoffHtml(source, snapshot, facts,
      scope === 'activity' ? { scope: 'activity' } : undefined), 'text/html');
    const article = quantityArticles(document)[0], followup = quantityValue(article, '异常与待核');
    expect(followup).toContain('数量校验：未发现已定义的数量校验异常');
    expect(followup).toContain('相对约定仍未收 2 件，需跟进');
    expect(followup).toContain('相对实收未退 0 件'); expect(followup).not.toContain('结清');
    for (const value of ['原约定20件，差额原因待现场核对', '原收取18件说明', '原退回18件说明',
      'https://evidence.example/receipt.jpg', 'https://evidence.example/return.jpg']) expect(article.textContent).toContain(value);
    expect(section(document, scope === 'activity' ? '全部活动任务' : '明确关联的活动任务').textContent).toContain('有效状态：未开始');
    expect(JSON.stringify({ source, facts })).toBe(before);
  });

  it('exports the shared 30-agreed, 28-received, 26-returned result as two separate outstanding gaps and preserves batch provenance', async () => {
    const source = layout(), facts = checkLedger(), before = JSON.stringify({ source, facts });
    expect(materialCheckinSummary(facts.sheets[0])).toMatchObject({ agreedQuantity: 30, receivedQuantity: 28,
      returnedQuantity: 26, notReceivedQuantity: 2, notReturnedQuantity: 2 });
    const document = await doc(source, facts), article = quantityArticles(document)[0];
    expect(quantityValue(article, '当前约定数量／依据')).toBe('30 件\n演练约定30件');
    expect(quantityValue(article, '当前有效收取数量')).toBe('28 件');
    expect(quantityValue(article, '当前有效退回数量')).toBe('26 件');
    expect(quantityValue(article, '已核部分收取／退回')).toBe('收取：28 件\n退回：26 件');
    expect(quantityValue(article, '未收／未退差额')).toBe('相对约定未收：2 件\n相对已收未退：2 件');
    expect(quantityValue(article, '超收／超退差额')).toBe('超收：0 件\n超退：0 件');
    expect(quantityValue(article, '异常与待核')).toContain('相对约定仍未收 2 件，需跟进');
    expect(quantityValue(article, '异常与待核')).toContain('相对实收仍未退 2 件，需跟进');
    for (const text of ['内部供应方乙', '演练执行方A', '演练记录人丙', '2026-10-09 09:00:00',
      '2026-10-09 09:05:00', 'https://evidence.example/receipt.jpg', '演练收28件，差额原因待核']) expect(article.textContent).toContain(text);
    expect(article.textContent).toContain('不等于已获施工或客户批准');
    expect(section(document, '数量点验').textContent).toContain('不据此判断遗失、可用库存或任务完成');
    expect(taskRow(document).textContent).not.toContain(OPERATION_STATUS_LABELS.accepted);
    expect(source.eventOperations!.tasks[0].status).toBe('todo');
    expect(JSON.stringify({ source, facts })).toBe(before);
  });

  it('keeps pending and disputed quantities out of complete totals while retaining the actual checked portions', async () => {
    const facts = checkLedger();
    facts.sheets[0].events.push(checkEvent(212, 'receive', 2, 'pending'), checkEvent(213, 'return', 1, 'disputed'));
    expect(materialCheckinLedgerSchema.safeParse(facts).success).toBe(true);
    expect(materialCheckinSummary(facts.sheets[0])).toMatchObject({ receivedQuantity: null, returnedQuantity: null,
      knownReceivedQuantity: 28, knownReturnedQuantity: 26, notReceivedQuantity: null, notReturnedQuantity: null });
    const article = quantityArticles(await doc(layout(), facts))[0];
    expect(quantityValue(article, '当前有效收取数量')).toBe('待确认');
    expect(quantityValue(article, '当前有效退回数量')).toBe('待确认');
    expect(quantityValue(article, '已核部分收取／退回')).toBe('收取：28 件\n退回：26 件');
    expect(quantityValue(article, '未收／未退差额')).toBe('相对约定未收：待确认\n相对已收未退：待确认');
    expect(quantityValue(article, '异常与待核')).toContain('存在争议批次');
    expect(quantityValue(article, '异常与待核')).toContain('完整收退数量待确认');
    expect(quantityValue(article, '异常与待核')).toContain('相对约定未收数量待确认');
    expect(quantityValue(article, '异常与待核')).toContain('相对实收未退数量待确认');
    expect(article.textContent).toContain('待核'); expect(article.textContent).toContain('争议待核');
  });

  it('does not infer an agreed receipt gap from a fully checked receipt and return when the agreement is unknown', async () => {
    const facts = checkLedger(), sheet = facts.sheets[0]; sheet.agreements[0].agreedQuantity = null;
    movement(sheet, 'receive').quantity = 18; movement(sheet, 'return').quantity = 18;
    expect(materialCheckinSummary(sheet)).toMatchObject({ notReceivedQuantity: null, notReturnedQuantity: 0 });
    const followup = quantityValue(quantityArticles(await doc(layout(), facts))[0], '异常与待核');
    expect(followup).toContain('约定数量待确认'); expect(followup).toContain('相对约定未收数量待确认');
    expect(followup).toContain('相对实收未退 0 件'); expect(followup).not.toContain('相对约定未收 0 件');
  });

  it.each(['explicit zero', 'unknown', 'no events'] as const)('distinguishes %s from an inferred checked zero', async kind => {
    const facts = checkLedger(), sheet = facts.sheets[0];
    if (kind === 'explicit zero') {
      sheet.agreements[0].agreedQuantity = 0; sheet.agreements[0].basisNote = '演练明确零约定';
      movement(sheet, 'receive').quantity = 0; movement(sheet, 'return').quantity = 0;
    } else if (kind === 'unknown') {
      sheet.agreements[0].agreedQuantity = null; sheet.agreements[0].basisNote = '';
      for (const movementKind of ['receive', 'return'] as const) {
        movement(sheet, movementKind).quantity = null; movement(sheet, movementKind).checkState = 'pending';
      }
    } else sheet.events = [];
    expect(materialCheckinLedgerSchema.safeParse(facts).success).toBe(true);
    const article = quantityArticles(await doc(layout(), facts))[0];
    if (kind === 'explicit zero') {
      expect(quantityValue(article, '当前约定数量／依据')).toBe('0 件\n演练明确零约定');
      expect(quantityValue(article, '当前有效收取数量')).toBe('0 件');
      expect(quantityValue(article, '当前有效退回数量')).toBe('0 件');
      expect(quantityValue(article, '已核部分收取／退回')).toBe('收取：0 件\n退回：0 件');
      expect(quantityValue(article, '异常与待核')).toContain('相对约定未收 0 件');
      expect(quantityValue(article, '异常与待核')).toContain('相对实收未退 0 件');
    } else {
      expect(quantityValue(article, '当前有效收取数量')).toBe('待确认');
      expect(quantityValue(article, '当前有效退回数量')).toBe('待确认');
      expect(quantityValue(article, '已核部分收取／退回')).toContain('尚无已核收取记录');
      expect(quantityValue(article, '已核部分收取／退回')).toContain('尚无已核退回记录');
      expect(quantityValue(article, '已核部分收取／退回')).not.toContain('0 件');
      expect(quantityValue(article, '异常与待核')).toContain('相对约定未收数量待确认');
      expect(quantityValue(article, '异常与待核')).toContain('相对实收未退数量待确认');
      if (kind === 'unknown') expect(quantityValue(article, '当前约定数量／依据')).toBe('待确认\n待确认');
      else expect(article.textContent).toContain('尚无有效收退批次；未记录不表示数量为零');
    }
  });

  it('displays each sheet in its piece or set unit without creating a mixed ledger total', async () => {
    const set = checkSheet(300, 'set'); set.agreements[0].agreedQuantity = 2; set.agreements[0].basisNote = '演练两套约定';
    movement(set, 'receive').quantity = 2; movement(set, 'return').quantity = 1;
    const document = await doc(layout(), checkLedger([checkSheet(), set])), articles = quantityArticles(document);
    expect(articles).toHaveLength(2);
    expect(quantityValue(articles[0], '当前有效收取数量')).toBe('28 件');
    expect(quantityValue(articles[1], '当前有效收取数量')).toBe('2 套');
    expect(quantityValue(articles[1], '当前有效退回数量')).toBe('1 套');
    expect(quantityValue(articles[1], '异常与待核')).toContain('相对实收仍未退 1 套，需跟进');
    expect(section(document, '数量点验').textContent).toContain('不混计件/套');
    expect(section(document, '数量点验').textContent).not.toContain('收取合计：30');
    expect(section(document, '数量点验').textContent).not.toContain('数量合计：');
  });

  it('replaces corrections, excludes voided receipts and follows the agreement successor even when its array is reversed', async () => {
    const facts = checkLedger(), sheet = facts.sheets[0];
    sheet.agreements = [{ id: id(202), supersedesId: id(201), agreedQuantity: 29, basisNote: '最新更替约定29件',
      recordedAt: '2026-10-09T08:30:00+08:00', recordedBy: '更替约定人' }, ...sheet.agreements];
    sheet.events.push({ id: id(212), kind: 'correction', targetId: id(210), reason: '原收取数量录错，应为27件',
      replacement: { ...checkPayload(27, 'receive'), evidenceNote: '更正后已核27件', fromPartyName: '更正交出方' },
      recordedAt: '2026-10-09T09:10:00+08:00', recordedBy: '更正记录人' },
      checkEvent(213, 'receive', 1), { id: id(214), kind: 'void', targetId: id(213), reason: '重复录入的收取记录作废',
        evidenceNote: '作废依据原文', evidenceUrls: ['https://evidence.example/void.txt'], recordedAt: '2026-10-09T09:15:00+08:00', recordedBy: '作废记录人' });
    expect(materialCheckinLedgerSchema.safeParse(facts).success).toBe(true);
    expect(projectMaterialCheckinEvents(sheet)).toMatchObject({ agreement: { id: id(202), agreedQuantity: 29 }, voidedRootIds: [id(213)] });
    expect(materialCheckinSummary(sheet)).toMatchObject({ receivedQuantity: 27, returnedQuantity: 26 });
    const document = await doc(layout(), facts), article = quantityArticles(document)[0], appendix = document.querySelector('details')!;
    expect(quantityValue(article, '当前约定数量／依据')).toBe('29 件\n最新更替约定29件');
    expect(quantityValue(article, '当前有效收取数量')).toBe('27 件');
    expect(quantityValue(article, '当前有效退回数量')).toBe('26 件');
    expect(article.textContent).toContain('已作废 1 条原收退记录');
    expect(article.textContent).toContain('更正交出方'); expect(article.textContent).toContain('更正记录人');
    for (const value of ['原收取数量录错，应为27件', '重复录入的收取记录作废', '作废依据原文',
      '演练收28件，差额原因待核', '数量：28 件', '数量：27 件', id(210), id(212), id(213), id(214), id(201), id(202)]) expect(appendix.textContent).toContain(value);
    const effectiveTable = [...appendix.querySelectorAll('table')].find(table => table.querySelector('th')?.textContent === '有效根原编号')!;
    expect([...effectiveTable.querySelectorAll('tbody tr')].some(row => row.children[0].textContent === id(210) && row.children[1].textContent === id(212))).toBe(true);
    expect([...effectiveTable.querySelectorAll('tbody tr')].some(row => row.children[0].textContent === id(213))).toBe(false);
  });

  it.each(['cross project', 'idless local', 'invalid ledger'] as const)('refuses the %s ledger before emitting any handoff file', async reason => {
    const source = layout(), facts = checkLedger();
    if (reason === 'cross project') facts.projectId = 'another-project';
    if (reason === 'idless local') { delete source.id; facts.projectId = 'local'; }
    if (reason === 'invalid ledger') movement(facts.sheets[0], 'receive').quantity = -1;
    await expect(productionPlanHandoffHtml(source, snapshot, facts)).rejects.toThrow(reason === 'invalid ledger' ? '账册资料无效' : '项目不一致');
  });

  it('exports a same-project ledger after plan removal without creating a plan or reattaching its acquisition by name', async () => {
    const source = layout(), facts = checkLedger(); delete source.productionPlan;
    const before = JSON.stringify(source), document = await doc(source, facts);
    expect(document.querySelector('header')!.textContent).toContain('制作计划：当前未记录');
    expect(section(document, '数量点验').textContent).toContain('当前制作计划未记录');
    expect(quantityArticles(document)[0].textContent).toContain('当前取得关联未找到，需核对');
    expect(quantityValue(quantityArticles(document)[0], '当前有效收取数量')).toBe('28 件');
    expect(JSON.stringify(source)).toBe(before); expect(source.productionPlan).toBeUndefined();
    source.productionPlan = productionPlanSchema.parse({ dataKind: 'rehearsal', acquisitions: [{ id: id(888),
      ...facts.sheets[0].acquisitionSnapshot }] });
    const sameName = await doc(source, facts);
    expect(quantityArticles(sameName)[0].textContent).toContain('当前取得关联未找到，需核对');
    expect(quantityArticles(sameName)[0].textContent).not.toContain('当前取得编号对应');
    expect(sameName.querySelector('details')!.textContent).toContain(id(11));
  });

  it.each(['title', 'supplierName', 'specificationNote'] as const)('flags changed current acquisition %s without silently replacing its frozen source', async field => {
    const source = layout(), facts = checkLedger(); source.productionPlan!.acquisitions[0][field] = '当前新记录';
    const article = quantityArticles(await doc(source, facts))[0];
    expect(article.textContent).toContain('当前取得资料与原冻结来源不同，需核对');
    expect(article.textContent).toContain(facts.sheets[0].acquisitionSnapshot[field]);
    expect(article.textContent).not.toContain('当前新记录');
  });

  it('passes the frozen third ledger into real task review and invalidates an earlier acceptance after a related quantity changes', async () => {
    const source = await acceptedLayout(), facts = checkLedger(), task = source.eventOperations!.tasks[0];
    task.reviewedBasis = await operationBasis(source, task, facts);
    expect((await operationReview(source, task, facts)).status).toBe('accepted');
    const current = taskRow(await doc(source, facts));
    expect(current.textContent!.match(new RegExp(OPERATION_STATUS_LABELS.accepted, 'g'))).toHaveLength(2);
    const changed = structuredClone(facts); movement(changed.sheets[0], 'receive').quantity = 27;
    expect((await operationReview(source, task, changed)).status).toBe('needs_review');
    const stale = taskRow(await doc(source, changed));
    expect(stale.textContent).toContain(OPERATION_STATUS_LABELS.needs_review);
    expect(stale.textContent!.match(new RegExp(OPERATION_STATUS_LABELS.accepted, 'g'))).toHaveLength(1);
    expect(task.status).toBe('accepted');
  });

  it('freezes original ledger parties, agreement, quantities and evidence before a deferred operation review completes', async () => {
    const source = layout(), facts = checkLedger(), started = deferred<void>(), pending = deferred<Awaited<ReturnType<typeof operationReview>>>();
    const spy = vi.spyOn(operations, 'operationReview').mockImplementation(() => { started.resolve(); return pending.promise; });
    const output = productionPlanHandoffHtml(source, snapshot, facts); await started.promise;
    const frozenLedger = spy.mock.calls[0][2]!;
    expect(frozenLedger).not.toBe(facts); expect(frozenLedger.sheets[0]).not.toBe(facts.sheets[0]);
    facts.dataKind = 'real'; facts.sheets[0].agreements[0].agreedQuantity = 999;
    movement(facts.sheets[0], 'receive').quantity = 999; movement(facts.sheets[0], 'receive').fromPartyName = '后改交出方';
    movement(facts.sheets[0], 'receive').evidenceNote = '后改收货说明'; movement(facts.sheets[0], 'receive').evidenceUrls.push('https://evidence.example/later');
    pending.resolve({ status: 'todo', missingObjectIds: [] });
    const document = new DOMParser().parseFromString(await output, 'text/html'), article = quantityArticles(document)[0];
    expect(quantityValue(article, '当前约定数量／依据')).toBe('30 件\n演练约定30件');
    expect(quantityValue(article, '当前有效收取数量')).toBe('28 件');
    expect(article.textContent).toContain('内部供应方乙'); expect(article.textContent).toContain('演练收28件，差额原因待核');
    expect(article.textContent).not.toContain('后改'); expect(article.textContent).not.toContain('https://evidence.example/later');
    expect(section(document, '数量点验').textContent).toContain('账册资料：假设演练');
  });

  it('escapes ledger party names, notes, agreement and correction/void reasons and keeps evidence as non-loading text', async () => {
    const facts = checkLedger(), sheet = facts.sheets[0];
    const payload = '<img src="https://evil.test/x" onerror="x()"><script>x()</script>&';
    expect(payload.length).toBeLessThanOrEqual(80);
    sheet.acquisitionSnapshot.title = payload; sheet.acquisitionSnapshot.supplierName = payload;
    sheet.agreements[0].basisNote = payload; sheet.agreements[0].recordedBy = payload;
    for (const kind of ['receive', 'return'] as const) {
      const event = movement(sheet, kind); event.fromPartyName = payload; event.toPartyName = payload;
      event.recordedBy = payload; event.evidenceNote = payload;
    }
    sheet.events.push({ id: id(212), kind: 'correction', targetId: id(210), reason: payload,
      replacement: { ...checkPayload(28, 'receive'), fromPartyName: payload, toPartyName: payload, evidenceNote: payload },
      recordedAt: '2026-10-09T09:10:00+08:00', recordedBy: payload },
      { id: id(213), kind: 'void', targetId: id(212), reason: payload, evidenceNote: payload, evidenceUrls: ['https://evidence.example/void?a=1&b=2'],
        recordedAt: '2026-10-09T09:15:00+08:00', recordedBy: payload });
    expect(materialCheckinLedgerSchema.safeParse(facts).success).toBe(true);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const html = await productionPlanHandoffHtml(layout(), snapshot, facts), document = new DOMParser().parseFromString(html, 'text/html');
    expect(document.querySelectorAll('script,img,iframe,object,link,a[href],[onload],[onerror]')).toHaveLength(0);
    expect(document.body.textContent).toContain(payload);
    expect(document.querySelector('details')!.textContent).toContain('https://evidence.example/void?a=1&b=2');
    expect(html).not.toContain('PRIVATE_ITEM_NOTE'); expect(html).not.toContain('PRIVATE_TOKEN');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('distinguishes an explicitly empty ledger from an omitted ledger without inventing quantity zero', async () => {
    const empty = await doc(layout(), checkLedger([]));
    expect(section(empty, '数量点验').textContent).toContain('账册已记录，尚未建立点验单；当前数量待确认');
    expect(quantityArticles(empty)).toHaveLength(0);
    const absent = await doc();
    expect([...absent.querySelectorAll('h2')].map(heading => heading.textContent)).not.toContain('数量点验');
  });
});

const activityDoc = async (source: RoomLayout = layout(), brief?: BackupBrief) => new DOMParser().parseFromString(
  await productionPlanHandoffHtml(source, snapshot, undefined, { scope: 'activity', ...(brief ? { brief } : {}) }), 'text/html');
const briefFixture = (): BackupBrief => ({ status: 'present', value: { event: '演练工作坊', guests: 0,
  description: '活动目的原记录', mustHave: '必须保留入口通道', allowIdeas: false, hasFloorplan: true,
  venueConditions: '现场供电待确认', style: '简洁', palette: '绿色', atmosphere: '交流' } });
async function acceptedObjectLayout() {
  const source = layout(), item = source.floors[0].items[0];
  item.materialId = 'asset';
  source.floors[0].items[1].materialId = 'chair';
  const record = handoffSchema.parse({ ownerName: '物件负责人甲', dueDate: '2026-10-09', acceptance: '逐件核对位置',
    status: 'todo', evidenceNote: '原现场核对证据', evidenceUrls: ['https://evidence.example/object?a=1&b=2'] });
  item.handoff = record;
  record.reviewedBasis = await handoffBasis(source, item.id, record); record.status = 'accepted';
  return source;
}

describe('complete internal activity handoff HTML', () => {
  it.each(['production', 'activity'] as const)('uses neutral task text for an empty object association in %s scope', async scope => {
    const source = layout(); source.eventOperations!.tasks[0].objectIds = [];
    const document = new DOMParser().parseFromString(await productionPlanHandoffHtml(source, snapshot, undefined,
      scope === 'activity' ? { scope: 'activity' } : undefined), 'text/html');
    const task = section(document, scope === 'activity' ? '全部活动任务' : '明确关联的活动任务').querySelector('tbody tr')!;
    expect(task.children[4].textContent).toBe('未关联场景物件');
    expect(task.children[4].textContent).not.toContain('待确认');
    expect(task.children[4].textContent).not.toContain('缺失');
  });

  it('retains budgets, quantity calculations and the same object numbers in the expanded scope', async () => {
    const source = layout(), facts = checkLedger();
    const document = new DOMParser().parseFromString(await productionPlanHandoffHtml(source, snapshot, facts, { scope: 'activity' }), 'text/html');
    expect(section(document, '预算范围与人工估算').textContent).toContain('已知金额小计：¥1250.50');
    expect(quantityValue(quantityArticles(document)[0], '当前有效收取数量')).toBe('28 件');
    expect(quantityValue(quantityArticles(document)[0], '当前有效退回数量')).toBe('26 件');
    expect(section(document, '逐件物料工作单').textContent).toContain('物件2 · 同名椅');
    expect(document.querySelector('svg [aria-label="物件2"]')).not.toBeNull();
    Object.assign(source.floors[0].items[0], { futurePrivateField: 'PRIVATE_FUTURE_OBJECT_DATA' });
    expect(await productionPlanHandoffHtml(source, snapshot, undefined, { scope: 'activity' })).not.toContain('PRIVATE_FUTURE_OBJECT_DATA');
  });

  it('includes every phase and unlinked task in source order while keeping the legacy and customer scopes unchanged', async () => {
    const source = layout();
    source.eventOperations!.tasks.push(...eventOperationsSchema.parse({ tasks: [
      { id: id(23), title: '独立撤场任务', phase: 'teardown', ownerName: '撤场负责人' },
      { id: id(22), title: '独立准备任务', phase: 'preparation', acceptance: '准备完成条件' },
      { id: id(24), title: '独立活动任务', phase: 'event' },
    ] }).tasks);
    source.floors[0].items[0].handoff = handoffSchema.parse({ ownerName: '物件工作单私有负责人', dueDate: '2026-10-09' });
    const document = await activityDoc(source), rows = [...section(document, '全部活动任务').querySelectorAll('tbody tr')];
    expect(rows.map(row => row.children[0].textContent!.split('\n')[0])).toEqual([
      '任务1 · 签到台布置', '任务2 · 独立撤场任务', '任务3 · 独立准备任务', '任务4 · 独立活动任务']);
    expect(rows[1].textContent).toContain('撤场'); expect(rows[2].textContent).toContain('准备');
    expect(rows[3].textContent).toContain('负责人：待确认');
    expect(document.title).toContain('内部活动交接');
    expect(document.querySelector('header')!.textContent).toContain('任务：4 项；物件：2 项；已填工作单：1 / 2 项');
    expect(document.body.textContent).toContain('已下载文件是冻结版本');
    const old = await doc(source); old.querySelector('details')!.remove();
    expect(old.title).toContain('内部制作交接');
    for (const excluded of ['独立撤场任务', '物件工作单私有负责人', '逐件物料工作单']) expect(old.body.textContent).not.toContain(excluded);
    const customer = projectReviewHtml(createProjectReviewSnapshot({ layout: source,
      briefSnapshot: { state: 'ready', scope: source.id!, brief: { status: 'absent' } }, snapshot,
      source: { scope: source.id!, revision: 'r1' }, dataState: 'saved', dataKind: 'rehearsal', disclosure: { brief: false, design: true } }));
    for (const excluded of ['独立撤场任务', '物件工作单私有负责人', '内部供应方乙', '逐件物料工作单']) expect(customer).not.toContain(excluded);
  });

  it('exports existing activities and object work without any production plan or ledger', async () => {
    const source = await acceptedObjectLayout(); delete source.productionPlan;
    const document = await activityDoc(source);
    expect(section(document, '全部活动任务').textContent).toContain('签到台布置');
    expect(section(document, '逐件物料工作单').textContent).toContain('原现场核对证据');
    expect(document.querySelector('header')!.textContent).toContain('制作计划：当前未记录');
    expect([...document.querySelectorAll('h2')].map(heading => heading.textContent)).not.toContain('数量点验');
    await expect(productionPlanHandoffHtml(source, snapshot)).rejects.toThrow('尚未记录制作计划或点验账册');
  });

  it('states missing tasks, unassigned objects, empty work sheets and missing briefs without manufacturing completion', async () => {
    const source = layout(); delete source.productionPlan; delete source.eventOperations;
    source.floors[0].items[1].handoff = handoffSchema.parse({});
    const document = await activityDoc(source), work = section(document, '逐件物料工作单');
    expect(section(document, '全部活动任务').textContent).toContain('当前未记录活动任务');
    expect(work.textContent).toContain('尚未填写工作单；分工与进展待确认');
    expect(work.textContent).toContain('负责人：待确认'); expect(work.textContent).toContain('期限：待确认');
    expect(work.textContent).not.toContain('已验收');
    expect(document.querySelector('header')!.textContent).toContain('已填工作单：0 / 2 项');
    expect(section(document, '活动需求与现场条件').textContent).toContain('本次未提供活动需求快照');
    const absent = await activityDoc(source, { status: 'absent' });
    expect(section(absent, '活动需求与现场条件').textContent).toContain('当前未记录活动需求');
  });

  it.each(['ownerName', 'dueDate', 'acceptance', 'geometry'] as const)('recomputes effective object status after %s changes and retains evidence', async field => {
    const source = await acceptedObjectLayout(), item = source.floors[0].items[0];
    if (field === 'geometry') item.width += 0.25;
    else item.handoff![field] = field === 'dueDate' ? '2026-10-10' : '变更后的分工或条件';
    const work = section(await activityDoc(source), '逐件物料工作单');
    expect(work.textContent).toContain('记录状态：已验收\n有效状态：需复核');
    expect(work.textContent).toContain('原现场核对证据');
    expect(work.textContent).toContain('https://evidence.example/object?a=1&b=2');
    expect(item.handoff!.status).toBe('accepted');
  });

  it('keeps unlinked task acceptance subject to the same current geometry review', async () => {
    const source = await acceptedLayout(); source.productionPlan = productionPlanSchema.parse({});
    const task = source.eventOperations!.tasks[0]; task.reviewedBasis = await operationBasis(source, task);
    source.floors[0].items[0].width += 1;
    expect(section(await activityDoc(source), '全部活动任务').textContent).toContain('有效状态：需复核');
  });

  it('uses unconfirmed effective statuses when either review fails', async () => {
    const source = await acceptedObjectLayout();
    vi.spyOn(handoffs, 'effectiveHandoffStatus').mockRejectedValue(new Error('PRIVATE_HANDOFF_FAILURE'));
    vi.spyOn(operations, 'operationReview').mockRejectedValue(new Error('PRIVATE_TASK_FAILURE'));
    const html = await productionPlanHandoffHtml(source, snapshot, undefined, { scope: 'activity' });
    const document = new DOMParser().parseFromString(html, 'text/html');
    expect(section(document, '逐件物料工作单').textContent).toContain('有效状态：待核对（复核未完成）');
    expect(section(document, '全部活动任务').textContent).toContain('有效状态：待核对（复核未完成）');
    expect(html).not.toContain('PRIVATE_HANDOFF_FAILURE'); expect(html).not.toContain('PRIVATE_TASK_FAILURE');
  });

  it('does not use first-match acceptance for ambiguous object identities', async () => {
    const source = await acceptedObjectLayout();
    source.floors[0].items[1] = { ...source.floors[0].items[0], id: source.floors[0].items[0].id.toUpperCase() };
    const review = vi.spyOn(handoffs, 'effectiveHandoffStatus');
    const document = await activityDoc(source), work = section(document, '逐件物料工作单');
    expect(work.textContent!.match(/有效状态：待核对（物件编号不唯一）/g)).toHaveLength(2);
    expect(review).not.toHaveBeenCalled(); expect(document.querySelector('svg')).toBeNull();
  });

  it.each(['status', 'url', 'unknown field'] as const)('refuses invalid handoff %s rather than silently omitting it', async reason => {
    const source = layout(), record = handoffSchema.parse({}); source.floors[0].items[0].handoff = record;
    if (reason === 'status') Object.assign(record, { status: 'accepted' });
    if (reason === 'url') record.evidenceUrls = ['javascript:alert(1)'];
    if (reason === 'unknown field') Object.assign(record, { futurePrivateData: 'PRIVATE_NEW_FIELD' });
    await expect(productionPlanHandoffHtml(source, snapshot, undefined, { scope: 'activity' })).rejects.toThrow('物件1工作单资料无效');
  });

  it('freezes layout, work sheets, brief and metadata before deferred review', async () => {
    const source = await acceptedObjectLayout(), brief = briefFixture(), meta = { ...snapshot };
    const started = deferred<void>(), pending = deferred<Awaited<ReturnType<typeof operationReview>>>();
    vi.spyOn(operations, 'operationReview').mockImplementation(() => { started.resolve(); return pending.promise; });
    const output = productionPlanHandoffHtml(source, meta, undefined, { scope: 'activity', brief }); await started.promise;
    source.eventOperations!.tasks[0].title = '后改任务'; source.floors[0].items[0].notes = '后改备注'; source.floors[0].items[0].handoff!.ownerName = '后改负责人';
    source.floors[0].items[0].handoff!.evidenceNote = '后改证据'; source.floors[0].items[0].position = { x: 200, z: 0 };
    if (brief.status === 'present') brief.value.description = '后改活动目的';
    meta.id = '后改快照'; meta.generatedAt = '2027-01-01T00:00:00Z';
    pending.resolve({ status: 'todo', missingObjectIds: [] });
    const html = await output;
    expect(html).not.toContain('后改'); expect(html).toContain('原现场核对证据');
    expect(html).toContain('活动目的原记录'); expect(html).toContain(snapshot.generatedAt);
  });

  it('shows only validated brief business fields and escapes all new visible text without loading evidence or leaking model URLs', async () => {
    const source = await acceptedObjectLayout(), brief = briefFixture();
    const payload = '<img src="https://evil.test/x" onerror="x()">&';
    const record = source.floors[0].items[0].handoff!; record.ownerName = payload; record.acceptance = payload; record.evidenceNote = payload;
    if (brief.status === 'present') brief.value.description = payload;
    const html = await productionPlanHandoffHtml(source, snapshot, undefined, { scope: 'activity', brief });
    const document = new DOMParser().parseFromString(html, 'text/html');
    expect(document.querySelectorAll('script,img,iframe,object,link,[onload],[onerror]')).toHaveLength(0);
    const links = [...document.querySelectorAll('a[href]')];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.closest('nav[aria-label="交接目录"]')).not.toBeNull();
      expect(link.getAttribute('href')).toMatch(/^#handoff-[a-z]+$/);
      expect(document.querySelector(link.getAttribute('href')!)).not.toBeNull();
    }
    expect(section(document, '逐件物料工作单').textContent).toContain(payload);
    const needs = section(document, '活动需求与现场条件');
    expect(needs.textContent).toContain(payload); expect(needs.textContent).toContain('预计人数0');
    expect(needs.textContent).toContain('照片、原图纸附件和模型文件需另行提供');
    expect(section(document, '逐件物料工作单').textContent).toContain(source.floors[0].items[0].notes!);
    for (const excluded of ['allowIdeas', 'hasFloorplan', 'PRIVATE_TOKEN', 'PRIVATE_ACCOUNT_TOKEN', 'PRIVATE_FUTURE_OBJECT_DATA', 'PRIVATE_NEW_FIELD', '98765', 'sha256:', 'reviewedBasis']) expect(html).not.toContain(excluded);
    if (brief.status === 'present') Object.assign(brief.value, { internalToken: 'PRIVATE_NEW_FIELD' });
    await expect(productionPlanHandoffHtml(source, snapshot, undefined, { scope: 'activity', brief })).rejects.toThrow('活动需求字段无效');
  });

  it('retains non-rectangular structure restrictions in activity mode', async () => {
    const source = layout(); source.entrance = { width: 2, depth: 1 };
    const document = await activityDoc(source);
    expect(section(document, '同快照摆位示意').textContent).toContain('不适合普通矩形示意');
    expect(document.querySelectorAll('svg')).toHaveLength(0);
    expect(section(document, '全部场景实例').textContent).toContain('物件2 · 同名椅');
  });

  it('shows item notes only in activity scope with an explicit label, escaping text and preserving handoff geometry', async () => {
    const attack = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const source = layout();
    source.floors[0].items[0].notes = attack;
    source.floors[0].items[0].handoff = handoffSchema.parse({ ownerName: '原负责人', dueDate: '2027-02-03', acceptance: '逐件核对', status: 'todo' });
    const before = structuredClone(source);
    const activityHtml = await productionPlanHandoffHtml(source, snapshot, undefined, { scope: 'activity' });
    const activity = new DOMParser().parseFromString(activityHtml, 'text/html');
    const work = section(activity, '逐件物料工作单');
    expect(work.textContent).toContain(attack);
    expect(work.textContent).toMatch(/备注[：:]\s*/);
    expect(work.textContent).toContain('原负责人');
    expect(activity.querySelectorAll('script,img,iframe,object,embed,link,form,[onload],[onerror]')).toHaveLength(0);
    expect(activityHtml).not.toContain('<img');
    const internalHtml = await productionPlanHandoffHtml(source, snapshot);
    expect(internalHtml).not.toContain(attack);
    expect(internalHtml).not.toContain('原负责人');
    const customer = projectReviewHtml(createProjectReviewSnapshot({ layout: source,
      briefSnapshot: { state: 'ready', scope: source.id!, brief: { status: 'absent' } }, snapshot,
      source: { scope: source.id!, revision: 'notes-disclosure-check' }, dataState: 'saved', dataKind: 'rehearsal', disclosure: { brief: false, design: true } }));
    expect(new DOMParser().parseFromString(customer, 'text/html').body.textContent).not.toContain(attack);
    const empty = layout(); empty.floors[0].items[0].notes = ' \t\n ';
    const emptyActivity = new DOMParser().parseFromString(await productionPlanHandoffHtml(empty, snapshot, undefined, { scope: 'activity' }), 'text/html');
    expect(section(emptyActivity, '逐件物料工作单').textContent).toMatch(/备注[：:]\s*未记录/);
    expect(source).toEqual(before);
  });
});
