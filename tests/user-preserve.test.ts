import {describe,expect,it} from 'vitest';
import {readPreserveExisting} from '../supabase/functions/_shared/user-preserve.ts';

describe('explicit retention requests',()=>{
 it('distinguishes retaining items from retaining their positions',()=>{
  expect(readPreserveExisting('请为30人排布，必须保留所有原物')).toEqual({keepAll:true,keepPositions:false});
  expect(readPreserveExisting('保留原有物件，位置不变')).toEqual({keepAll:true,keepPositions:true});
  expect(readPreserveExisting('保留原有物件位置不变')).toEqual({keepAll:true,keepPositions:true});
  expect(readPreserveExisting('不要移动现有家具')).toEqual({keepAll:true,keepPositions:true});
 });
 it('does not infer a global lock from a specific item',()=>expect(readPreserveExisting('保留舞台')).toBeUndefined());
 it('honours a later explicit withdrawal',()=>expect(readPreserveExisting('保留所有原物，不必保留原有家具')).toEqual({keepAll:false,keepPositions:false}));
 it('does not turn a question into a decision and handles explicit withdrawal',()=>{
  expect(readPreserveExisting('是否保留所有原物？')).toBeUndefined();
  expect(readPreserveExisting('不要保留所有原物')).toEqual({keepAll:false,keepPositions:false});
 });
});
