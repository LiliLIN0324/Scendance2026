import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { declaredToolNames } from '../supabase/functions/_shared/command-validation-gaps.ts';
import { MODEL_TOOL_NAMES, USER_TASK_MATRIX, V2_ADVERSARIAL_HISTORY, suggestionChannel } from '../supabase/functions/_shared/explore-tool-matrix.ts';
import {
  COMMUNITY_LECTURE_TURNS,
  LOCKED_ID,
  RECEPTION_ID,
  attendanceFromUser,
  confirmSeating,
  type SeatingPreview,
  createSharedEditor,
  guardModelReply,
  guardSeatingCount,
  initialExploreMemory,
  invokeAsModelTool,
  planMove,
  readIntents,
  readMobilityMention,
  readTurn,
  runCommunityLectureCase,
  selectTools,
} from '../supabase/functions/_shared/explore-vertical-case.ts';

describe('当前 main 的工具矩阵', () => {
  it('和 agent-runner 声明的工具名一致', () => {
    const source = readFileSync(new URL('../supabase/functions/_shared/agent-runner.ts', import.meta.url), 'utf8');
    expect(declaredToolNames(source)).toEqual([...MODEL_TOOL_NAMES]);
    expect(source).toContain("t.function.name!=='start_lux3d_model'");
    expect(source).toContain("t.function.name!=='search_places'||placeReady");
  });

  it('按用户任务组织，并且只有一个活动 Agent', () => {
    expect(USER_TASK_MATRIX.map(row => row.task)).toContain('从模糊想法接着往下做，不先填专业表单');
    expect(USER_TASK_MATRIX.flatMap(row => row.tools)).not.toContain('open_material_library');
    expect(new Set(USER_TASK_MATRIX.map(row => row.entry))).toEqual(new Set(['活动 Agent', '审校协作', '空间', '物料']));
  });

  it('界面动作和未配置工具不能冒充可调用的模型工具', () => {
    expect(invokeAsModelTool('open_material_library')).toEqual({ ok: false, code: 'NOT_A_MODEL_TOOL' });
    expect(invokeAsModelTool('undo')).toEqual({ ok: false, code: 'NOT_A_MODEL_TOOL' });
    expect(invokeAsModelTool('search_places').ok).toBe(false);
    expect(invokeAsModelTool('start_lux3d_model').ok).toBe(false);
    expect(invokeAsModelTool('get_scene')).toMatchObject({ ok: true, tool: 'get_scene' });
    expect(invokeAsModelTool('drop_table')).toEqual({ ok: false, code: 'UNKNOWN_TOOL' });
  });
});

describe('模糊原话里的反例', () => {
  it('80 把椅子不是 80 人，长者也不是轮椅', () => {
    const first = readTurn(initialExploreMemory(), COMMUNITY_LECTURE_TURNS[0]);
    expect(first.memory.audienceTags).toEqual(['elderly']);
    expect(first.memory.mobility).toEqual({ status: 'unknown', evidence: null });
    expect(first.memory.layout).toMatchObject({ status: 'unknown', value: null });
    expect(first.reply).not.toMatch(/配备轮椅|需要轮椅通道/);
    expect(first.reply).toContain('还不知道');
    const second = readTurn(first.memory, COMMUNITY_LECTURE_TURNS[1]);
    expect(second.memory.attendance).toMatchObject({ status: 'approximate', people: 30 });
    expect(second.memory.inventory[0]).toMatchObject({ count: 80, name: '椅子', countsAsPeople: false, countsAsVerifiedStock: false });
    expect(second.memory.deferred).toContain('座位形式');
    expect(second.askedAgain).toEqual([]);
    expect(second.reply).not.toMatch(/请先选择座位形式|必须先决定/);
    expect(second.memory.unknowns).toEqual(expect.arrayContaining(['出入口与门扇', '行动辅助需求', '口述椅子数量不是已核验库存', '座位形式']));
  });

  it('模型把椅子数量写成参加人数时不会进入事实', () => {
    const guarded = guardModelReply('我们有80把椅子，大概30个人来', '预计将有80位长者参加。大约30人可以先记下来。');
    expect(guarded.dropped.join('')).toContain('80位长者');
    expect(guarded.text).not.toContain('80位长者');
    expect(guarded.text).toContain('30人');
    expect(attendanceFromUser('我们有80把椅子')?.status).toBeUndefined();
    expect(readTurn(initialExploreMemory(), '没有80把椅子，大概30个人来').memory.inventory).toEqual([]);
    expect(readTurn(initialExploreMemory(), '我们有80把椅子，没有舞台').memory.inventory.map(item => item.count)).toEqual([80]);
  });

  it('互相冲突的人数保持未知，中文人数仍可单独读到', () => {
    expect(readTurn(initialExploreMemory(), '上次40人，这场大概30个人').memory.attendance.status).toBe('unknown');
    expect(readTurn(initialExploreMemory(), '三十个人来参加讲座').memory.attendance).toMatchObject({ status: 'stated', people: 30 });
  });

  it('讲座和“只是建议”不会变成已确认的课桌式', () => {
    let memory = initialExploreMemory();
    memory = readTurn(memory, COMMUNITY_LECTURE_TURNS[0]).memory;
    memory = readTurn(memory, COMMUNITY_LECTURE_TURNS[1]).memory;
    const explored = readTurn(memory, COMMUNITY_LECTURE_TURNS[2]);
    expect(explored.memory.venue).toMatchObject({ status: 'assumption', widthM: 12, depthM: 9 });
    expect(explored.memory.layout.status).toBe('unknown');
    expect(selectTools(explored.memory, explored.intents).tools).not.toContain('prepare_seating_candidate');
    expect(explored.memory.unknowns).toContain('场地尺寸是假设，不是实测');
  });
});

