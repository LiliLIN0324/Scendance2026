import {describe,expect,it} from 'vitest';
import {mergeSeatingAllocation} from './seating-allocation';

describe('explicit people per desk',()=>{
 it.each(['每桌人数还没确定','每桌人数待定','每桌最多2人'])('keeps an explicit unresolved or bounded allocation unknown: %s',text=>{
  expect(mergeSeatingAllocation(undefined,text)).toMatchObject({status:'unknown',peoplePerDesk:null});
 });
 it('recognizes a numeric people-per-desk shorthand without inferring a venue rule',()=>{
  expect(mergeSeatingAllocation(undefined,'采用2人/桌')).toMatchObject({status:'shared_desk',peoplePerDesk:2});
  expect(mergeSeatingAllocation(undefined,'桌子数量还没确定')).toBeUndefined();
 });
 it.each(['每2人一桌','两人一张课桌','每桌坐2人','一桌坐两人','两人共用一张长桌','2人共用1张桌'])('records a shared desk choice: %s',text=>{
  expect(mergeSeatingAllocation(undefined,text)).toMatchObject({status:'shared_desk',peoplePerDesk:2,evidence:text});
 });
 it.each(['每人一桌','一人一套课桌椅','每1人一桌'])('records an explicit one-per-person choice: %s',text=>{
  expect(mergeSeatingAllocation(undefined,text)).toMatchObject({status:'one_per_desk',peoplePerDesk:1});
 });
 it('preserves a choice across unrelated turns and accepts an explicit correction',()=>{
  const shared=mergeSeatingAllocation(undefined,'每2人一桌');
  expect(mergeSeatingAllocation(shared,'30人，室内20×20，采用课桌椅')).toEqual(shared);
  expect(mergeSeatingAllocation(shared,'改成每人一桌')).toMatchObject({status:'one_per_desk',peoplePerDesk:1});
 });
 it.each(['不要每人一桌','不确定每人一桌','每人一桌还是每2人一桌','每人一桌，每2人一桌'])('keeps negated, uncertain or conflicting choices unresolved: %s',text=>{
  expect(mergeSeatingAllocation(undefined,text)).toMatchObject({status:'unknown',peoplePerDesk:null});
 });
 it.each(['多人共桌','每桌坐几人','每桌多人'])('does not assume one per desk when a shared count is unclear: %s',text=>{
  expect(mergeSeatingAllocation(undefined,text)).toMatchObject({status:'unknown',peoplePerDesk:null});
 });
 it('allows an explicit positive correction after ruling out another arrangement',()=>{
  expect(mergeSeatingAllocation(undefined,'不要每2人一桌，按每人一桌')).toMatchObject({status:'one_per_desk',peoplePerDesk:1});
 });
 it('does not turn attendance, style, old events or unselected stock into a choice',()=>{
  for(const text of ['30人，采用课桌椅','去年每2人一桌','库存每桌坐2人'])expect(mergeSeatingAllocation(undefined,text)).toBeUndefined();
 });
 it('records a clearly selected stock arrangement',()=>{
  expect(mergeSeatingAllocation(undefined,'采用库存每桌坐2人')).toMatchObject({status:'shared_desk',peoplePerDesk:2});
 });
});
