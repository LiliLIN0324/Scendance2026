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
  it('D2 新模板类型的活动句照常进入同一任务流', () => {
    expect(parseOutdoorEventTurn('45人美食节', null)).toEqual({ event: '美食节', headcount: 45 });
    expect(parseOutdoorEventTurn('办一场100人车展', null)).toEqual({ event: '车展', headcount: 100 });
    expect(parseOutdoorEventTurn('90人运动会', null)).toEqual({ event: '运动会', headcount: 90 });
    expect(parseOutdoorEventTurn('60人相亲会', null)).toEqual({ event: '相亲', headcount: 60 });
    expect(parseOutdoorEventTurn('办个60人展览', null)).toEqual({ event: '展览', headcount: 60 });
    expect(parseOutdoorEventTurn('80人新品发布会', null)).toEqual({ event: '发布会', headcount: 80 });
  });
  it('D2 新类型的取消句不当成自动排布（否决守卫与新词同步扩展）', () => {
    expect(parseOutdoorEventTurn('不要美食节', null)).toBeNull();
    expect(parseOutdoorEventTurn('取消车展', null)).toBeNull();
    expect(parseOutdoorEventTurn('别做相亲了', null)).toBeNull();
  });
});

it('only continues site/entry supplements for the current blocked event; preserves prior intent and does not intercept questions/models',()=>{
 const text='场地已画好，入口在东侧，签到放入口内侧，舞台在远端';
 expect(parseOutdoorEventTurn(text,'讲座',true)).toEqual({event:'讲座',headcount:null});
 expect(parseOutdoorEventTurn(text,'讲座',false)).toBeNull();
 expect(parseOutdoorEventTurn('为什么入口放这里？','讲座',true)).toBeNull();
 expect(parseOutdoorEventTurn('看看舞台的模型','讲座',true)).toBeNull();
 expect(parseOutdoorEventTurn('取消活动','讲座',true)).toBeNull();
});
