import { describe, expect, it } from 'vitest';
import { groupBillOfMaterials, type BomObject } from '../supabase/functions/_shared/bom.ts';

type TestObject = BomObject & { flag?: string };
const object = (id: string, overrides: Partial<TestObject> = {}): TestObject => ({
  id, materialId: 'chair', size: { width: .5, depth: .5, height: .85 }, color: '#ffffff', notes: '', ...overrides,
});
const name = () => '椅子';

describe('shared bill-of-materials grouping',()=>{
  it('groups identical specification, color and notes and splits every real difference',()=>{
    const rows=groupBillOfMaterials([
      object('a'),object('b'),
      object('c',{color:'#ff0000'}),
      object('d',{notes:'贵宾席'}),
      object('e',{size:{width:1,depth:.5,height:.85}}),
    ],{name});
    expect(rows.map(row=>row.quantity)).toEqual([2,1,1,1]);
    expect(rows[0]!.objectIds).toEqual(['a','b']);
  });
  it('normalizes asset UUID casing without changing the original reference',()=>{
    const lower='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const rows=groupBillOfMaterials([
      object('a',{materialId:'asset',assetId:lower}),
      object('b',{materialId:'asset',assetId:lower.toUpperCase()}),
    ],{name,assetKey:assetId=>assetId.toLowerCase()});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({quantity:2,assetId:lower,assetKey:lower});
  });
  it('keeps distinct preset nodes apart even when their measurements match',()=>{
    const rows=groupBillOfMaterials([
      object('a',{materialId:'asset',presetNode:1}),
      object('b',{materialId:'asset',presetNode:2}),
    ],{name});
    expect(rows).toHaveLength(2);
    expect(rows.map(row=>row.presetNode)).toEqual([1,2]);
  });
  it('separates the same geometry by material source',()=>{
    const rows=groupBillOfMaterials([object('a'),object('b',{flag:'generated'})],{
      name,source:item=>item.flag??null,
    });
    expect(rows.map(row=>[row.source,row.quantity])).toEqual([[null,1],['generated',1]]);
  });
  it('keeps first-occurrence order and reports every instance id',()=>{
    const rows=groupBillOfMaterials([object('b'),object('a'),object('c')],{name});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.objectIds).toEqual(['b','a','c']);
  });
});
