import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import {
  acceptRequirement,
  bindCandidate,
  captureProtection,
  confirmEntry,
  decideConfirmation,
  emptyRequirement,
  isRequirementInput,
  requirementFromText,
  reviewProtection,
  protectionPolicy,
  structureConfirmationText,
  type ConfirmationEntry,
  type RequirementState,
} from './confirmation-guard';
import type { RoomLayout } from './types';

const layout = (items: Parameters<typeof makeItem>[0][] = [{ id: 'desk' }]): RoomLayout =>
  makeLayout({ id: 'activity-a', floors: [makeFloor({ id: 'floor-1', items: items.map(item => makeItem(item)) })] });

function requirement(text: string, inputId = text): RequirementState {
  return acceptRequirement(emptyRequirement(), { inputId, text });
}

describe('需求版本', () => {
  it('新需求输入让旧版本失效，重复的同一次输入不升版本', () => {
    const first = requirement('30人课桌');
    expect(first.version).toBe(1);
    expect(acceptRequirement(first, { inputId: '30人课桌', text: '30人课桌' })).toEqual(first);
    const second = acceptRequirement(first, { inputId: 'again', text: '30人课桌' });
    expect(second.version).toBe(2);
    expect(second.digest).toBe(first.digest);
    expect(acceptRequirement(second, { inputId: 'blank', text: '   ' })).toEqual(second);
  });

  it('问候、停止、确认口令和只读问答不是新需求', () => {
    expect(isRequirementInput('你好')).toBe(false);
    expect(isRequirementInput('停一下')).toBe(false);
    expect(isRequirementInput('确认布置')).toBe(false);
    expect(isRequirementInput('什么是消防通道')).toBe(false);
    expect(isRequirementInput('改成 40 人')).toBe(true);
    expect(isRequirementInput('请保留原有物件')).toBe(true);
    expect(isRequirementInput('把桌子往左移动')).toBe(true);
  });
});

describe('确认必须对上 candidateId 与 requirementVersion', () => {
  const live = requirement('保留原有物件', 'input-1');
  const ticket = bindCandidate('proposal', 'cand-1', live)!;

  it('旧候选在需求版本变化后不能用旧编号或新版本号蒙混', () => {
    const next = acceptRequirement(live, { inputId: 'input-2', text: '再加两把椅子' });
    expect(decideConfirmation(ticket, { entry: 'proposal', candidateId: 'cand-1', requirementVersion: live.version }, next)).toMatchObject({
      ok: false, code: 'STALE_REQUIREMENT', ids: ['cand-1'],
    });
    expect(decideConfirmation(ticket, { entry: 'proposal', candidateId: 'cand-1', requirementVersion: next.version }, next)).toMatchObject({ ok: false, code: 'REQUIREMENT_MISMATCH' });
    const rebound = bindCandidate('proposal', 'cand-1', next)!;
    expect(decideConfirmation(rebound, { entry: 'proposal', candidateId: 'cand-2', requirementVersion: next.version }, next)).toMatchObject({ ok: false, code: 'CANDIDATE_MISMATCH' });
    expect(decideConfirmation(rebound, { entry: 'proposal', candidateId: 'cand-1', requirementVersion: next.version }, next)).toEqual({ ok: true });
  });

  it('入口不一致或没有票据时拒绝', () => {
    expect(decideConfirmation(null, { entry: 'proposal', candidateId: 'cand-1', requirementVersion: 1 }, live)).toMatchObject({ ok: false, code: 'MISSING_TICKET' });
    expect(decideConfirmation(ticket, { entry: 'restore', candidateId: 'cand-1', requirementVersion: live.version }, live)).toMatchObject({ ok: false, code: 'ENTRY_MISMATCH' });
    expect(bindCandidate('proposal', '  ', live)).toBeNull();
  });
});

