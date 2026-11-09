import {describe,expect,it} from 'vitest';
import {mergeLocalSeatingSpecs} from './local-seating-specs';

describe('explicit local seating dimensions',()=>{
 it('retains a user-reported dimension across unrelated turns and applies corrections',()=>{
  const first=mergeLocalSeatingSpecs(undefined,'桌子宽1.8米');
  expect(first?.desk?.width).toEqual({status:'reported',valueM:1.8,evidence:'桌子宽1.8米'});
  expect(mergeLocalSeatingSpecs(first,'30人，场地20×20米，有80把椅子')).toEqual(first);
  expect(mergeLocalSeatingSpecs(first,'桌子宽改为160厘米')?.desk?.width).toEqual({status:'reported',valueM:1.6,evidence:'桌子宽改为160厘米'});
 });
 it('converts explicit centimetres and millimetres without replacing unspecified dimensions',()=>{
  const value=mergeLocalSeatingSpecs(undefined,'桌子宽180厘米，椅子深570毫米');
  expect(value?.desk?.width?.valueM).toBe(1.8);expect(value?.chair?.depth?.valueM).toBe(.57);
  expect(value?.desk?.depth).toBeUndefined();expect(value?.chair?.width).toBeUndefined();
 });
 it('records a dimension tuple only for the stated object and specified axes',()=>{
  const value=mergeLocalSeatingSpecs(undefined,'桌子尺寸1.8×0.6米');
  expect(value?.desk?.width?.valueM).toBe(1.8);expect(value?.desk?.depth?.valueM).toBe(.6);
  expect(value?.desk?.height).toBeUndefined();expect(value?.chair).toBeUndefined();
 });
 it.each(['桌子宽1.8','桌子宽180英寸','桌子宽可能1.8米','桌子宽1.8米或2米','桌子宽1米8','桌子宽1.8米到2米','桌子宽0米'])('marks ambiguous or unsupported width unknown: %s',raw=>{
  expect(mergeLocalSeatingSpecs(undefined,raw)?.desk?.width).toMatchObject({status:'unknown',valueM:null});
 });
 it('keeps conflicting values unknown until the relevant dimension is restated',()=>{
  const first=mergeLocalSeatingSpecs(undefined,'桌子宽1.8米宽2米');
  expect(first?.desk?.width?.status).toBe('unknown');
  expect(mergeLocalSeatingSpecs(first,'桌子宽1.6米')?.desk?.width).toMatchObject({status:'reported',valueM:1.6});
 });
 it('does not silently pick one of two same-turn widths without an explicit correction',()=>{
  expect(mergeLocalSeatingSpecs(undefined,'桌子宽1.8米，桌子宽2米')?.desk?.width).toMatchObject({status:'unknown',valueM:null});
  expect(mergeLocalSeatingSpecs(undefined,'桌子宽1.8米，桌子宽改为2米')?.desk?.width).toMatchObject({status:'reported',valueM:2});
 });
 it('requires clarification for an unqualified follow-up width or correction',()=>{
  expect(mergeLocalSeatingSpecs(undefined,'桌子宽1.8米，宽2米')?.desk?.width).toMatchObject({status:'unknown',valueM:null});
  const first=mergeLocalSeatingSpecs(undefined,'桌子宽1.8米');
  expect(mergeLocalSeatingSpecs(first,'改成1.6米')?.desk?.width).toMatchObject({status:'unknown',valueM:null});
  expect(mergeLocalSeatingSpecs(first,'场地改成20×20米')?.desk?.width).toMatchObject({status:'reported',valueM:1.8});
 });
 it.each(['场地宽20米，放30把椅子','桌子放在20米宽的场地','预计30人，桌椅一人一套','去年桌子宽1.8米'])('does not turn other numbers into furniture dimensions: %s',raw=>{
  expect(mergeLocalSeatingSpecs(undefined,raw)).toBeUndefined();
 });
 it('keeps an unqualified combined furniture size unknown',()=>{
  const value=mergeLocalSeatingSpecs(undefined,'桌椅尺寸1.8×0.6米');
  expect(value?.desk?.width?.status).toBe('unknown');expect(value?.chair?.width?.status).toBe('unknown');
 });
 it('keeps stock dimensions separate until the user explicitly selects a matching specification',()=>{
  const reported=mergeLocalSeatingSpecs(undefined,'现有桌子宽1.8米');
  expect(reported?.desk).toBeUndefined();expect(reported?.unselected?.desk?.width).toMatchObject({status:'reported',valueM:1.8});
  expect(mergeLocalSeatingSpecs(reported,'用现有桌子')?.desk).toBeUndefined();
  expect(mergeLocalSeatingSpecs(reported,'使用现有桌子宽1.8米')?.desk?.width).toMatchObject({status:'reported',valueM:1.8});
 });
 it('does not let a later stock observation replace an explicitly chosen plan dimension',()=>{
  const chosen=mergeLocalSeatingSpecs(undefined,'桌子宽1.6米');
  const observed=mergeLocalSeatingSpecs(chosen,'库存桌子宽1.8米');
  expect(observed?.desk?.width?.valueM).toBe(1.6);expect(observed?.unselected?.desk?.width?.valueM).toBe(1.8);
 });
 it('keeps different stock sizes unselected and accepts an explicit default choice',()=>{
  const first=mergeLocalSeatingSpecs(undefined,'现有桌子宽1.8米');
  const second=mergeLocalSeatingSpecs(first,'库存桌子宽2米');
  expect(mergeLocalSeatingSpecs(second,'用现有')?.desk).toBeUndefined();
  expect(mergeLocalSeatingSpecs(second,'桌子按默认规格')?.defaults?.desk).toBe('桌子按默认规格');
 });
 it('recognizes an explicit measurement before a furniture name, not a venue size',()=>{
  expect(mergeLocalSeatingSpecs(undefined,'1.8米宽的桌子')?.desk?.width).toMatchObject({status:'reported',valueM:1.8});
  expect(mergeLocalSeatingSpecs(undefined,'20米宽的场地摆桌子')).toBeUndefined();
 });
});
