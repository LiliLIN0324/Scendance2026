import { describe, expect, it } from 'vitest';
import { eventOperationsSchema } from '../../supabase/functions/_shared/event-operations-contract';
import { makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { emptyEventProfile, updateEventProfile } from './event-profile';
import { planTimeZone, renderDaySheet, zoneCalendarDate } from './event-day-sheet';
import { rosterSchema } from './event-roster';
import { declareSupplier, supplierLedgerSchema } from './supplier-declarations';

const generatedAt = '2026-11-18T10:00:00.000Z';
const meta = { updatedBy: '阿岚', updatedAt: '2026-11-18T10:00:00.000Z' };
const withAttendance = (value: number) => updateEventProfile(emptyEventProfile(),
  { expectedAttendance: { value, status: 'inferred', source: 'model_inference', note: '按报名估算' } }, 0, meta);

describe('当天执行包（P1-4）', () => {
  it('按时间排序流程，标出负责人与时长', () => {
    const layout = makeLayout({ id: 'sheet-project', name: '冬季试营业',
      eventOperations: eventOperationsSchema.parse({ dataKind: 'real', tasks: [
        { id: crypto.randomUUID(), title: '撤场', phase: 'teardown' },
        { id: crypto.randomUUID(), title: '签到', phase: 'event', ownerName: '小乙',
          plannedStartAt: '2026-12-20T01:00:00+00:00', plannedEndAt: '2026-12-20T02:30:00+00:00' },
      ] }) });
    const html = renderDaySheet({ layout, generatedAt });
    expect(html).toContain('当天执行包');
    expect(html.indexOf('签到')).toBeLessThan(html.indexOf('撤场'));
    expect(html).toContain('小乙');
    expect(html).toContain('90 分钟');
    expect(html).toContain('不完整');
    expect(html).not.toContain('<script');
  });

  it('人数并列报名与档案预期，不互相推导', () => {
    const layout = makeLayout({ id: 'sheet-roster', eventProfile: withAttendance(60) });
    const roster = rosterSchema.parse({ dataKind: 'real', guests: [
      { id: crypto.randomUUID(), name: '甲', status: 'attended', plusOnes: 1, dietary: '素食' },
      { id: crypto.randomUUID(), name: '乙', status: 'registered', needsTravel: false },
    ] });
    const html = renderDaySheet({ layout, roster, generatedAt });
    expect(html).toContain('报名 1 人');
    expect(html).toContain('预期到场 60 人（推断，需人工确认 · 活动档案）');
    expect(html).toContain('已出席 2 人（含携伴）');
    expect(html).toContain('饮食要求 1 位');
    expect(html).not.toContain('外地抵达');
  });

  it('有人从外地来才出出行段，接站人未记录照实写', () => {
    const roster = rosterSchema.parse({ dataKind: 'real', guests: [
      { id: crypto.randomUUID(), name: '甲', status: 'registered', needsTravel: true },
      { id: crypto.randomUUID(), name: '乙', status: 'attended', needsTravel: true, note: '小乙去接' },
    ] });
    const html = renderDaySheet({ layout: makeLayout({ id: 'sheet-travel' }), roster, generatedAt });
    expect(html).toContain('外地抵达');
    expect(html).toContain('甲 · 接站人未记录');
    expect(html).toContain('乙 · 小乙去接');
  });

  it('供应商按声明给出到达时间与电话', () => {
    const suppliers = declareSupplier(supplierLedgerSchema.parse({ dataKind: 'real' }), {
      supplierName: '搭建公司', status: 'confirmed', declaredBy: '阿岚', declaredAt: generatedAt,
      contactPhone: '13800000000', arrivalAt: '2026-12-20T00:30:00.000Z' });
    const html = renderDaySheet({ layout: makeLayout({ id: 'sheet-supplier' }), suppliers, generatedAt });
    expect(html).toContain('供应商到达');
    expect(html).toContain('搭建公司');
    expect(html).toContain('13800000000');
  });

  it('标题里的标记被转义，演练与真实活动分开命名', () => {
    const layout = makeLayout({ id: 'sheet-escape', eventOperations: eventOperationsSchema.parse({
      dataKind: 'rehearsal', tasks: [{ id: crypto.randomUUID(), title: '<script>alert(1)</script>', phase: 'setup' }] }) });
    const html = renderDaySheet({ layout, generatedAt });
    expect(html).toContain('演练执行包');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('生成于和日历日跟随方案时区，不按 UTC 截断', () => {
    const at = '2026-11-18T10:00:00.000Z';
    const shanghai = makeLayout({ id: 'sheet-zone', name: '发布会' });
    expect(renderDaySheet({ layout: shanghai, generatedAt: at })).toContain('生成于 2026-11-18 18:00（Asia/Shanghai）');
    const kiritimati = makeLayout({
      id: 'sheet-zone-kir',
      planSettings: { timeZone: 'Pacific/Kiritimati' },
    });
    expect(planTimeZone(kiritimati)).toBe('Pacific/Kiritimati');
    expect(zoneCalendarDate(at, 'Pacific/Kiritimati')).toBe('2026-11-19');
    expect(renderDaySheet({ layout: kiritimati, generatedAt: at })).toContain('生成于 2026-11-19 00:00（Pacific/Kiritimati）');
    const invalid = makeLayout({ id: 'sheet-zone-bad', planSettings: { timeZone: 'Mars/Olympus' } });
    expect(planTimeZone(invalid)).toBe('Asia/Shanghai');
    expect(renderDaySheet({ layout: invalid, generatedAt: at })).toContain('（Asia/Shanghai）');
  });
});
