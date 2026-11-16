import { describe, expect, it } from 'vitest';
import { createTurnTraceBook, exportTraceBundle, toExportRow } from './turn-trace-log';
import { beginAttempt, enterStage, finishTurn, startTurn, type TurnTrace } from './turn-trace';

function finishedTurn(route: 'local' | 'map' | 'conversation', terminal: 'local_done' | 'awaiting_place' | 'failed', now: number, errorCode?: string): TurnTrace {
  let trace = startTurn({ route, now });
  trace = enterStage(trace, route === 'map' ? 'map' : 'understand', now + 10);
  return finishTurn(trace, terminal, { errorCode, now: now + 100 });
}

describe('编号簿', () => {
  it('最近的在最前，超出容量丢最旧的', () => {
    const book = createTurnTraceBook(3);
    for (let i = 0; i < 5; i += 1) book.record(finishedTurn('local', 'local_done', 1000 + i * 1000));
    const list = book.list();
    expect(list).toHaveLength(3);
    expect(list[0].startedAt).toBe(5000);
    expect(list[2].startedAt).toBe(3000);
  });

  it('同一 turnId 再记是更新，不留半截影子', () => {
    const book = createTurnTraceBook(5);
    let trace = startTurn({ route: 'map', now: 1000 });
    book.record(trace);
    expect(book.list()).toHaveLength(1);
    trace = finishTurn(trace, 'awaiting_place', { now: 1200 });
    book.record(trace);
    expect(book.list()).toHaveLength(1);
    expect(book.list()[0].terminal).toBe('awaiting_place');
  });

  it('limit 只取最近几条，clear 之后清空', () => {
    const book = createTurnTraceBook(5);
    book.record(finishedTurn('local', 'local_done', 1000));
    book.record(finishedTurn('local', 'local_done', 2000));
    expect(book.list(1)).toHaveLength(1);
    expect(book.list(0)).toHaveLength(0);
    expect(book.clear().list()).toHaveLength(0);
  });

  it('容量非法时至少留一条', () => {
    const book = createTurnTraceBook(0);
    book.record(finishedTurn('local', 'local_done', 1000));
    book.record(finishedTurn('local', 'local_done', 2000));
    expect(book.list()).toHaveLength(1);
  });
});

describe('导出白名单', () => {
  it('原始对象上多挂的字段不会被抄进导出', () => {
    // 模拟以后有人给 trace 挂了原话与坐标：导出必须当它们不存在。
    const trace = Object.assign(finishedTurn('map', 'awaiting_place', 1000), {
      text: '在杭州植物园玉泉鱼跃周边做两日市集',
      coords: [30.2, 120.1],
      token: 'sk-live-abc',
    }) as TurnTrace;
    const row = toExportRow(trace);
    expect(Object.keys(row).sort()).toEqual(
      ['attempts', 'errorCode', 'line', 'route', 'stages', 'terminal', 'totalMs', 'turnId'].sort(),
    );
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain('玉泉');
    expect(serialized).not.toContain('30.2');
    expect(serialized).not.toContain('sk-live');
  });

  it('一次导出是可直接粘贴的文本，含时间、轮次与每轮摘要', () => {
    const turns = [
      finishedTurn('local', 'local_done', 1000),
      finishedTurn('conversation', 'failed', 2000, 'provider_error'),
    ];
    const bundle = exportTraceBundle(turns, 1_700_000_000_000);
    expect(bundle.rows).toHaveLength(2);
    expect(bundle.text.split('\n')).toHaveLength(3);
    expect(bundle.text).toContain('2023-11-14T22:13:20.000Z');
    expect(bundle.text).toContain('2 轮');
    expect(bundle.text).toContain('term=failed');
    expect(bundle.text).toContain('code=provider_error');
  });

  it('失败轮的耗时与尝试次数如实带出', () => {
    let trace = startTurn({ route: 'conversation', now: 1000 });
    const first = beginAttempt(trace, 1010);
    const second = beginAttempt(first.trace, 1020);
    trace = finishTurn(second.trace, 'failed', { errorCode: 'timeout', now: 3000 });
    const row = toExportRow(trace);
    expect(row.attempts).toBe(2);
    expect(row.totalMs).toBe(2000);
    expect(row.errorCode).toBe('timeout');
  });
});