describe('同一句里的多个意图', () => {
  it('清单不会吞掉改人数和移动', () => {
    const text = COMMUNITY_LECTURE_TURNS[4];
    expect(readIntents(text)).toEqual(['revise_headcount', 'move_object', 'bill_of_materials']);
    const prior = readTurn(initialExploreMemory(), '我们有80把椅子，大概30个人来').memory;
    const turn = readTurn(prior, text);
    expect(turn.memory.attendance).toMatchObject({ status: 'stated', people: 28 });
    expect(turn.memory.inventory.map(item => item.count)).toEqual([80]);
    const desks = [
      { id: RECEPTION_ID, label: '签到桌', locked: false, position: { x: 2, z: 1 } },
      { id: LOCKED_ID, label: '另一张签到桌', locked: false, position: { x: 4, z: 1 } },
    ];
    expect(planMove(text, desks)).toMatchObject({ status: 'unresolved' });
    expect(turn.intents).toContain('bill_of_materials');
  });
});

describe('快捷键、按钮和 Agent 共用命令', () => {
  const text = '把签到桌往左移1米';
  const start = [
    { id: RECEPTION_ID, label: '签到桌', locked: false, position: { x: 2, z: 1 } },
    { id: LOCKED_ID, label: '固定立柱', locked: true, position: { x: 8, z: 1 } },
  ];

  it('两条入口得到同一条命令，绕过通道无效', () => {
    const command = planMove(text, start);
    expect(command).toMatchObject({ status: 'ready', axis: 'case_x_minus', command: { op: 'move', id: RECEPTION_ID, position: { x: 1, z: 1 } } });
    if (command.status !== 'ready') throw new Error(command.reason);
    const byAgent = createSharedEditor(start);
    const byShortcut = createSharedEditor(start);
    expect(byAgent.execute('agent', command.command, 'shared').ok).toBe(true);
    expect(byShortcut.execute('shortcut', command.command, 'shared').ok).toBe(true);
    expect(byAgent.snapshot()).toEqual(byShortcut.snapshot());
    const bypass = byAgent.execute('agent', command.command, 'bypass');
    expect(bypass.ok).toBe(false);
    if (!bypass.ok) expect(bypass.code).toBe('BYPASS_REJECTED');
    expect(byAgent.snapshot().objects.find(item => item.id === RECEPTION_ID)?.position.x).toBe(1);
  });

  it('锁定、确认和撤销对按钮与 Agent 是同一套结果', () => {
    const editor = createSharedEditor(start);
    const command = planMove(text, start);
    if (command.status !== 'ready') throw new Error(command.reason);
    expect(editor.execute('shortcut', { op: 'move', id: LOCKED_ID, position: { x: 7, z: 1 } }, 'shared')).toMatchObject({ ok: false, code: 'OBJECT_LOCKED' });
    expect(editor.execute('agent', { op: 'move', id: '50000000-0000-4000-8000-000000000099', position: { x: 1, z: 1 } }, 'shared')).toMatchObject({ ok: false, code: 'OBJECT_NOT_FOUND' });
    editor.execute('agent', command.command, 'shared');
    expect(editor.snapshot()).toMatchObject({ pendingPreview: true, moveApplied: false });
    editor.confirm('button', 'shared');
    expect(editor.snapshot().moveApplied).toBe(true);
    editor.undo('agent', 'shared');
    expect(editor.snapshot()).toMatchObject({ pendingPreview: true, moveApplied: false });
    editor.undo('button', 'shared');
    expect(editor.snapshot().objects.find(item => item.id === RECEPTION_ID)?.position).toEqual({ x: 2, z: 1 });
    expect(editor.snapshot().objects.find(item => item.id === LOCKED_ID)?.position).toEqual({ x: 8, z: 1 });
  });
});

