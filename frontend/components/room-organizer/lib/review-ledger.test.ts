import { describe, expect, it } from 'vitest';
import {
  REVIEW_LIMIT,
  acceptanceOfItem,
  autoStepsOfItem,
  decideFromExit,
  decideReview,
  diffSnapshots,
  digestProposal,
  evidenceLine,
  goalOfItem,
  loadOpenAttemptId,
  loadReviewAttempts,
  nextItemNo,
  openReviewAttempt,
  pendingReview,
  planGate,
  saveOpenAttemptId,
  saveReviewAttempts,
  snapshotItems,
  statusLabel,
  updatePendingArtifact,
  type LedgerLayoutLike,
  type ReviewAttempt,
} from './review-ledger';

const base: ReviewAttempt = {
  id: 'r-1', requestId: 'q-1', request: '80 人发布会，室内 12×9',
  to: ['bingo'], agent: 'bingo', artifact: '新增 12 件 · 撤掉 0 件 · 无重叠',
  at: 1000, status: 'pending',
};

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return {
    rows,
    getItem: key => rows.get(key) ?? null,
    setItem: (key, value) => { rows.set(key, value); },
    removeItem: key => { rows.delete(key); },
  };
}

describe('digestProposal — 只报能核对的事实', () => {
  it('普通提案报新增/撤掉/重叠', () => {
    expect(digestProposal({ added: 12, removing: 2, overlapCount: 0 }))
      .toBe('新增 12 件 · 撤掉 2 件 · 无重叠');
  });

  it('体检改法换一套说法，不把挪动说成新增', () => {
    expect(digestProposal({ added: 0, removing: 0, changed: 3, overlapCount: 1, review: true }))
      .toBe('体检改法 · 挪动 3 件 · 重叠/越界 1 件');
  });

  it('过不了几何闸就照实写不能落盘', () => {
    expect(digestProposal({ added: 4, removing: 0, overlapCount: 0, blocked: '有物料跟墙体冲突' }))
      .toContain('不能落盘：有物料跟墙体冲突');
  });
});

describe('openReviewAttempt — 一版一条，旧的 pending 记作废', () => {
  it('新一版把旧的待复核标成已作废', () => {
    const next = openReviewAttempt([base], {
      requestId: 'q-2', request: '换一版', to: ['bingo'], agent: 'bingo', artifact: '新增 9 件', at: 2000,
    });
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ status: 'superseded', decidedAt: 2000 });
    expect(pendingReview(next)?.request).toBe('换一版');
  });

  it('超过上限只留最近几条', () => {
    let list: ReviewAttempt[] = [];
    for (let index = 0; index < REVIEW_LIMIT + 5; index++) {
      list = openReviewAttempt(list, {
        requestId: `q-${index}`, request: `第 ${index} 句`, to: [], agent: 'bingo', artifact: '新增 1 件', at: index,
      });
    }
    expect(list).toHaveLength(REVIEW_LIMIT);
    // 新的没被裁掉，旧的都作废了。
    expect(pendingReview(list)?.request).toBe(`第 ${REVIEW_LIMIT + 4} 句`);
  });
});

describe('update / decide — 决定只写一次', () => {
  it('加料只改摘要，不改身份', () => {
    const next = updatePendingArtifact([base], 'r-1', '新增 14 件 · 撤掉 0 件 · 无重叠');
    expect(next[0]).toMatchObject({ id: 'r-1', status: 'pending', artifact: '新增 14 件 · 撤掉 0 件 · 无重叠' });
  });

  it('通过后重复点驳回不会改写历史', () => {
    const approved = decideReview([base], 'r-1', 'approved', '人点「确认布置」写进画布', 2000);
    const again = decideReview(approved, 'r-1', 'rejected', '撤回', 3000);
    expect(again[0]).toMatchObject({ status: 'approved', decidedAt: 2000 });
    expect(pendingReview(again)).toBeNull();
  });
});

describe('decideFromExit — 从状态机反推人的决定', () => {
  it('落盘（planReady）算通过', () => {
    expect(decideFromExit('planReady', '写进画布了：这一版一共 12 件物料')).toEqual({
      status: 'approved', note: '人点「确认布置」写进画布',
    });
  });

  it('回话「撤了」算驳回', () => {
    expect(decideFromExit('idle', '撤了，物料没动。想再看一版就说「换一版」。'))
      .toMatchObject({ status: 'rejected' });
  });

  it('失效或被顶掉算作废，不冒充人的驳回', () => {
    expect(decideFromExit('idle', '场景在这期间改过了，这版预览先作废。'))
      .toMatchObject({ status: 'superseded' });
    expect(decideFromExit('generating', '')).toMatchObject({ status: 'superseded' });
  });
});

describe('持久化与文案', () => {
  it('存进去还能读回来，坏数据丢掉', () => {
    const storage = memoryStorage();
    saveReviewAttempts([base], storage);
    expect(loadReviewAttempts(storage)).toEqual([base]);
    storage.setItem('scendance.review-ledger.v1', '[{"id":1}]');
    expect(loadReviewAttempts(storage)).toEqual([]);
  });

  it('状态文案说人话', () => {
    expect(statusLabel('pending')).toBe('待复核');
    expect(statusLabel('approved')).toBe('已通过');
    expect(statusLabel('rejected')).toBe('已驳回');
    expect(statusLabel('superseded')).toBe('已作废');
  });
});

