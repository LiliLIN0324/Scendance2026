import { describe, expect, it } from 'vitest';
import { suggestionChannel } from '../supabase/functions/_shared/explore-tool-matrix.ts';
import {
  COMMUNITY_LECTURE_TURNS,
  SIXTH_SENTENCES,
  adviceConfirmGate,
  guardModelReply,
  initialExploreMemory,
  planMove,
  RECEPTION_ID,
  readTurn,
  runSixthSentences,
  selectTools,
} from '../supabase/functions/_shared/explore-vertical-case.ts';

function afterPreview(): ReturnType<typeof readTurn>['memory'] {
  let memory = initialExploreMemory();
  for (const text of COMMUNITY_LECTURE_TURNS.slice(0, 5)) memory = readTurn(memory, text).memory;
  return memory;
}

describe('建议不等于确认', () => {
  it('只把一人一桌留成建议，单独确认不会升成已定', () => {
    const suggested = readTurn(initialExploreMemory(), '我建议先一人一桌，但先别确认');
    expect(suggested.memory.layout).toMatchObject({ status: 'suggestion', value: 'one_desk_one_chair' });
    expect(suggested.confirmIgnored).toBe(true);
    expect(suggested.askedAgain).toEqual([]);
    expect(selectTools(suggested.memory, suggested.intents).tools).not.toContain('prepare_seating_candidate');
    expect(selectTools(suggested.memory, suggested.intents).tools).not.toContain('prepare_shared_seating_candidate');
    const confirmed = readTurn(suggested.memory, '确认');
    expect(confirmed.confirmIgnored).toBe(true);
    expect(confirmed.memory.layout.status).toBe('suggestion');
    expect(confirmed.reply).toContain('没有把建议收成已确认');
    expect(adviceConfirmGate(confirmed.memory)).toMatchObject({ ok: false, code: 'SUGGESTION_NOT_CONFIRMED', layout: 'suggestion' });
    const guarded = guardModelReply(suggested.reply, '已确认一人一桌。可以先按建议看看。');
    expect(guarded.text).not.toContain('已确认');
    expect(guarded.dropped.join('')).toContain('已确认');
  });

  it('问问和先别定都不会把课桌写成已定', () => {
    expect(readTurn(initialExploreMemory(), '要不要改成课桌？只是问问').memory.layout.status).toBe('unknown');
    const defer = readTurn(initialExploreMemory(), '这个建议不错，不过先别定座位形式');
    expect(defer.memory.layout.status).toBe('unknown');
    expect(defer.memory.deferred).toContain('座位形式');
    expect(defer.reply).toContain('不确认');
    expect(readTurn(initialExploreMemory(), '建议直接摆好一人一桌').memory.layout.status).toBe('suggestion');
  });
});

describe('第六句的几种说法', () => {
  const base = afterPreview();

  it('六句都从同一份建议记忆出发，确认后仍不是已定座位', () => {
    expect(base.layout.status).toBe('suggestion');
    expect(base.attendance).toMatchObject({ status: 'stated', people: 28 });
    const results = runSixthSentences(base);
    expect(results.map(item => item.text)).toEqual([...SIXTH_SENTENCES]);
    for (const item of results) {
      expect(item.layout).not.toBe('stated');
      expect(item.followedLayout).not.toBe('stated');
      expect(item.confirmIgnored).toBe(true);
      expect(item.askedAgain).toEqual([]);
      expect(item.tools).not.toContain('prepare_seating_candidate');
      expect(item.tools).not.toContain('prepare_shared_seating_candidate');
      expect(item.tools).not.toContain('submit_candidates');
      expect(item.seating).toEqual({ ok: false, code: 'SUGGESTION_NOT_CONFIRMED' });
      expect(item.adviceGate.code).toBe('SUGGESTION_NOT_CONFIRMED');
      expect(item.attendance).toMatchObject({ people: 28 });
      expect(item.chairCount).toBe(80);
      expect(item.mobility).toBe('unknown');
      expect(item.unknowns).toEqual(expect.arrayContaining(['出入口与门扇', '行动辅助需求', '口述椅子数量不是已核验库存', '座位形式']));
    }
    const held = results.find(item => item.text === COMMUNITY_LECTURE_TURNS[5]);
    expect(held?.layout).toBe('suggestion');
    expect(held?.followedLayout).toBe('suggestion');
    const deferred = results.find(item => item.text === '建议不错，不过先别定座位形式');
    expect(deferred?.layout).toBe('unknown');
    expect(deferred?.followedLayout).toBe('unknown');
  });

  it('同一句里的两个方向不会合成一次移动', () => {
    const desks = [{ id: RECEPTION_ID, label: '签到桌', locked: false, position: { x: 2, z: 1 } }];
    expect(planMove('把签到桌往左移1米，再往右移0.5米', desks, 0)).toMatchObject({ status: 'unresolved' });
    expect(planMove('把签到桌往左移1米', desks, 0)).toMatchObject({ status: 'ready', axis: 'case_x_minus', command: { baseRevision: 0 } });
  });

  it('v2 建议标签仍然默认关闭', () => {
    expect(suggestionChannel({ requested: false }).enabled).toBe(false);
    expect(suggestionChannel({ requested: true, reproduction: { items: 7, failures: 0, rerunOnCurrentMain: true } }).enabled).toBe(false);
  });
});