describe('社区讲座纵向案例', () => {
  const report = runCommunityLectureCase();

  it('按读、选择、反馈、修复、预览、确认、回读走完', () => {
    const phases = report.trace.map(item => item.phase);
    const expected = ['read', 'select', 'feedback', 'repair', 'preview', 'confirm', 'readback'] as const;
    let cursor = -1;
    for (const phase of expected) {
      cursor = phases.indexOf(phase, cursor + 1);
      expect(cursor).toBeGreaterThanOrEqual(0);
    }
    expect(phases.at(-1)).toBe('readback');
  });

  it('工具反馈、状态核验和质量评价彼此独立', () => {
    expect(report.evaluations.length).toBeGreaterThan(0);
    for (const item of report.evaluations) {
      expect(item.qualityNote.mayOverrideStateCheck).toBe(false);
      expect(item.toolFeedback.summary).not.toBe(item.stateCheck.summary);
    }
    const seating = report.evaluations.find(item => item.toolFeedback.tool === 'prepare_seating_candidate');
    expect(seating?.stateCheck.passed).toBe(false);
    expect(seating?.stateCheck.shortfall).toBeGreaterThan(0);
  });

  it('缺口不改写人数，建议不能确认，回读仍留下未知项', () => {
    expect(report.preview).toMatchObject({ requested: 30, applied: false, stale: true, limitReason: 'object_limit' });
    expect(report.preview!.placed).toBeLessThan(30);
    expect(report.preview!.shortfall).toBe(30 - report.preview!.placed);
    expect(report.memory.attendance).toMatchObject({ status: 'stated', people: 28 });
    expect(report.memory.attendance.status === 'stated' && report.memory.attendance.people).not.toBe(report.preview!.placed);
    expect(report.blockedSeating).toEqual({ ok: false, code: 'SHORTFALL_BLOCKS_CONFIRM' });
    expect(report.staleBlocked).toEqual({ ok: false, code: 'STALE_PREVIEW' });
    expect(report.readback.seatingApplied).toBe(false);
    expect(report.readback.factsConfirmed).toBe(false);
    expect(report.readback.venue.status).toBe('assumption');
    expect(report.readback.inventory[0]).toMatchObject({ count: 80, countsAsVerifiedStock: false });
    expect(report.readback.bom.counts.chair).toBe(report.preview!.placed);
    expect(report.readback.bom.counts.chair).not.toBe(80);
    expect(report.readback.unknowns).toEqual(expect.arrayContaining(['出入口与门扇', '行动辅助需求', '口述椅子数量不是已核验库存', '试排仍有缺口', '人数改过，旧试排已过期']));
    expect(report.guardedReplies[0]).not.toContain('80位长者');
    expect(report.toolSelections.exploreTools.tools).not.toContain('prepare_seating_candidate');
    expect(report.toolSelections.chosen.tools).toContain('prepare_seating_candidate');
    expect(report.toolSelections.chosen.tools).not.toContain('prepare_shared_seating_candidate');
    expect(report.bypassRejected).toBe('BYPASS_REJECTED');
    expect(report.missedObject).toBe('OBJECT_NOT_FOUND');
    expect(report.lockedRejected).toBe('OBJECT_LOCKED');
    expect(report.commandProof).toMatchObject({ moved: true, restoredX: 2, reconfirmed: true });
    expect(report.readback.moveApplied).toBe(true);
    expect(report.readback.objects.find(item => item.id === RECEPTION_ID)?.position).toEqual({ x: 1, z: 1 });
    expect(report.library.notice).toContain('不是已核验库存');
  });
});