describe('锁定与保留按编号和保护属性核对', () => {
  it('锁定件数相同但编号被换掉时拒绝，并点名缺失的编号', () => {
    const before = layout([{ id: 'locked-a', locked: true }, { id: 'locked-b', locked: true, position: { x: 2, z: 1 } }]);
    const swapped = layout([{ id: 'copy-a', locked: true }, { id: 'copy-b', locked: true, position: { x: 2, z: 1 } }]);
    const baseline = captureProtection(before)!;
    const review = reviewProtection(baseline, swapped, protectionPolicy('proposal', null));
    expect(review.ok).toBe(false);
    if (!review.ok) {
      expect(review.ids).toEqual(['locked-a', 'locked-b']);
      expect(review.message).toContain('locked-a');
      expect(review.message).not.toMatch(/件数相同可以通过/);
    }
  });

  it('锁定物件只改颜色、尺寸或解锁也拒绝，未锁定物件改色仍可通过', () => {
    const before = layout([{ id: 'locked-chair', locked: true, color: '#ffffff' }, { id: 'free-chair', color: '#ffffff' }]);
    const baseline = captureProtection(before)!;
    const recoloredLock = layout([{ id: 'locked-chair', locked: true, color: '#000000' }, { id: 'free-chair', color: '#112233' }]);
    expect(reviewProtection(baseline, recoloredLock, protectionPolicy('proposal', null)).ok).toBe(false);
    const resized = layout([{ id: 'locked-chair', locked: true, width: 2 }, { id: 'free-chair' }]);
    const sizeReview = reviewProtection(baseline, resized, protectionPolicy('proposal', null));
    expect(sizeReview.ok).toBe(false);
    if (!sizeReview.ok) expect(sizeReview.issues).toContainEqual(expect.objectContaining({ id: 'locked-chair', code: 'ATTRIBUTE', attribute: '宽度' }));
    const unlocked = layout([{ id: 'locked-chair', locked: false }, { id: 'free-chair' }]);
    expect(reviewProtection(baseline, unlocked, protectionPolicy('proposal', null)).ok).toBe(false);
  });

  it('保留原物看编号；要求位置不变时才核对位置，不因总数相同放行', () => {
    const before = layout([{ id: 'desk', position: { x: 1, z: 2 } }, { id: 'plant', position: { x: 3, z: 4 } }]);
    const baseline = captureProtection(before)!;
    const moved = layout([{ id: 'desk', position: { x: 5, z: 2 } }, { id: 'plant', position: { x: 3, z: 4 } }]);
    expect(reviewProtection(baseline, moved, protectionPolicy('proposal', { keepAll: true, keepPositions: false })).ok).toBe(true);
    expect(reviewProtection(baseline, moved, protectionPolicy('proposal', { keepAll: true, keepPositions: true })).ok).toBe(false);
    const replaced = layout([{ id: 'desk-2', position: { x: 1, z: 2 } }, { id: 'plant-2', position: { x: 3, z: 4 } }]);
    const gone = reviewProtection(baseline, replaced, protectionPolicy('proposal', { keepAll: true, keepPositions: false }));
    expect(gone.ok).toBe(false);
    if (!gone.ok) expect(gone.ids).toEqual(['desk', 'plant']);
  });
});

