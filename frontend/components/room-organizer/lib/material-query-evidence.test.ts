import {describe,expect,it} from 'vitest';
import {supportedMaterialQueries} from './material-query-evidence';

describe('material search originates in the current user wording',()=>{
 it('permits a quoted material and refuses fabricated, negated or old-event suggestions',()=>{
  expect(supportedMaterialQueries('现有80把椅子',[{query:'椅子',evidence:'80把椅子'}])).toEqual(['椅子']);
  expect(supportedMaterialQueries('不需要椅子',[{query:'椅子',evidence:'椅子'}])).toEqual([]);
  expect(supportedMaterialQueries('上次摆了椅子',[{query:'椅子',evidence:'椅子'}])).toEqual([]);
  expect(supportedMaterialQueries('本场要桌子',[{query:'椅子',evidence:'桌子'}])).toEqual([]);
 });
 it('does not guess which repeated clause a short quote refers to',()=>{
  expect(supportedMaterialQueries('不要椅子，要椅子',[{query:'椅子',evidence:'椅子'}])).toEqual([]);
 });
});
