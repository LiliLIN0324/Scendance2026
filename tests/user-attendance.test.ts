import {describe,expect,it} from 'vitest';
import {readUserAttendance} from '../supabase/functions/_shared/user-attendance.ts';

describe('reported attendance in user text',()=>{
 it.each([
  ['请为30人按每2人一桌试排',30],['2人每桌共30人',30],['30人每桌2人',30],
  ['预计三十人参加，每桌两人',30],['现有80把椅子，预计30人',30],
 ])('separates attendance and allocation: %s',(text,people)=>expect(readUserAttendance(text)).toEqual({status:'reported',people}));
 it.each(['30人加40人','不是30人','不超过30人','人数待定','不是30人，也不是40人'])('keeps uncertain or conflicting facts unknown: %s',text=>expect(readUserAttendance(text)).toEqual({status:'unknown'}));
 it.each(['每2人一桌','有80把椅子','先生成方案','八十把椅子'])('does not invent a total: %s',text=>expect(readUserAttendance(text)).toBeUndefined());
 it('keeps the positive count when an earlier clause only rejects another total',()=>{
  expect(readUserAttendance('我们有80把椅子，不是80个人，到场大概30人')).toEqual({status:'reported',people:30});
  expect(readUserAttendance('不要确认。改成28人')).toEqual({status:'reported',people:28});
  expect(readUserAttendance('不要30人')).toEqual({status:'unknown'});
  expect(readUserAttendance('80位老人来听讲座')).toEqual({status:'reported',people:80});
  expect(readUserAttendance('八十位长者，我们有三十把椅子')).toEqual({status:'reported',people:80});
 });
});
