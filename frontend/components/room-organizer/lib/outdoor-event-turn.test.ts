import { describe, expect, it } from 'vitest';
import { parseOutdoorEventTurn } from './outdoor-event-turn';
describe('同一户外任务的自然需求补充', () => {
  it('支持只给活动、只改人数及纠正活动，不需要暗号', () => {
    expect(parseOutdoorEventTurn('我想做个讲座', null)).toEqual({ event: '讲座', headcount: null });
    expect(parseOutdoorEventTurn('改成60人吧', '讲座')).toEqual({ event: '讲座', headcount: 60 });
    expect(parseOutdoorEventTurn('不是讲座，是80人的市集', '讲座')).toEqual({ event: '市集', headcount: 80 });
    expect(parseOutdoorEventTurn('做300人烟花燃放', null)).toEqual({ event: '烟花燃放', headcount: 300 });
  });
  it('不把取消、普通问题和未给活动的人数当自动排布', () => {
    expect(parseOutdoorEventTurn('不要做讲座', '讲座')).toBeNull();
    expect(parseOutdoorEventTurn('看看舞台的模型', '讲座')).toBeNull();
    expect(parseOutdoorEventTurn('60人', null)).toBeNull();
  });
});
