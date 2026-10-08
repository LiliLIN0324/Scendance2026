// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventOperationsSchema } from '../../supabase/functions/_shared/event-operations-contract';
import { sceneSchema } from '../../supabase/functions/_shared/domain';
import { productionPlanSchema, type ProductionPlan } from '../../supabase/functions/_shared/production-plan-contract';
import { makeFloor, makeItem, makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import type { RoomLayout } from '../components/room-organizer/lib/types';
import * as operations from '../components/room-organizer/lib/event-operations';
import { operationBasis, operationReview, OPERATION_STATUS_LABELS } from '../components/room-organizer/lib/event-operations';
import { productionPlanHandoffHtml } from './production-plan-export';

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
const doc = async (source: RoomLayout = layout()) => new DOMParser().parseFromString(await productionPlanHandoffHtml(source, snapshot), 'text/html');
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