describe('五个入口共用确认护栏', () => {
  const entries: ConfirmationEntry[] = ['proposal', 'rebuild', 'material', 'review', 'restore'];

  it.each(entries)('%s 在需求版本变化后拒绝旧候选', entry => {
    const live = requirement(`${entry} 的需求`, `${entry}-1`);
    const ticket = bindCandidate(entry, `${entry}-cand`, live)!;
    const before = layout([{ id: 'kept', locked: true }]);
    const next = acceptRequirement(live, { inputId: `${entry}-2`, text: '新的要求' });
    const decision = confirmEntry({
      entry,
      ticket,
      claim: { entry, candidateId: ticket.candidateId, requirementVersion: live.version },
      live: next,
      baseline: captureProtection(before),
      candidate: before,
    });
    expect(decision).toMatchObject({ ok: false, code: 'STALE_REQUIREMENT' });
  });

  it('物料入口允许未锁定物件更换资产和颜色，仍按编号核对位置与尺寸', () => {
    const before = layout([{ id: 'chair', assetId: 'old', color: '#ffffff', position: { x: 1, z: 1 } }]);
    const live = requirementFromText('材质槽 0');
    const ticket = bindCandidate('material', 'material-1', live)!;
    const recolored = layout([{ id: 'chair', assetId: 'new', color: '#abcdef', position: { x: 1, z: 1 } }]);
    expect(confirmEntry({
      entry: 'material', ticket, claim: { entry: 'material', candidateId: 'material-1', requirementVersion: live.version },
      live, baseline: captureProtection(before), candidate: recolored,
    })).toEqual({ ok: true });
    const moved = layout([{ id: 'chair', assetId: 'new', color: '#abcdef', position: { x: 4, z: 1 } }]);
    expect(confirmEntry({
      entry: 'material', ticket, claim: { entry: 'material', candidateId: 'material-1', requirementVersion: live.version },
      live, baseline: captureProtection(before), candidate: moved,
    }).ok).toBe(false);
  });

  it('重建入口保留锁定物件的位置，结构标记可以只核对编号还在', () => {
    const before = layout([
      { id: 'column', structuralColumnId: 'col-1', position: { x: 1, z: 1 } },
      { id: 'locked-desk', locked: true, position: { x: 3, z: 1 } },
    ]);
    const live = requirementFromText('宽12深9');
    const ticket = bindCandidate('rebuild', `rebuild:${live.digest}`, live)!;
    const doorMoved = layout([
      { id: 'column', structuralColumnId: 'col-1', position: { x: 2, z: 2 } },
      { id: 'locked-desk', locked: true, position: { x: 3, z: 1 } },
    ]);
    expect(confirmEntry({
      entry: 'rebuild', ticket, claim: { entry: 'rebuild', candidateId: ticket.candidateId, requirementVersion: live.version },
      live, baseline: captureProtection(before), candidate: doorMoved,
    })).toEqual({ ok: true });
    const lockMoved = layout([
      { id: 'column', structuralColumnId: 'col-1', position: { x: 1, z: 1 } },
      { id: 'locked-desk', locked: true, position: { x: 6, z: 1 } },
    ]);
    const refused = confirmEntry({
      entry: 'rebuild', ticket, claim: { entry: 'rebuild', candidateId: ticket.candidateId, requirementVersion: live.version },
      live, baseline: captureProtection(before), candidate: lockMoved,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.ids).toContain('locked-desk');
  });

  it('结构确认把锁定物件的编号和位置写进需求版本，场景对象不是画布布局', () => {
    const base = {
      structure: { walls: [{ id: 'wall-1' }] },
      objects: [{ id: 'locked-door', locked: true, position: { x: 1, z: 2 }, rotation: 0, size: { width: 1, depth: 0.2, height: 2 } }],
      width: '12', depth: '8', height: '3', constraints: [], adjustment: '', note: '',
      event: '讲座', guests: 30, mustHave: '保留原有物件', description: '室内',
    };
    const live = requirementFromText(structureConfirmationText(base));
    const ticket = bindCandidate('rebuild', `structure:${live.digest}`, live)!;
    const moved = structureConfirmationText({ ...base, objects: [{ ...base.objects[0]!, position: { x: 4, z: 2 } }] });
    const next = requirementFromText(moved);
    expect(decideConfirmation(ticket, { entry: 'rebuild', candidateId: ticket.candidateId, requirementVersion: live.version }, next)).toMatchObject({
      ok: false, code: 'STALE_REQUIREMENT', ids: [ticket.candidateId],
    });
    const sameCount = structureConfirmationText({
      ...base,
      objects: [{ id: 'other-door', locked: true, position: { x: 1, z: 2 }, rotation: 0, size: { width: 1, depth: 0.2, height: 2 } }],
    });
    expect(decideConfirmation(ticket, { entry: 'rebuild', candidateId: ticket.candidateId, requirementVersion: live.version }, requirementFromText(sameCount)).ok).toBe(false);
  });

  it('恢复入口拒绝用数量相同的另一批物件换掉锁定编号', () => {
    const current = layout([{ id: 'heirloom', locked: true, name: '原柜' }]);
    const backup = layout([{ id: 'other-cabinet', locked: true, name: '原柜' }]);
    const live = requirementFromText('backup-raw');
    const ticket = bindCandidate('restore', 'recovery-key', live)!;
    const decision = confirmEntry({
      entry: 'restore', ticket, claim: { entry: 'restore', candidateId: 'recovery-key', requirementVersion: live.version },
      live, baseline: captureProtection(current), candidate: backup,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.ids).toEqual(['heirloom']);
  });
});
