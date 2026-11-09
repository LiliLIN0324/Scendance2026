import {describe,expect,it,vi} from 'vitest';
import {loadOnlineModels} from './online-models';
import {searchMaterialCandidates} from './material-candidates';

describe('候选物料目录检索',()=>{
 it('returns multiple actual chair models from the shipped catalogue, bounded and identifiable',async()=>{
  const result=await searchMaterialCandidates('椅子');expect(result.status).toBe('ok');if(result.status!=='ok')throw Error('unexpected');
  expect(result.query).toBe('椅子');expect(result.total).toBeGreaterThan(2);expect(result.items.length).toBeGreaterThan(1);expect(result.items.length).toBeLessThanOrEqual(5);
  const index=await loadOnlineModels();for(const item of result.items){const source=index.models.find(model=>model.slug===item.slug);expect(source).toBeDefined();expect(item.name).toBe(source!.name);expect(item.dimensions).toEqual({width:source!.width,depth:source!.depth,height:source!.height});expect(item.name).toContain('椅');expect(item).not.toHaveProperty('price');expect(item).not.toHaveProperty('stock');}
 });
 it('can find multiple specific chair types without fabricating alternatives',async()=>{
  for(const query of ['餐椅','折叠椅']){const result=await searchMaterialCandidates(query);expect(result.status).toBe('ok');if(result.status==='ok'){expect(result.items.length).toBeGreaterThan(0);expect(result.items.every(item=>item.name.includes(query))).toBe(true);}}
  expect(await searchMaterialCandidates('肯定不存在的星际折叠木椅999999')).toEqual({status:'ok',query:'肯定不存在的星际折叠木椅999999',total:0,items:[]});
 });
 it('requires an explicit valid query and bounded result count before loading',async()=>{
  const load=vi.fn();expect(await searchMaterialCandidates('  ',{load})).toEqual({status:'needs_query',items:[]});expect(await searchMaterialCandidates('椅\n子',{load})).toEqual({status:'invalid',items:[]});expect(await searchMaterialCandidates('椅',{load,limit:11})).toEqual({status:'invalid',items:[]});expect(load).not.toHaveBeenCalled();
 });
 it('reports a loading failure without exposing the exception, and retries on the next call',async()=>{
  const index=await loadOnlineModels();const load=vi.fn().mockRejectedValueOnce(Error('private detail')).mockResolvedValueOnce(index);
  expect(await searchMaterialCandidates('椅子',{load})).toEqual({status:'unavailable',items:[]});const retried=await searchMaterialCandidates('椅子',{load});expect(retried.status).toBe('ok');expect(load).toHaveBeenCalledTimes(2);
 });
});
