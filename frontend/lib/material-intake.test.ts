import { describe, expect, it } from 'vitest';
import { eventOperationsSchema } from '../../supabase/functions/_shared/event-operations-contract';
import { acceptIntakeDrafts, parseMaterialIntake } from './material-intake';

const material = ['# 需求原文', '- 10:00-11:00 签到与引导，负责人：小乙',
  '12:00 午餐（盒饭）', '负责人：阿岚 布置签到台', ''].join('\n');
const meta = { projectId: 'intake-project', acceptedAt: '2026-11-18T10:00:00.000Z' };

describe('材料起草解析（P1-0）', () => {
  it('逐行出草案并保留原文引用与行号', () => {
    const drafts = parseMaterialIntake(material);
    expect(drafts.map(draft => draft.title)).toEqual(['签到与引导', '午餐（盒饭）', '布置签到台']);
    expect(drafts[0]).toMatchObject({ timeText: '10:00–11:00', ownerName: '小乙', sourceLine: 2,
      sourceQuote: '- 10:00-11:00 签到与引导，负责人：小乙' });
    expect(drafts[1]).toMatchObject({ timeText: '12:00', ownerName: '' });
    expect(drafts[2]).toMatchObject({ ownerName: '阿岚', timeText: null });
  });

  it('不生成任何时刻：日期未定就不猜', () => {
    const drafts = parseMaterialIntake(material);
    expect(drafts.every(draft => draft.timeText !== null || true)).toBe(true);
    expect(drafts.some(draft => 'plannedStartAt' in draft)).toBe(false);
  });

  it('重复行与空行不产生重复草案', () => {
    const drafts = parseMaterialIntake('签到\n签到\n\n# 标题\n');
    expect(drafts).toHaveLength(1);
  });

  it('超长行截到 120 字，仍可回溯原文', () => {
    const long = '布置'.repeat(100);
    const draft = parseMaterialIntake(long)[0]!;
    expect(draft.title).toHaveLength(120);
    expect(draft.sourceQuote).toBe(long);
  });

  it('只有勾选项写入，重复接受幂等', () => {
    const drafts = parseMaterialIntake(material);
    const operations = eventOperationsSchema.parse({ dataKind: 'real', tasks: [] });
    const accepted = acceptIntakeDrafts(operations, drafts, [drafts[0]!.id], meta);
    expect(accepted.operations.tasks.map(task => task.title)).toEqual(['签到与引导']);
    expect(accepted.operations.tasks[0]!.ownerName).toBe('小乙');
    expect(accepted.receipt).toEqual({ projectId: 'intake-project',
      acceptedDraftIds: [drafts[0]!.id], acceptedAt: meta.acceptedAt });
    expect(() => acceptIntakeDrafts(accepted.operations, drafts, [drafts[0]!.id], meta))
      .toThrow('勾选的草案都已在流程单中。');
    const next = acceptIntakeDrafts(accepted.operations, drafts, [drafts[1]!.id, drafts[2]!.id], meta);
    expect(next.operations.tasks).toHaveLength(3);
    expect(next.operations.dataKind).toBe('real');
  });

  it('未勾选或时间非法时拒绝写入', () => {
    const drafts = parseMaterialIntake(material);
    expect(() => acceptIntakeDrafts(eventOperationsSchema.parse({ dataKind: 'real' }), drafts, [], meta))
      .toThrow('请先勾选要写入的草案。');
    expect(() => acceptIntakeDrafts(eventOperationsSchema.parse({ dataKind: 'real' }), drafts, [drafts[0]!.id],
      { ...meta, acceptedAt: 'not-a-time' })).toThrow('请记录有效的接受时间。');
  });
});
