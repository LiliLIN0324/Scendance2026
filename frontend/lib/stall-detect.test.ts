import { describe, expect, it } from 'vitest';

import { detectStall, STALL_POLLS } from './stall-detect';
import type { StallSnapshot } from './stall-detect';

/** 造一格快照；可选字段只在真给了值时才挂上（对齐 exactOptionalPropertyTypes）。 */
function snap(ts: number, round?: number, phase?: string, changedCells?: number): StallSnapshot {
  const snapshot: StallSnapshot = { ts };
  if (round !== undefined) snapshot.round = round;
  if (phase !== undefined) snapshot.phase = phase;
  if (changedCells !== undefined) snapshot.changedCells = changedCells;
  return snapshot;
}

describe('detectStall', () => {
  it(`不足 ${STALL_POLLS + 1} 格样本时凑不齐「连续 ${STALL_POLLS} 次无进展」，不判停滞`, () => {
    expect(detectStall([])).toEqual({ stalled: false });
    expect(detectStall([snap(0, 1, 'survey', 0)])).toEqual({ stalled: false });
    expect(detectStall([snap(0, 1, 'survey', 0), snap(2000, 1, 'survey', 0)])).toEqual({ stalled: false });
  });

  it('连续两次轮询轮次/阶段/改动数都没变 → 判停滞', () => {
    expect(detectStall([
      snap(0, 1, 'survey', 2),
      snap(2000, 1, 'survey', 2),
      snap(4000, 1, 'survey', 2),
    ])).toEqual({ stalled: true, reason: 'no-progress' });
  });

  it('轮次 +1 算前进 → 不停滞', () => {
    expect(detectStall([
      snap(0, 1, 'survey', 0),
      snap(2000, 1, 'survey', 0),
      snap(4000, 2, 'survey', 0),
    ])).toEqual({ stalled: false });
  });

  it('改动数增加算前进 → 不停滞', () => {
    expect(detectStall([
      snap(0, 1, 'survey', 1),
      snap(2000, 1, 'survey', 1),
      snap(4000, 1, 'survey', 3),
    ])).toEqual({ stalled: false });
  });

  it('阶段前进算前进 → 不停滞', () => {
    expect(detectStall([
      snap(0, 1, 'survey', 0),
      snap(2000, 1, 'survey', 0),
      snap(4000, 1, 'locate', 0),
    ])).toEqual({ stalled: false });
  });

  it('阶段从拿不到到出现（undefined → 真值）算变化 → 不误判停滞', () => {
    expect(detectStall([
      snap(0, 1, undefined, 0),
      snap(2000, 1, undefined, 0),
      snap(4000, 1, 'survey', 0),
    ])).toEqual({ stalled: false });
  });

  it('前面有过进展、最近两次又卡住 → 仍判停滞', () => {
    expect(detectStall([
      snap(0, 1, 'survey', 0),
      snap(2000, 2, 'survey', 1),
      snap(4000, 2, 'survey', 1),
      snap(6000, 2, 'survey', 1),
    ])).toEqual({ stalled: true, reason: 'no-progress' });
  });

  it('停滞后再前进（改动数增加）立即解除', () => {
    expect(detectStall([
      snap(0, 1, 'survey', 0),
      snap(2000, 1, 'survey', 0),
      snap(4000, 1, 'survey', 0),
      snap(6000, 1, 'survey', 1),
    ])).toEqual({ stalled: false });
  });
});