describe('更多对抗句', () => {
  const desks = [{ id: RECEPTION_ID, label: '签到桌', locked: false, position: { x: 2, z: 1 } }];
  const emptyPreview: SeatingPreview = {
    requested: 1,
    placed: 1,
    shortfall: 0,
    limitReason: null,
    unknown: [],
    applied: false,
    stale: false,
    assumption: '建议',
  };

  it('80 把椅子、中文数量和否定句都不会写成人数', () => {
    const mixed = readTurn(initialExploreMemory(), '我们有80把椅子，不是80个人，到场大概30人');
    expect(mixed.memory.attendance).toMatchObject({ status: 'approximate', people: 30 });
    expect(mixed.memory.inventory[0]).toMatchObject({ count: 80, countsAsPeople: false, countsAsVerifiedStock: false });
    expect(guardSeatingCount(80, mixed.memory)).toEqual({ ok: false, code: 'HEADCOUNT_NOT_FURNITURE' });
    expect(readIntents('我们有80把椅子，不是80个人，到场大概30人')).not.toContain('move_object');

    const spoken = readTurn(initialExploreMemory(), '八十把椅子，三十个人来听讲座');
    expect(spoken.memory.attendance).toMatchObject({ status: 'stated', people: 30 });
    expect(spoken.memory.inventory.map(item => item.count)).toEqual([80]);
    expect(spoken.memory.mobility.status).toBe('unknown');

    const enough = readTurn(initialExploreMemory(), '80把椅子够坐，到场大概30人');
    expect(enough.memory.attendance).toMatchObject({ people: 30 });
    expect(enough.memory.inventory[0]?.count).toBe(80);
    expect(enough.memory.layout.status).toBe('unknown');

    const damaged = readTurn(initialExploreMemory(), '80把椅子里有10把坏的，来的大概30个人');
    expect(damaged.memory.inventory.map(item => item.count)).toEqual([80]);
    expect(damaged.memory.inventory[0]?.countsAsVerifiedStock).toBe(false);
    expect(damaged.memory.attendance).toMatchObject({ people: 30 });

    const uncounted = readTurn(initialExploreMemory(), '请按80把椅子安排座位，人还没统计');
    expect(uncounted.memory.attendance.status).toBe('unknown');
    expect(guardSeatingCount(80, uncounted.memory).ok).toBe(false);
    expect(selectTools(uncounted.memory, uncounted.intents).tools).not.toContain('prepare_seating_candidate');

    const elderlyCount = readTurn(initialExploreMemory(), '八十位长者，我们有三十把椅子');
    expect(elderlyCount.memory.attendance).toMatchObject({ status: 'stated', people: 80 });
    expect(elderlyCount.memory.inventory[0]).toMatchObject({ count: 30, countsAsPeople: false });
    expect(elderlyCount.memory.mobility.status).toBe('unknown');
    expect(guardSeatingCount(30, elderlyCount.memory).ok).toBe(false);
  });

  it('长者、适老和否定句不会变成轮椅需求', () => {
    const assume = readTurn(initialExploreMemory(), '来的多是长者，腿脚都好，先别假设轮椅');
    expect(assume.memory.audienceTags).toEqual(['elderly']);
    expect(assume.memory.mobility).toEqual({ status: 'unknown', evidence: null });
    expect(readMobilityMention('不愿被当成轮椅使用者')?.status).toBe('unknown');

    const unspoken = readTurn(initialExploreMemory(), '老年大学的讲座，没有人提轮椅');
    expect(unspoken.memory.audienceTags).toEqual(['elderly']);
    expect(unspoken.memory.mobility.status).toBe('unknown');
    expect(unspoken.reply).toContain('还不知道');
    expect(unspoken.reply).not.toMatch(/配备轮椅|已经需要轮椅/);

    const refuse = readTurn(initialExploreMemory(), '长者不愿被当成轮椅使用者');
    expect(refuse.memory.mobility.status).toBe('unknown');
    expect(refuse.memory.audienceTags).toEqual(['elderly']);

    const aging = readTurn(initialExploreMemory(), '适老化不等于上轮椅');
    expect(aging.memory.audienceTags).toEqual(['elderly']);
    expect(aging.memory.mobility.status).toBe('unknown');

    const declined = readTurn(initialExploreMemory(), '80位老人来听讲座，不需要轮椅');
    expect(declined.memory.attendance).toMatchObject({ status: 'stated', people: 80 });
    expect(declined.memory.mobility.status).toBe('declined');
    expect(declined.memory.layout.status).not.toBe('stated');

    const explicit = readTurn(initialExploreMemory(), '有一位来宾是轮椅使用者');
    expect(explicit.memory.mobility.status).toBe('needed');
    expect(explicit.memory.audienceTags).toEqual([]);
    expect(explicit.memory.attendance).toMatchObject({ status: 'stated', people: 1 });
  });

  it('建议可以留下，但不能确认，也不能当成已经选定', () => {
    expect(confirmSeating(emptyPreview)).toEqual({ ok: false, code: 'SUGGESTION_NOT_CONFIRMED' });
    const suggested = readTurn(initialExploreMemory(), '我建议先一人一桌，但先别确认');
    expect(suggested.memory.layout).toMatchObject({ status: 'suggestion', value: 'one_desk_one_chair' });
    expect(selectTools(suggested.memory, suggested.intents).tools).not.toContain('prepare_seating_candidate');
    expect(selectTools(suggested.memory, suggested.intents).tools).not.toContain('prepare_shared_seating_candidate');

    const question = readTurn(initialExploreMemory(), '要不要改成课桌？只是问问');
    expect(question.memory.layout.status).toBe('unknown');
    const look = readTurn(initialExploreMemory(), '按你的建议看看，不要写入场景');
    expect(look.memory.layout.status).not.toBe('stated');
    const defer = readTurn(initialExploreMemory(), '这个建议不错，不过先别定座位形式');
    expect(defer.memory.layout.status).toBe('unknown');
    expect(defer.memory.deferred).toContain('座位形式');
    const directSuggestion = readTurn(initialExploreMemory(), '建议直接摆好一人一桌');
    expect(directSuggestion.memory.layout.status).toBe('suggestion');
    expect(directSuggestion.memory.layout.status).not.toBe('stated');
  });

  it('同一句里的改人数、移动、清单和不确定的轮椅都留下', () => {
    const text = '改成28人，把签到桌往左移1米，并出一份物料清单，长者不一定要轮椅，这只是建议';
    expect(readIntents(text)).toEqual(['revise_headcount', 'move_object', 'bill_of_materials']);
    const turn = readTurn(initialExploreMemory(), text);
    expect(turn.memory.attendance).toMatchObject({ status: 'stated', people: 28 });
    expect(turn.memory.mobility.status).toBe('unknown');
    expect(turn.memory.audienceTags).toEqual(['elderly']);
    expect(turn.memory.layout.status).not.toBe('stated');
    expect(planMove(text, desks)).toMatchObject({ status: 'ready', axis: 'case_x_minus' });

    const kept = '不要确认。改成28人，签到桌往左1米，出物料清单。';
    expect(readIntents(kept)).toEqual(['revise_headcount', 'move_object', 'bill_of_materials']);
    expect(readTurn(initialExploreMemory(), kept).memory.attendance).toMatchObject({ people: 28 });

    const bothWays = '把签到桌往左移1米，再往右移0.5米，人数改成28人，清单也要';
    expect(readIntents(bothWays)).toEqual(['revise_headcount', 'move_object', 'bill_of_materials']);
    expect(planMove(bothWays, desks)).toMatchObject({ status: 'unresolved' });
    expect(readTurn(initialExploreMemory(), bothWays).memory.attendance).toMatchObject({ people: 28 });
    expect(readTurn(initialExploreMemory(), bothWays).intents).toContain('bill_of_materials');
  });

  it('模型把中文人数或轮椅说成事实时会被丢掉', () => {
    const guarded = guardModelReply('大概30个人来，来的多是长者', '预计将有八十位长者参加。需要准备轮椅通道。大约30人可以先记下来。');
    expect(guarded.dropped.join('')).toContain('八十位长者');
    expect(guarded.dropped.join('')).toContain('轮椅');
    expect(guarded.text).toContain('30人');
    expect(guarded.text).not.toContain('轮椅');
    const confirmed = guardModelReply('我建议先一人一桌', '已确认一人一桌。可以先按建议看看。');
    expect(confirmed.dropped.join('')).toContain('已确认');
    expect(confirmed.text).not.toContain('已确认');
  });
});

describe('对话建议 v2', () => {
  it('历史是 7 项里 6 项失败，默认关闭，本案例不能打开', () => {
    expect(V2_ADVERSARIAL_HISTORY).toMatchObject({ items: 7, failures: 6, defaultEnabled: false, presentOnMain: false });
    expect(suggestionChannel({ requested: false })).toMatchObject({ enabled: false, reason: 'default_off' });
    expect(suggestionChannel({ requested: true })).toMatchObject({ enabled: false, reason: 'reproduce_before_enable' });
    expect(suggestionChannel({ requested: true, reproduction: { items: 7, failures: 0, rerunOnCurrentMain: true } })).toMatchObject({ enabled: false, reason: 'case_harness_cannot_ship_v2' });
    expect(runCommunityLectureCase().v2.enabled).toBe(false);
  });
});
