import { describe, expect, it } from 'vitest';
import { eventOperationsSchema } from '../../supabase/functions/_shared/event-operations-contract';
import { makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { emptyEventProfile, updateEventProfile } from './event-profile';
import { rosterSchema } from './event-roster';
import { buildRetrospective } from './event-retrospective';

const meta = { updatedBy: '阿岚', updatedAt: '2026-11-18T10:00:00.000Z' };
const profile = updateEventProfile(emptyEventProfile(),
  { expectedAttendance: { value: 60, status: 'inferred', source: 'model_inference', note: '按报名估算' } }, 0, meta);
const roster = (guests: unknown[]) => rosterSchema.parse({ dataKind: 'real', guests });
const layout = (dataKind: 'real' | 'rehearsal', eventProfile = profile) => makeLayout({ id: 'retro-project', eventProfile,
  eventOperations: eventOperationsSchema.parse({ dataKind }) });

describe('复盘（P2-3）', () => {
  it('演练数据不进入真实复盘', () => {
    expect(() => buildRetrospective({ layout: layout('rehearsal') })).toThrow('演练数据不进入真实复盘。');
  });

  it('没有名册时报名与出席留空，不推算', () => {
    const result = buildRetrospective({ layout: layout('real') });
    expect(result.numbers).toContainEqual({ label: '报名 / 实际出席', value: '未记录', source: 'absent' });
    expect(result.attendanceRate).toBeNull();
  });

  it('出席率按出席 ÷ 报名，报名为 0 时为空', () => {
    const result = buildRetrospective({ layout: layout('real'), roster: roster([
      { id: crypto.randomUUID(), name: '甲', status: 'attended', plusOnes: 1 },
      { id: crypto.randomUUID(), name: '乙', status: 'registered' },
      { id: crypto.randomUUID(), name: '丙', status: 'registered' },
    ]) });
    expect(result.attendanceRate).toBe(0.5);
    expect(result.numbers).toContainEqual({ label: '实际出席（含携伴）', value: '2 人', source: 'roster' });
    expect(buildRetrospective({ layout: layout('real'), roster: roster([
      { id: crypto.randomUUID(), name: '甲', status: 'attended', plusOnes: 0 },
    ]) }).attendanceRate).toBeNull();
  });

  it('未发布执行包时基线为空并明示', () => {
    const result = buildRetrospective({ layout: layout('real') });
    expect(result.baseline).toBeNull();
    expect(result.notes.join('')).toContain('尚未发布执行包');
  });

  it('基线锁定发布包、核对依据与档案版本', () => {
    const result = buildRetrospective({ layout: layout('real'), publishedPackageId: 'pkg-1',
      reviewedBasis: `sha256:${'b'.repeat(64)}` });
    expect(result.baseline).toEqual({ publishedPackageId: 'pkg-1', reviewedBasis: `sha256:${'b'.repeat(64)}`,
      eventProfileRevision: profile.revision });
    expect(result.notes).toEqual([]);
  });
});
