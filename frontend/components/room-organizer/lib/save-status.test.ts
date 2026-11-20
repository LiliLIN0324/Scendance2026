import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearConflict,
  clearLocalFailure,
  deriveStage,
  failCloudSync,
  failLocalSave,
  finishCloudSync,
  forgetSaveStatus,
  noteLocalSave,
  reportConflict,
  reportUploads,
  resetSaveStatusForTests,
  saveStatusLabel,
  saveStatusOf,
  setPendingCount,
  startCloudSync,
} from './save-status';

const SCOPE = 'project-1';

beforeEach(() => { resetSaveStatusForTests(); });

describe('unified save status machine (C05)', () => {
  it('starts local and accumulates pending local saves', () => {
    // 未确认过云端的项目一旦有未同步的本机保存，状态就是「待同步」（ Outdoor/绑定流随后结算）。
    noteLocalSave(SCOPE, 1000);
    const status = saveStatusOf(SCOPE);
    expect(status.stage).toBe('syncing');
    expect(status.localSavedAt).toBe(1000);
    expect(status.pendingCount).toBe(1);
    expect(saveStatusLabel(status)).toBe('待同步 · 1 处改动');
    // 没有任何本地保存的 scope 才是「本机」起步态。
    expect(saveStatusOf('project-fresh').stage).toBe('local');
  });

  it('moves to cloud-saved with the server revision once confirmed', () => {
    noteLocalSave(SCOPE);
    const seq = startCloudSync(SCOPE);
    finishCloudSync(SCOPE, seq, { revision: 7, confirmedAt: 2000 });
    const status = saveStatusOf(SCOPE);
    expect(status.stage).toBe('cloud-saved');
    expect(status.cloudRevision).toBe(7);
    expect(status.cloudConfirmedAt).toBe(2000);
    expect(status.pendingCount).toBe(0);
    expect(saveStatusLabel(status)).toBe('云端已保存 · v7');
  });

  it('never lets a stale receipt clear edits made during the upload', () => {
    noteLocalSave(SCOPE); // 第一次本地保存 → pending 1
    const seq = startCloudSync(SCOPE); // 覆盖 pending 1
    noteLocalSave(SCOPE); // 同步期间又编辑 → pending 2
    finishCloudSync(SCOPE, seq, { revision: 3 });
    const status = saveStatusOf(SCOPE);
    // 旧回执只抵扣它开始时覆盖的那次；期间的新编辑仍是待同步。
    expect(status.pendingCount).toBe(1);
    expect(status.stage).toBe('syncing');
    expect(saveStatusLabel(status)).toBe('待同步 · 1 处改动');
  });

  it('records the revision of a stale confirm without touching pending', () => {
    const seq = startCloudSync(SCOPE);
    const newerSeq = startCloudSync(SCOPE);
    expect(seq).not.toBe(newerSeq);
    noteLocalSave(SCOPE);
    finishCloudSync(SCOPE, seq, { revision: 2 });
    const status = saveStatusOf(SCOPE);
    // 旧回执只记录版本，不抵扣新编辑；新一次同步仍在进行。
    expect(status.cloudRevision).toBe(2);
    expect(status.pendingCount).toBe(1);
    expect(status.stage).toBe('syncing');
  });

  it('shows failure truthfully and ignores stale failures', () => {
    const seq = startCloudSync(SCOPE);
    failCloudSync(SCOPE, seq, '网络不可用');
    expect(saveStatusOf(SCOPE).stage).toBe('failed');
    expect(saveStatusOf(SCOPE).failure).toBe('网络不可用');
    // 新一次同步开始：失败清位、状态回到同步中；旧序号的失败不会打断新同步。
    const newerSeq = startCloudSync(SCOPE);
    failCloudSync(SCOPE, seq, '旧失败');
    expect(saveStatusOf(SCOPE).stage).toBe('syncing');
    expect(saveStatusOf(SCOPE).failure).toBeNull();
    // 新同步的确认清除一切，进入云端已保存。
    finishCloudSync(SCOPE, newerSeq, { revision: 4 });
    expect(saveStatusOf(SCOPE).stage).toBe('cloud-saved');
    expect(saveStatusOf(SCOPE).failure).toBeNull();
  });

  it('keeps conflict on top until resolved', () => {
    reportConflict(SCOPE, { remoteRevision: 9, remoteName: '科智的版本' });
    const status = saveStatusOf(SCOPE);
    expect(status.stage).toBe('conflict');
    expect(saveStatusLabel(status)).toBe('版本冲突');
    clearConflict(SCOPE);
    expect(saveStatusOf(SCOPE).stage).toBe('local');
  });

  it('surfaces archive upload activity before pending sync', () => {
    reportUploads(SCOPE, 1, 3);
    expect(saveStatusOf(SCOPE).stage).toBe('uploading');
    expect(saveStatusLabel(saveStatusOf(SCOPE))).toBe('素材归档中（2/3）');
    reportUploads(SCOPE, 0, 0);
    expect(saveStatusOf(SCOPE).stage).toBe('local');
  });

  it('honours direct pending counts from the bound-project dirty truth', () => {
    setPendingCount(SCOPE, 1);
    expect(saveStatusOf(SCOPE).stage).toBe('syncing');
    setPendingCount(SCOPE, 0);
    expect(saveStatusOf(SCOPE).stage).toBe('local');
  });

  it('forgets a scope and isolates others', () => {
    noteLocalSave(SCOPE);
    noteLocalSave('project-2');
    forgetSaveStatus(SCOPE);
    expect(saveStatusOf(SCOPE).updatedAt).toBe(0);
    expect(saveStatusOf('project-2').pendingCount).toBe(1);
  });

  it('derives stages in the documented priority order', () => {
    const base = { scope: SCOPE, stage: 'local' as const, localSavedAt: null, cloudRevision: null, cloudConfirmedAt: null, pendingCount: 0, uploadsActive: 0, uploadsTotal: 0, failure: null, localFailure: null, conflict: null, updatedAt: 0 };
    expect(deriveStage(base)).toBe('local');
    expect(deriveStage({ ...base, cloudConfirmedAt: 1 })).toBe('cloud-saved');
    expect(deriveStage({ ...base, pendingCount: 2 })).toBe('syncing');
    expect(deriveStage({ ...base, failure: 'x' })).toBe('failed');
    expect(deriveStage({ ...base, failure: 'x', pendingCount: 2 })).toBe('failed');
    expect(deriveStage({ ...base, failure: 'x', uploadsActive: 1 })).toBe('uploading');
    expect(deriveStage({ ...base, syncing: true, failure: 'x' })).toBe('syncing');
    expect(deriveStage({ ...base, conflict: { remoteRevision: 1 } })).toBe('conflict');
    expect(deriveStage({ ...base, localFailure: '本机存储已满' })).toBe('local-failed');
    expect(deriveStage({ ...base, localFailure: 'x', failure: 'y', pendingCount: 2 })).toBe('local-failed');
  });
});

