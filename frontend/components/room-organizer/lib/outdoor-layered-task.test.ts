import { describe, expect, it } from 'vitest';
import { absorbLayeredInstruction, layeredBounceText } from './outdoor-layered-task';
import { createPendingTask } from './outdoor-pending-task';

const BOUNCE = '先定活动范围：地点还没定，这句已经存好。';

describe('absorbLayeredInstruction（室外集会口径）', () => {
  it('「先摆摊位，最后再调通道」：现在这件是摆摊位，通道留到后面', () => {
    const layered = absorbLayeredInstruction({ text: '先摆摊位，最后再调通道', stage: 'place', now: 1000 });
    expect(layered).not.toBeNull();
    expect(layered!.task.goal).toBe('先摆摊位');
    expect(layered!.deferred).toEqual(['最后再调通道']);
    expect(layered!.original).toBe('先摆摊位，最后再调通道');
    expect(layered!.task.next.label).toBe('在地图上选地点');
  });

  it('整句都是后置动作时目标不空，待办上不出现空白目标', () => {
    const layered = absorbLayeredInstruction({ text: '最后再调通道', stage: 'range', now: 1000 });
    expect(layered!.immediate).toBe('');
    expect(layered!.task.goal).toBe('最后再调通道');
    expect(layered!.deferred).toEqual(['最后再调通道']);
    expect(layered!.task.next.label).toBe('确认活动范围');
  });

  it('同一件待办被改写：id 不变、revision +1、目标换成新的现在这件', () => {
    const first = absorbLayeredInstruction({ text: '先摆摊位，最后再调通道', stage: 'place', now: 1000 })!;
    const second = absorbLayeredInstruction({ text: '先划出入口，之后上围栏', stage: 'place', task: first.task, now: 2000 })!;
    expect(second.task.id).toBe(first.task.id);
    expect(second.task.revision).toBe(first.task.revision + 1);
    expect(second.task.goal).toBe('先划出入口');
    expect(second.deferred).toEqual(['之后上围栏']);
  });

  it('环境口径只透传用户明说的那种，没提就不写', () => {
    expect(absorbLayeredInstruction({ text: '只做室外，先摆摊位', stage: 'place' })!.environment).toBe('outdoor');
    expect(absorbLayeredInstruction({ text: '室内外都有，先摆摊位', stage: 'place' })!.environment).toBe('both');
    expect(absorbLayeredInstruction({ text: '先摆摊位', stage: 'place' })!.environment).toBeUndefined();
  });

  it('空白句返回 null，不造一件空待办', () => {
    expect(absorbLayeredInstruction({ text: '   ', stage: 'place' })).toBeNull();
  });
});

describe('layeredBounceText', () => {
  it('带上唯一下一步，并把后置项写成「后面还有」，不提问', () => {
    const layered = absorbLayeredInstruction({ text: '先摆摊位，最后再调通道', stage: 'place', now: 1000 })!;
    const text = layeredBounceText(layered, BOUNCE);
    expect(text).toContain('下一步：在地图上选地点');
    expect(text).toContain('后面还有：最后再调通道');
    expect(text).toContain('现在不用决定');
    expect(text).not.toMatch(/[？?]/);
  });

  it('没有后置项时不多出一条尾巴', () => {
    const layered = absorbLayeredInstruction({ text: '先摆摊位', stage: 'place', now: 1000 })!;
    const text = layeredBounceText(layered, BOUNCE);
    expect(text).not.toContain('后面还有');
    expect(text).toContain('下一步：在地图上选地点');
  });

  it('已有待办改口时用最新一步，不复述上一步', () => {
    const task = createPendingTask({ goal: '先摆摊位', waitingOn: 'place', now: 1000 });
    const layered = absorbLayeredInstruction({ text: '先划出入口，之后上围栏', stage: 'place', task })!;
    expect(layeredBounceText(layered, BOUNCE)).toContain('下一步：在地图上选地点');
    expect(layeredBounceText(layered, BOUNCE)).toContain('之后上围栏');
  });
});
