import { describe, expect, it } from 'vitest';
import { eventOperationTaskSchema, eventOperationsSchema } from '../../supabase/functions/_shared/event-operations-contract';
import { makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { parseStoredLayout } from '../components/room-organizer/lib/schema';
import { createLocalProjectBackupV3, parseLocalProjectBackupJson, serializeLocalProjectBackupV3 } from './local-project-backup';

const taskId = 'a1000000-0000-4000-8000-000000000001';
const scope = 'task-contact-project';
const createdAt = '2026-10-07T09:30:00.000Z';

const task = (overrides: Record<string, unknown> = {}) => ({ id: taskId, title: '签到', phase: 'event', ...overrides });

describe('活动任务的现场联系人与区域（P1-1）', () => {
  it('旧任务没有新字段时保持缺省，不补空字符串', () => {
    const parsed = eventOperationTaskSchema.parse(task());
    expect(parsed).not.toHaveProperty('contactName');
    expect(parsed).not.toHaveProperty('contactPhone');
    expect(parsed).not.toHaveProperty('zoneId');
  });

  it('记录联系人与区域后按原文保留', () => {
    const parsed = eventOperationTaskSchema.parse(task({
      contactName: '场地值班小乙', contactPhone: '+86 138-0000 0000', zoneId: 'zone-entry',
    }));
    expect(parsed.contactName).toBe('场地值班小乙');
    expect(parsed.contactPhone).toBe('+86 138-0000 0000');
    expect(parsed.zoneId).toBe('zone-entry');
  });

  it('空白联系人、无数字联系方式、空白区域编号都被拒绝', () => {
    expect(eventOperationTaskSchema.safeParse(task({ contactName: '   ' })).success).toBe(false);
    expect(eventOperationTaskSchema.safeParse(task({ contactPhone: '电话待问' })).success).toBe(false);
    expect(eventOperationTaskSchema.safeParse(task({ contactPhone: '12' })).success).toBe(false);
    expect(eventOperationTaskSchema.safeParse(task({ zoneId: '   ' })).success).toBe(false);
  });

  it('布局读取保留任务联系人，不因未知字段拒绝', () => {
    const operations = eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [
      task({ contactName: '小乙', contactPhone: '13800000000', zoneId: 'zone-entry' }),
    ] });
    const parsed = parseStoredLayout(JSON.parse(JSON.stringify(makeLayout({ id: scope, eventOperations: operations }))));
    expect(parsed?.eventOperations?.tasks[0]?.contactName).toBe('小乙');
    expect(parsed?.eventOperations?.tasks[0]?.zoneId).toBe('zone-entry');
  });

  it('备份往返保留联系人字段，不丢也不改写', () => {
    const operations = eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [
      task({ contactName: '小乙', contactPhone: '+86 138-0000 0000', zoneId: 'zone-entry' }),
    ] });
    const layout = makeLayout({ id: scope, eventOperations: operations });
    const text = serializeLocalProjectBackupV3(layout,
      { state: 'ready', scope, brief: { status: 'absent' } },
      { state: 'ready', scope, materialCheckins: { status: 'absent' } }, createdAt);
    const restored = parseLocalProjectBackupJson(text).layout;
    expect(restored.eventOperations?.tasks[0]).toEqual(operations.tasks[0]);
    expect(restored.eventOperations?.tasks[0]?.contactPhone).toBe('+86 138-0000 0000');
    expect(createLocalProjectBackupV3(layout,
      { state: 'ready', scope, brief: { status: 'absent' } },
      { state: 'ready', scope, materialCheckins: { status: 'absent' } }, createdAt).layout.eventOperations)
      .toEqual(operations);
  });
});