describe('本机落盘失败（B2）', () => {
  it('记成本机未保存：不计作已保存、不累加待同步', () => {
    failLocalSave(SCOPE, '本机存储已满');
    const status = saveStatusOf(SCOPE);
    expect(status.stage).toBe('local-failed');
    expect(status.localFailure).toBe('本机存储已满');
    // 没进盘就不能算「最近的本地保存时间」，也不能当成一次待同步改动。
    expect(status.localSavedAt).toBeNull();
    expect(status.pendingCount).toBe(0);
    expect(saveStatusLabel(status)).toBe('本机未保存');
  });

  it('本机失败优先于云端失败：连副本都没有比「云端没同步」更严重', () => {
    const seq = startCloudSync(SCOPE);
    failCloudSync(SCOPE, seq, '断网');
    expect(saveStatusOf(SCOPE).stage).toBe('failed');
    failLocalSave(SCOPE, '本机存储已满');
    expect(saveStatusOf(SCOPE).stage).toBe('local-failed');
  });

  it('真正落盘成功才清掉本机失败', () => {
    failLocalSave(SCOPE, '本机存储已满');
    noteLocalSave(SCOPE, 1000);
    const status = saveStatusOf(SCOPE);
    expect(status.localFailure).toBeNull();
    expect(status.stage).toBe('syncing');
    expect(status.localSavedAt).toBe(1000);
  });

  it('clearLocalFailure 只清标识，不动其它状态', () => {
    noteLocalSave(SCOPE, 1000);
    const seq = startCloudSync(SCOPE);
    finishCloudSync(SCOPE, seq, { revision: 3 });
    failLocalSave(SCOPE, '本机存储已满');
    clearLocalFailure(SCOPE);
    const status = saveStatusOf(SCOPE);
    expect(status.localFailure).toBeNull();
    expect(status.cloudRevision).toBe(3);
    expect(status.stage).toBe('cloud-saved');
  });
});