describe('事项化 — 一句需求落成带目标与验收点的事项', () => {
  it('要把可写画布的提案记成「等你点头」', () => {
    expect(planGate({ added: 3, removing: 0, overlapCount: 0 })).toBe('human');
    expect(planGate({ added: 0, removing: 0, changed: 0, overlapCount: 0 })).toBe('agent');
  });

  it('目标写终态与件数，不重复需求原话', () => {
    expect(goalOfItem({ added: 10, removing: 0, overlapCount: 0 }, '后排再加 10 把椅子'))
      .toBe('按「后排再加 10 把椅子」：新增 10 件 · 撤掉 0 件，确认前画布保持原样。');
  });

  it('验收点能核对：几何闸、件数一致、锁定件、驳回语义', () => {
    const lines = acceptanceOfItem({ added: 4, removing: 2, overlapCount: 0, keptLocked: 2 });
    expect(lines[0]).toContain('几何闸通过');
    expect(lines[1]).toBe('确认后画布与候选一致：新增 4 / 撤掉 2');
    expect(lines[2]).toBe('锁定件不动（2 件）');
    expect(lines[3]).toContain('画布保持原样');
  });

  it('agent 直接做的事不含写画布', () => {
    expect(autoStepsOfItem().join('、')).not.toContain('写进画布');
  });

  it('开一条事项时带上编号、负责人、门禁与验收点', () => {
    const next = openReviewAttempt([], {
      requestId: 'q-9', request: '后排加 10 把椅子', to: [], agent: 'bingo', artifact: '新增 10 件',
      itemNo: 'T-7', gate: 'human', goal: '新增 10 件', acceptance: ['无重叠'], autoDone: ['生成候选'],
    });
    expect(next[0]).toMatchObject({
      itemNo: 'T-7', owner: '待认领', gate: 'human', goal: '新增 10 件', acceptance: ['无重叠'],
    });
  });

  it('编号跨刷新递增，不重头再来', () => {
    const storage = memoryStorage();
    expect(nextItemNo(storage)).toBe('T-1');
    expect(nextItemNo(storage)).toBe('T-2');
    expect(storage.rows.get('scendance.review-ledger.seq.v1')).toBe('2');
  });
});

describe('证据回帖 — 前后快照差分', () => {
  const before: LedgerLayoutLike = { floors: [{ items: [
    { id: 'seat-1', name: '椅子', position: { x: 1, z: 2 }, rotation: 0 },
    { id: 'seat-2', name: '椅子', position: { x: 2, z: 2 } },
    { id: 'table-1', name: '桌', position: { x: 0, z: 0 } },
  ] }] };
  const after: LedgerLayoutLike = { floors: [{ items: [
    { id: 'seat-1', name: '椅子', position: { x: 1, z: 3 }, rotation: 0 },
    { id: 'table-1', name: '桌', position: { x: 0, z: 0 } },
    { id: 'seat-3', name: '椅子', position: { x: 3, z: 3 } },
  ] }] };

  it('按 itemId 认新增/撤掉/挪动，不靠名字', () => {
    const evidence = diffSnapshots(snapshotItems(before), snapshotItems(after), 2000);
    expect(evidence.added).toEqual(['seat-3']);
    expect(evidence.removed).toEqual(['seat-2']);
    expect(evidence.moved).toEqual([
      { id: 'seat-1', name: '椅子', from: '1.00,2.00 r0.00', to: '1.00,3.00 r0.00' },
    ]);
  });

  it('一行证据带 itemId 与前后数值', () => {
    const line = evidenceLine(diffSnapshots(snapshotItems(before), snapshotItems(after), 2000));
    expect(line).toContain('新增 seat-3');
    expect(line).toContain('撤掉 seat-2');
    expect(line).toContain('1.00,2.00 r0.00→1.00,3.00 r0.00');
  });

  it('驳回时画布没动就照实说，不写「改了 0 件」', () => {
    const evidence = { at: 3000, added: [], removed: [], moved: [], note: '人驳回，画布保持原样' };
    expect(evidenceLine(evidence)).toContain('人驳回，画布保持原样');
  });

  it('决定落下时证据一起存档', () => {
    const evidence = diffSnapshots(snapshotItems(before), snapshotItems(after), 2000);
    const decided = decideReview([base], 'r-1', 'approved', '写进画布', 2000, evidence);
    expect(decided[0]?.evidence?.added).toEqual(['seat-3']);
  });
});

describe('复核身份 — 刷新/切页签认回同一条', () => {
  it('存进去读回来，结算后清掉', () => {
    const storage = memoryStorage();
    saveOpenAttemptId('r-1', storage);
    expect(loadOpenAttemptId(storage)).toBe('r-1');
    saveOpenAttemptId(null, storage);
    expect(loadOpenAttemptId(storage)).toBeNull();
  });
});
