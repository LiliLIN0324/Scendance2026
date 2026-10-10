// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventOperationsSchema, type EventOperationTask } from '../../supabase/functions/_shared/event-operations-contract';
import {
  materialCheckinLedgerSchema, materialCheckinSheetSchema, materialCheckinSummary, projectMaterialCheckinEvents,
  type MaterialCheckinEvent, type MaterialCheckinLedger, type MaterialCheckinSheet,
} from '../../supabase/functions/_shared/material-checkin-contract';
import { productionPlanSchema } from '../../supabase/functions/_shared/production-plan-contract';
import { makeFloor, makeItem, makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import * as operations from '../components/room-organizer/lib/event-operations';
import { operationBasis, operationReview, OPERATION_STATUS_LABELS } from '../components/room-organizer/lib/event-operations';
import { executionTimetableHtml } from './execution-timetable-export';
import type { DeliverySnapshot } from '../components/room-organizer/lib/scene-delivery';
import type { RoomLayout } from '../components/room-organizer/lib/types';

const id = (n: number) => `ac200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const snapshot: DeliverySnapshot = { id: 'execution-freeze-001', generatedAt: '2026-10-09T01:30:15.123Z' };
const task = (number: number, fields: Partial<EventOperationTask> = {}): EventOperationTask => eventOperationsSchema.parse({
  tasks: [{ id: id(number), title: `原任务${number}`, phase: 'preparation', ownerName: '负责人甲',
    acceptance: '核对原完成条件', plannedStartAt: '2027-02-03T10:00:00+08:00', ...fields }],
}).tasks[0];

function layout(tasks: EventOperationTask[] = [task(20, { title: '布置签到台', phase: 'setup', contractorName: '原承接方',
  objectIds: [id(30)], plannedEndAt: '2027-02-03T11:00:00+08:00' }),
task(21, { title: '与场地方核对时段', ownerName: '负责人乙', objectIds: [] })]): RoomLayout {
  return makeLayout({ id: id(1), name: '执行资料原项目', roof: { style: 'none' },
    floors: [makeFloor({ items: [makeItem({ id: id(30), name: '场景椅', width: 0.5, depth: 0.5, height: 0.85,
      notes: 'PRIVATE_ITEM_NOTE', assetId: id(99), glbUrl: 'https://private.example/model.glb?token=PRIVATE_TOKEN' })] })],
    eventOperations: eventOperationsSchema.parse({ tasks }),
    productionPlan: productionPlanSchema.parse({
      staffing: [{ id: id(10), roleName: '计划岗位', headcount: 2, sourceName: '岗位来源', taskIds: [id(20)] }],
      acquisitions: [{ id: id(11), title: '椅租赁原记录', method: 'rental', supplierName: '供应方乙',
        specificationNote: '原规格说明', taskIds: [id(20)], objectIds: [id(30)] }],
    }),
  });
}

function payload(quantity: number | null, checkState: 'pending' | 'checked' | 'disputed' = 'checked') {
  return { batchRef: '原批次', quantity, checkState, occurredAt: '2027-02-03T09:00:00+08:00',
    fromPartyName: '交出方', toPartyName: '接收方', evidenceNote: '原核对说明', evidenceUrls: ['https://evidence.example/a?x=1&y=2'] };
}
function movement(number: number, kind: 'receive' | 'return', quantity: number | null,
  checkState: 'pending' | 'checked' | 'disputed' = 'checked'): MaterialCheckinEvent {
  return { id: id(number), kind, ...payload(quantity, checkState),
    occurredAt: kind === 'receive' ? '2027-02-03T09:00:00+08:00' : '2027-02-03T17:00:00+08:00',
    recordedAt: kind === 'receive' ? '2027-02-03T09:05:00+08:00' : '2027-02-03T17:05:00+08:00', recordedBy: '原记录人' };
}
function sheet(seed = 200, unit: 'piece' | 'set' = 'piece'): MaterialCheckinSheet {
  return materialCheckinSheetSchema.parse({ id: id(seed), acquisitionId: id(11), unit,
    acquisitionSnapshot: { title: '椅租赁原记录', supplierName: '供应方乙', specificationNote: '原规格说明' },
    agreements: [{ id: id(seed + 1), agreedQuantity: 20, basisNote: '原约定依据',
      recordedAt: '2027-02-03T08:00:00+08:00', recordedBy: '原约定人' }],
    events: [movement(seed + 10, 'receive', 18), movement(seed + 11, 'return', 18)],
  });
}
const ledger = (sheets: MaterialCheckinSheet[] = [sheet()]): MaterialCheckinLedger =>
  materialCheckinLedgerSchema.parse({ projectId: id(1), sheets });
const documentOf = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const doc = async (source = layout(), facts?: MaterialCheckinLedger) => documentOf(await executionTimetableHtml(source, snapshot, facts));
function taskArticle(document: Document, taskId = id(20)): HTMLElement {
  const value = [...document.querySelectorAll<HTMLElement>('#chronology article[data-task-id]')]
    .find(article => article.dataset.taskId === taskId);
  if (!value) throw new Error(`Missing task ${taskId}`);
  return value;
}
function checkArticle(document: Document, sheetId = id(200)): HTMLElement {
  const value = [...document.querySelectorAll<HTMLElement>('#checks article[data-sheet-id]')]
    .find(article => article.dataset.sheetId === sheetId);
  if (!value) throw new Error(`Missing check sheet ${sheetId}`);
  return value;
}
function quantity(article: HTMLElement, name: string): string {
  const value = article.querySelector<HTMLElement>(`[data-quantity="${name}"]`);
  if (!value) throw new Error(`Missing quantity ${name}`);
  return (value.querySelector('dd') ?? value).textContent!.trim();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function acceptedLayout(facts?: MaterialCheckinLedger) {
  const source = layout(), first = source.eventOperations!.tasks[0];
  first.status = 'accepted'; first.evidenceNote = '原现场核对说明，后续仍需按当前资料复核';
  first.reviewedBasis = await operationBasis(source, first, facts);
  return source;
}
function noActiveContent(document: Document) {
  expect(document.querySelectorAll('script,img,iframe,object,embed,link,form,[onload],[onerror]')).toHaveLength(0);
  for (const element of document.querySelectorAll('*')) {
    expect([...element.attributes].some(attribute => /^on/i.test(attribute.name))).toBe(false);
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href]')) expect(link.getAttribute('href')).toMatch(/^#/);
}

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('execution timetable HTML', () => {
  it('retains every phase, task number, people and condition, including tasks without objects or plan links', async () => {
    const tasks = [task(20, { phase: 'preparation', objectIds: [id(30)], contractorName: '原承接方' }),
      task(21, { phase: 'setup', objectIds: [], ownerName: '负责人乙' }),
      task(22, { phase: 'event', objectIds: [], ownerName: '' }), task(23, { phase: 'teardown', objectIds: [] })];
    const document = await doc(layout(tasks)), articles = [...document.querySelectorAll('#chronology article[data-task-id]')];
    expect(articles).toHaveLength(4);
    expect(articles.map(article => article.getAttribute('data-task-id'))).toEqual(tasks.map(row => row.id));
    for (const [index, row] of tasks.entries()) {
      const article = taskArticle(document, row.id);
      expect(article.textContent).toContain(`任务${index + 1}`);
      expect(article.textContent).toContain(row.title);
      expect(article.querySelector('.acceptance')!.textContent).toContain(row.acceptance);
      expect(article.querySelector('details')!.textContent).toContain(row.id);
      expect(article.id).toBe(`task-${index + 1}`);
    }
    expect(taskArticle(document).querySelector('.people')!.textContent).toContain('原承接方');
    expect(taskArticle(document, id(22)).querySelector('.people')!.textContent).toMatch(/待确认|未填写/);
    const links = [...document.querySelectorAll<HTMLAnchorElement>('#owners a[data-task-ref]')];
    expect(links).toHaveLength(4);
    expect(links.map(link => link.dataset.taskRef).sort()).toEqual(tasks.map(row => row.id).sort());
    for (const link of links) expect(document.querySelector(link.getAttribute('href')!)?.getAttribute('data-task-id')).toBe(link.dataset.taskRef);
    for (const name of ['chronology', 'owners', 'checks', 'provenance']) expect(document.getElementById(name)).not.toBeNull();
  });

  it('groups by Shanghai date and orders by the true instant with stable source order for equal instants', async () => {
    const tasks = [task(20, { plannedStartAt: '2027-01-01T01:30:00+09:00' }),
      task(21, { plannedStartAt: '2026-12-31T16:00:00Z' }),
      task(22, { plannedStartAt: '2027-01-01T00:00:00+08:00' }),
      task(23, { plannedStartAt: '2027-01-01T00:00:00+09:00' })];
    const document = await doc(layout(tasks));
    expect([...document.querySelectorAll('#chronology article[data-task-id]')].map(row => row.getAttribute('data-task-id')))
      .toEqual([id(23), id(21), id(22), id(20)]);
    expect(taskArticle(document, id(23)).closest('[data-day]')!.getAttribute('data-day')).toBe('2026-12-31');
    for (const value of [20, 21, 22]) expect(taskArticle(document, id(value)).closest('[data-day]')!.getAttribute('data-day')).toBe('2027-01-01');
    expect(taskArticle(document, id(23)).querySelector('.planned')!.textContent).toContain('23:00');
    expect(taskArticle(document, id(21)).querySelector('details')!.textContent).toContain('2026-12-31T16:00:00Z');
  });

  it('places missing planned starts last without inventing a start from the planned end or actual dates', async () => {
    const tasks = [task(20, { plannedStartAt: null, plannedEndAt: '2027-02-03T11:00:00+08:00',
      actualStartedAt: '2027-02-03T09:00:00+08:00', actualFinishedAt: '2027-02-03T09:30:00+08:00' }),
    task(21, { plannedStartAt: '2027-02-03T10:00:00+08:00' }), task(22, { plannedStartAt: null })];
    const document = await doc(layout(tasks));
    expect([...document.querySelectorAll('#chronology article[data-task-id]')].map(row => row.getAttribute('data-task-id')))
      .toEqual([id(21), id(20), id(22)]);
    expect(taskArticle(document).closest('[data-day]')!.getAttribute('data-day')).toBe('unknown');
    expect(taskArticle(document, id(22)).closest('[data-day]')!.getAttribute('data-day')).toBe('unknown');
    expect(taskArticle(document).querySelector('.planned')!.textContent).toMatch(/待确认|未填写|待安排/);
    expect(taskArticle(document).querySelector('.actual')!.textContent).toContain('09:00');
    expect(taskArticle(document).querySelector('.actual')!.textContent).toContain('09:30');
    expect(taskArticle(document).querySelector('.planned')!.textContent).not.toContain('09:00');
    expect(taskArticle(document, id(22)).querySelector('.actual')!.textContent).toMatch(/待确认|未填写|未记录/);
    expect(taskArticle(document, id(22)).querySelector('.actual')!.textContent).not.toContain('10:00');
  });

  it('keeps seconds, milliseconds, original offsets and independent unknown actual timestamps', async () => {
    const first = task(20, { plannedStartAt: '2027-02-03T00:00:15.123Z', plannedEndAt: null,
      actualStartedAt: null, actualFinishedAt: '2027-02-03T10:05:20.456+08:00' });
    const article = taskArticle(await doc(layout([first])));
    expect(article.querySelector('.planned')!.textContent).toContain('08:00:15.123');
    expect(article.querySelector('.planned')!.textContent).toMatch(/待确认|未填写|待安排/);
    expect(article.querySelector('.actual')!.textContent).toContain('10:05:20.456');
    expect(article.querySelector('.actual')!.textContent).toMatch(/待确认|未填写|未记录/);
    for (const value of [first.plannedStartAt!, first.actualFinishedAt!]) expect(article.querySelector('details')!.textContent).toContain(value);
  });

  it.each(['geometry', 'production', 'ledger'] as const)('recomputes stale accepted %s against the real frozen basis without changing raw status or evidence', async changed => {
    const facts = ledger(), source = await acceptedLayout(facts), first = source.eventOperations!.tasks[0];
    if (changed === 'geometry') source.floors[0].items[0].width = 0.6;
    if (changed === 'production') source.productionPlan!.acquisitions[0].supplierName = '当前变更供应方';
    if (changed === 'ledger') {
      const receive = facts.sheets[0].events[0];
      if (receive.kind !== 'receive') throw new Error('Missing receive fixture');
      receive.quantity = 19;
    }
    expect((await operationReview(source, first, facts)).status).toBe('needs_review');
    const before = JSON.stringify({ source, facts }), article = taskArticle(await doc(source, facts));
    expect(article.querySelector('.record')!.textContent).toContain(OPERATION_STATUS_LABELS.accepted);
    expect(article.querySelector('.record')!.textContent).toContain(OPERATION_STATUS_LABELS.needs_review);
    expect(article.textContent!.match(new RegExp(OPERATION_STATUS_LABELS.accepted, 'g'))).toHaveLength(1);
    expect(article.textContent).toContain(first.evidenceNote);
    expect(JSON.stringify({ source, facts })).toBe(before);
  });

  it('keeps a current accepted status distinct from actual timestamps and rental quantities', async () => {
    const facts = ledger(), source = await acceptedLayout(facts), article = taskArticle(await doc(source, facts));
    expect(article.querySelector('.record')!.textContent!.match(new RegExp(OPERATION_STATUS_LABELS.accepted, 'g'))).toHaveLength(2);
    expect(article.querySelector('.record')!.textContent).not.toContain(OPERATION_STATUS_LABELS.needs_review);
    expect(article.querySelector('.actual')!.textContent).toMatch(/待确认|未填写|未记录/);
    expect(article.querySelector('.actual')!.textContent).not.toContain('09:00');
    expect(source.eventOperations!.tasks[0].actualStartedAt).toBeNull();
    expect(source.eventOperations!.tasks[0].actualFinishedAt).toBeNull();
  });

  it('still reviews accepted communication tasks against their current venue even without object references', async () => {
    const source = layout([task(21, { objectIds: [], title: '场地沟通' })]), first = source.eventOperations!.tasks[0];
    delete source.productionPlan;
    first.status = 'accepted'; first.evidenceNote = '原沟通核对说明'; first.reviewedBasis = await operationBasis(source, first);
    source.width = 9;
    const article = taskArticle(await doc(source), id(21));
    expect(article.querySelector('.record')!.textContent).toContain(OPERATION_STATUS_LABELS.accepted);
    expect(article.querySelector('.record')!.textContent).toContain(OPERATION_STATUS_LABELS.needs_review);
    expect(article.textContent).toContain('场地沟通');
    expect(first.objectIds).toEqual([]);
  });

  it('does not export an accepted communication task as confirmed when unrelated source objects have ambiguous canonical IDs', async () => {
    const source = layout([task(21, { objectIds: [], title: '场地沟通' })]), first = source.eventOperations!.tasks[0];
    delete source.productionPlan;
    source.floors[0].items.push(makeItem({ id: id(30).toUpperCase(), name: '同编号歧义来源' }));
    first.status = 'accepted'; first.evidenceNote = '原沟通核对说明'; first.reviewedBasis = await operationBasis(source, first);
    expect((await operationReview(source, first)).status).toBe('accepted');
    const before = JSON.stringify(source), article = taskArticle(await doc(source), id(21));
    expect(article.querySelector('.record')!.textContent).toContain(OPERATION_STATUS_LABELS.accepted);
    expect(article.querySelector('.record')!.textContent).toMatch(/有效状态.*需核对.*关联编号不唯一/);
    expect(article.querySelector('.record')!.textContent!.match(new RegExp(OPERATION_STATUS_LABELS.accepted, 'g'))).toHaveLength(1);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('does not treat UUID case-duplicate object references as separate unique sources for an accepted task', async () => {
    const source = layout(), first = source.eventOperations!.tasks[0];
    first.objectIds = [id(30), id(30).toUpperCase()];
    first.status = 'accepted'; first.evidenceNote = '原实例核对说明'; first.reviewedBasis = await operationBasis(source, first);
    expect(eventOperationsSchema.safeParse(source.eventOperations).success).toBe(true);
    expect((await operationReview(source, first)).status).toBe('accepted');
    const article = taskArticle(await doc(source));
    expect(article.querySelector('.record')!.textContent).toMatch(/有效状态.*需核对.*关联编号不唯一/);
    expect(article.querySelector('.record')!.textContent!.match(new RegExp(OPERATION_STATUS_LABELS.accepted, 'g'))).toHaveLength(1);
    expect(first.status).toBe('accepted');
  });

  it.each(['throws', 'crypto unavailable'] as const)('keeps failed %s effective review unconfirmed and does not leak internal errors', async failure => {
    const source = await acceptedLayout();
    if (failure === 'throws') vi.spyOn(operations, 'operationReview').mockRejectedValue(new Error('PRIVATE_FAILURE https://private.example/?token=SECRET'));
    else vi.stubGlobal('crypto', undefined);
    const document = await doc(source), article = taskArticle(document);
    expect(article.querySelector('.record')!.textContent).toMatch(/待核对.*复核未完成/);
    expect(article.querySelector('.record')!.textContent!.match(new RegExp(OPERATION_STATUS_LABELS.accepted, 'g'))).toHaveLength(1);
    expect(document.body.textContent).not.toContain('PRIVATE_FAILURE');
    expect(document.body.textContent).not.toContain('private.example');
    expect(source.eventOperations!.tasks[0].status).toBe('accepted');
  });

  it('escapes visible source and provenance text, retains opaque original IDs as text and uses fixed safe anchors', async () => {
    const attack = '\"><img src=x onerror=alert(1)><script>x()</script>&\'';
    const source = layout(); source.id = attack; source.name = attack; source.floors[0].items[0].id = attack;
    source.eventOperations!.tasks[0].objectIds = [attack];
    for (const field of ['title', 'ownerName', 'contractorName', 'acceptance', 'evidenceNote'] as const) source.eventOperations!.tasks[0][field] = attack;
    source.eventOperations!.tasks[0].evidenceUrls = ['https://evidence.example/a?x=%22%3E&y=1'];
    source.productionPlan!.acquisitions[0].objectIds = [attack];
    const metadata = { ...snapshot, id: attack }, facts = ledger(); facts.projectId = attack;
    const check = facts.sheets[0];
    for (const field of ['title', 'supplierName', 'specificationNote'] as const) check.acquisitionSnapshot[field] = attack;
    check.agreements[0].basisNote = attack; check.agreements[0].recordedBy = attack;
    for (const event of check.events) {
      if (event.kind !== 'receive' && event.kind !== 'return') throw new Error('Missing movement fixture');
      for (const field of ['batchRef', 'fromPartyName', 'toPartyName', 'recordedBy', 'evidenceNote'] as const) event[field] = attack;
    }
    check.events.push({ id: id(212), kind: 'correction', targetId: id(210), reason: attack,
      replacement: { ...payload(18), batchRef: attack, fromPartyName: attack, toPartyName: attack, evidenceNote: attack },
      recordedAt: '2027-02-03T09:10:00+08:00', recordedBy: attack },
    { id: id(213), kind: 'void', targetId: id(212), reason: attack, evidenceNote: attack,
      evidenceUrls: ['https://evidence.example/void?x=%22%3E&y=1'], recordedAt: '2027-02-03T09:15:00+08:00', recordedBy: attack });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const html = await executionTimetableHtml(source, metadata, facts), document = documentOf(html);
    noActiveContent(document);
    expect(document.querySelector('.subtitle')!.textContent).toContain(attack);
    expect(document.querySelector('#provenance')!.textContent).toContain(attack);
    const first = taskArticle(document);
    for (const selector of ['.people', '.acceptance', 'details']) expect(first.querySelector(selector)!.textContent).toContain(attack);
    expect(first.id).toBe('task-1'); expect(first.dataset.taskId).toBe(id(20));
    expect(checkArticle(document).textContent).toContain(attack);
    expect(document.body.textContent).toContain('https://evidence.example/a?x=%22%3E&y=1');
    expect(html).toContain('&lt;script&gt;');
    expect(fetch).not.toHaveBeenCalled();
    for (const privateValue of ['PRIVATE_', 'private.example', 'reviewedBasis', '"floors":', '"tasks":']) expect(html).not.toContain(privateValue);
    const ids = [...document.querySelectorAll<HTMLElement>('[id]')].map(element => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('shows 20 agreed, 18 received, 18 returned as sheet gaps 2 and 0 rather than stock, loss or overall completion', async () => {
    const facts = ledger(), before = JSON.stringify(facts), document = await doc(layout(), facts), article = checkArticle(document);
    expect(materialCheckinSummary(facts.sheets[0])).toMatchObject({ agreedQuantity: 20, receivedQuantity: 18,
      returnedQuantity: 18, notReceivedQuantity: 2, notReturnedQuantity: 0 });
    for (const [name, value] of [['agreedQuantity', 20], ['receivedQuantity', 18], ['returnedQuantity', 18],
      ['notReceivedQuantity', 2], ['notReturnedQuantity', 0]] as const) expect(quantity(article, name)).toContain(`${value} 件`);
    expect(document.body.textContent).not.toMatch(/(?:库存|损耗|完成率)[：:\s]*(?:18|20|2|0|90)|90\s*%/);
    expect(document.body.textContent).toContain('场景');
    expect(JSON.stringify(facts)).toBe(before);
  });

  it('keeps pending and disputed values out of full totals while displaying only the actual checked partial amounts', async () => {
    const facts = ledger(); facts.sheets[0].events.push(movement(212, 'receive', 2, 'pending'), movement(213, 'return', 1, 'disputed'));
    expect(materialCheckinSummary(facts.sheets[0])).toMatchObject({ receivedQuantity: null, returnedQuantity: null,
      knownReceivedQuantity: 18, knownReturnedQuantity: 18, notReceivedQuantity: null, notReturnedQuantity: null });
    const article = checkArticle(await doc(layout(), facts));
    for (const name of ['receivedQuantity', 'returnedQuantity', 'notReceivedQuantity', 'notReturnedQuantity']) expect(quantity(article, name)).toContain('待确认');
    for (const name of ['knownReceivedQuantity', 'knownReturnedQuantity']) expect(quantity(article, name)).toContain('18 件');
    expect(article.textContent).toContain('待核'); expect(article.textContent).toContain('争议');
  });

  it('keeps an unknown agreement gap unknown despite fully checked matching receive and return quantities', async () => {
    const facts = ledger(); facts.sheets[0].agreements[0].agreedQuantity = null; facts.sheets[0].agreements[0].basisNote = '';
    const article = checkArticle(await doc(layout(), facts));
    expect(quantity(article, 'agreedQuantity')).toContain('待确认');
    expect(quantity(article, 'notReceivedQuantity')).toContain('待确认');
    expect(quantity(article, 'receivedQuantity')).toContain('18 件');
    expect(quantity(article, 'returnedQuantity')).toContain('18 件');
    expect(quantity(article, 'notReturnedQuantity')).toContain('0 件');
  });

  it('shows over-received and over-returned gaps as review issues without clamping them into ordinary zero gaps', async () => {
    const facts = ledger();
    for (const event of facts.sheets[0].events) if (event.kind === 'receive' || event.kind === 'return') event.quantity = event.kind === 'receive' ? 21 : 22;
    expect(materialCheckinSummary(facts.sheets[0])).toMatchObject({ notReceivedQuantity: null, notReturnedQuantity: null,
      overReceivedQuantity: 1, overReturnedQuantity: 1, needsReview: true });
    const article = checkArticle(await doc(layout(), facts));
    expect(quantity(article, 'notReceivedQuantity')).toContain('待确认');
    expect(quantity(article, 'notReturnedQuantity')).toContain('待确认');
    expect(quantity(article, 'overReceivedQuantity')).toContain('1 件');
    expect(quantity(article, 'overReturnedQuantity')).toContain('1 件');
    expect(article.textContent).toContain('需复核');
  });

  it.each(['unknown', 'no events', 'zero'] as const)('keeps %s quantities distinct from invented zeros', async kind => {
    const facts = ledger(), check = facts.sheets[0];
    if (kind === 'unknown') {
      check.agreements[0].agreedQuantity = null; check.agreements[0].basisNote = '';
      for (const event of check.events) if (event.kind === 'receive' || event.kind === 'return') { event.quantity = null; event.checkState = 'pending'; }
    } else if (kind === 'no events') check.events = [];
    else {
      check.agreements[0].agreedQuantity = 0;
      for (const event of check.events) if (event.kind === 'receive' || event.kind === 'return') event.quantity = 0;
    }
    const article = checkArticle(await doc(layout(), facts));
    for (const name of ['receivedQuantity', 'returnedQuantity', 'knownReceivedQuantity', 'knownReturnedQuantity', 'notReceivedQuantity', 'notReturnedQuantity']) {
      expect(quantity(article, name)).toContain(kind === 'zero' ? '0 件' : '待确认');
      if (kind !== 'zero') expect(quantity(article, name)).not.toContain('0 件');
    }
    expect(quantity(article, 'agreedQuantity')).toContain(kind === 'unknown' ? '待确认' : kind === 'zero' ? '0 件' : '20 件');
  });

  it('follows current corrections and voids without adding historical quantities and preserves their reasons', async () => {
    const facts = ledger(), check = facts.sheets[0];
    check.events.push({ id: id(212), kind: 'correction', targetId: id(210), reason: '更正原数量至16',
      replacement: payload(16), recordedAt: '2027-02-03T09:10:00+08:00', recordedBy: '更正人' },
    { id: id(213), kind: 'correction', targetId: id(212), reason: '复核更正为18', replacement: payload(18),
      recordedAt: '2027-02-03T09:15:00+08:00', recordedBy: '复核人' },
    movement(214, 'receive', 18), { id: id(215), kind: 'void', targetId: id(214), reason: '重复原收取作废',
      evidenceNote: '原作废依据', evidenceUrls: ['https://evidence.example/void'],
      recordedAt: '2027-02-03T09:20:00+08:00', recordedBy: '作废人' });
    expect(projectMaterialCheckinEvents(check)).toMatchObject({ effectiveEvents: [
      { rootEventId: id(210), effectiveEventId: id(213), quantity: 18 }, { rootEventId: id(211), quantity: 18 }], voidedRootIds: [id(214)] });
    const article = checkArticle(await doc(layout(), facts));
    expect(quantity(article, 'receivedQuantity')).toContain('18 件');
    expect(quantity(article, 'notReceivedQuantity')).toContain('2 件');
    expect(quantity(article, 'receivedQuantity')).not.toMatch(/(?:34|36|52) 件/);
    for (const value of ['更正原数量至16', '复核更正为18', '重复原收取作废', '原作废依据', id(212), id(213), id(215)]) expect(article.textContent).toContain(value);
  });

  it('never combines piece and set sheets into a ledger total', async () => {
    const set = sheet(300, 'set'); set.agreements[0].agreedQuantity = 2;
    for (const event of set.events) if (event.kind === 'receive' || event.kind === 'return') event.quantity = event.kind === 'receive' ? 2 : 1;
    const document = await doc(layout(), ledger([sheet(), set]));
    expect(document.querySelectorAll('#checks article[data-sheet-id]')).toHaveLength(2);
    expect(quantity(checkArticle(document), 'receivedQuantity')).toContain('18 件');
    expect(quantity(checkArticle(document, id(300)), 'receivedQuantity')).toContain('2 套');
    expect(quantity(checkArticle(document, id(300)), 'notReturnedQuantity')).toContain('1 套');
    expect(document.querySelector('#checks')!.textContent).not.toMatch(/收取合计[：:\s]*20|数量合计[：:\s]*22/);
  });

  it('freezes layout, metadata and independent ledger before awaiting review and has no source or external side effects', async () => {
    const source = layout(), facts = ledger(), metadata = { ...snapshot };
    const pending = deferred<Awaited<ReturnType<typeof operationReview>>>(), started = deferred<void>();
    const review = vi.spyOn(operations, 'operationReview').mockImplementation(() => { started.resolve(); return pending.promise; });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const output = executionTimetableHtml(source, metadata, facts); await started.promise;
    expect(review.mock.calls[0][0]).not.toBe(source); expect(review.mock.calls[0][1]).not.toBe(source.eventOperations!.tasks[0]);
    expect(review.mock.calls[0][2]).not.toBe(facts);
    source.name = 'LATER_PROJECT'; source.eventOperations!.tasks[0].title = 'LATER_TASK';
    source.eventOperations!.tasks[0].ownerName = 'LATER_OWNER'; source.floors[0].items[0].width = 8;
    source.productionPlan!.acquisitions[0].supplierName = 'LATER_SUPPLIER';
    facts.sheets[0].agreements[0].agreedQuantity = 999;
    const receive = facts.sheets[0].events[0];
    if (receive.kind !== 'receive') throw new Error('Missing receive fixture');
    receive.quantity = 999; receive.fromPartyName = 'LATER_PARTY';
    metadata.id = 'LATER_ID'; metadata.generatedAt = '2029-01-01T00:00:00Z';
    pending.resolve({ status: 'todo', missingObjectIds: [] });
    const html = await output, document = documentOf(html);
    expect(document.body.textContent).toContain('执行资料原项目'); expect(document.body.textContent).toContain('布置签到台');
    expect(document.querySelector('#provenance')!.textContent).toContain(snapshot.id);
    expect(document.querySelector('#provenance')!.textContent).toContain(snapshot.generatedAt);
    expect(quantity(checkArticle(document), 'agreedQuantity')).toContain('20 件');
    expect(quantity(checkArticle(document), 'receivedQuantity')).toContain('18 件');
    expect(html).not.toContain('LATER_'); expect(fetch).not.toHaveBeenCalled();
  });

  it('is deterministic for identical frozen inputs and explicit metadata and does not mutate them', async () => {
    const source = await acceptedLayout(ledger()), facts = ledger(), before = JSON.stringify({ source, facts, snapshot });
    const first = await executionTimetableHtml(source, snapshot, facts);
    expect(await executionTimetableHtml(source, snapshot, facts)).toBe(first);
    expect(JSON.stringify({ source, facts, snapshot })).toBe(before);
  });

  it('does not apply rehearsal or demonstration dates to ordinary unspecified or real projects', async () => {
    const source = layout();
    for (const dataKind of ['unspecified', 'real'] as const) {
      source.eventOperations!.dataKind = dataKind; source.productionPlan!.dataKind = dataKind;
      const document = await doc(source);
      expect(document.querySelector('h1')!.textContent).not.toContain('演练');
      expect(document.body.textContent).not.toContain('10月17日');
      expect(document.body.textContent).not.toContain('2026-10-17');
      expect(taskArticle(document).closest('[data-day]')!.getAttribute('data-day')).toBe('2027-02-03');
    }
    source.eventOperations!.dataKind = 'rehearsal';
    expect((await doc(source)).body.textContent).toContain('假设演练');
  });

  it.each(['absent tasks', 'empty tasks'] as const)('provides a clear %s empty state without synthesizing plan tasks or zero ledger totals', async state => {
    const source = layout();
    if (state === 'absent tasks') delete source.eventOperations;
    else source.eventOperations = eventOperationsSchema.parse({});
    const document = await doc(source);
    expect(document.querySelectorAll('#chronology article[data-task-id]')).toHaveLength(0);
    expect(document.querySelector('#chronology')!.textContent).toMatch(/尚未|尚无|未记录|暂无/);
    expect(document.querySelectorAll('#owners a[data-task-ref]')).toHaveLength(0);
    expect(document.querySelectorAll('#checks article[data-sheet-id]')).toHaveLength(0);
    expect(document.querySelector('#checks')!.textContent).toMatch(/未记录|未提供|待确认/);
  });

  it('exports original task arrangements without a production plan or ledger', async () => {
    const source = layout(); delete source.productionPlan;
    const document = await doc(source);
    expect(document.querySelectorAll('#chronology article[data-task-id]')).toHaveLength(2);
    expect(document.querySelector('#provenance')!.textContent).toContain('制作计划：当前未记录');
    expect(document.querySelector('#checks')!.textContent).toContain('待确认');
    expect(source.productionPlan).toBeUndefined();
  });

  it('distinguishes an explicitly empty ledger from no supplied ledger without fabricating zero quantities', async () => {
    const empty = await doc(layout(), ledger([])), absent = await doc();
    expect(empty.querySelectorAll('#checks article[data-sheet-id]')).toHaveLength(0);
    expect(empty.querySelector('#checks')!.textContent).toContain('未记录点验单');
    expect(absent.querySelector('#checks')!.textContent).toContain('未提供点验账册');
    for (const document of [empty, absent]) expect(document.querySelector('#checks')!.textContent).not.toMatch(/(?:收取|退回|差额)[：:\s]*0 件/);
  });

  it.each(['blank id', 'invalid timestamp', 'missing offset', 'extra field'] as const)('rejects invalid metadata: %s', async reason => {
    const metadata: DeliverySnapshot = { ...snapshot };
    if (reason === 'blank id') metadata.id = '   ';
    if (reason === 'invalid timestamp') metadata.generatedAt = '2027-02-30T00:00:00+08:00';
    if (reason === 'missing offset') metadata.generatedAt = '2027-02-03T00:00:00';
    if (reason === 'extra field') Object.assign(metadata, { leak: 'PRIVATE_METADATA' });
    await expect(executionTimetableHtml(layout(), metadata)).rejects.toThrow();
  });

  it.each(['invalid status', 'injected task id', 'duplicate task id', 'reversed times', 'invalid plan', 'invalid ledger', 'project mismatch'] as const)
    ('rejects %s before issuing an apparently valid file', async reason => {
      const source = layout(), facts = ledger();
      if (reason === 'invalid status') Object.assign(source.eventOperations!.tasks[0], { status: 'done' });
      if (reason === 'injected task id') source.eventOperations!.tasks[0].id = '\"><script>x()</script>';
      if (reason === 'duplicate task id') source.eventOperations!.tasks.push({ ...source.eventOperations!.tasks[0], id: id(20).toUpperCase() });
      if (reason === 'reversed times') source.eventOperations!.tasks[0].plannedEndAt = '2027-02-03T09:00:00+08:00';
      if (reason === 'invalid plan') Object.assign(source.productionPlan!.acquisitions[0], { method: 'borrowed' });
      if (reason === 'invalid ledger') Object.assign(facts.sheets[0].events[0], { quantity: -1 });
      if (reason === 'project mismatch') facts.projectId = id(2);
      await expect(executionTimetableHtml(source, snapshot, facts)).rejects.toThrow();
    });

  it('rejects input getters and serializers without executing them', async () => {
    const source = layout(), getter = vi.fn(() => 'PRIVATE_GETTER');
    Object.defineProperty(source, 'name', { enumerable: true, get: getter });
    await expect(executionTimetableHtml(source, snapshot)).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();
    const facts = ledger(), serializer = vi.fn(() => ({})); Object.assign(facts, { toJSON: serializer });
    await expect(executionTimetableHtml(layout(), snapshot, facts)).rejects.toThrow();
    expect(serializer).not.toHaveBeenCalled();
  });

  it('puts nonblank evidence in the print-visible task body, preserves source details, and does not invent handling for blank notes', async () => {
    const attack = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const source = layout([task(20, { evidenceNote: attack }), task(21, { evidenceNote: ' \t\n ' })]);
    const before = structuredClone(source);
    const document = await doc(source);
    const first = taskArticle(document, id(20));
    const main = first.querySelector('.work')!.cloneNode(true) as HTMLElement;
    main.querySelectorAll('details').forEach(value => value.remove());
    expect(main.textContent).toContain(attack);
    expect(first.querySelector('details')!.textContent).toContain(id(20));
    expect(first.querySelector('details')!.textContent).toContain('2027-02-03T10:00:00+08:00');
    expect(document.querySelectorAll('script,img,iframe,object,embed,link,form,[onload],[onerror]')).toHaveLength(0);
    expect(document.querySelector('style')!.textContent).toContain('@media print');
    expect(document.querySelector('style')!.textContent).toContain('.task details{display:none}');
    const blank = taskArticle(document, id(21));
    const blankMain = blank.querySelector('.work')!.cloneNode(true) as HTMLElement;
    blankMain.querySelectorAll('details').forEach(value => value.remove());
    expect(blankMain.textContent).not.toContain('已处理');
    expect(source).toEqual(before);
  });
});
