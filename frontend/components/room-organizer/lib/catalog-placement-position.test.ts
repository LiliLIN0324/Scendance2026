import {describe,expect,it} from 'vitest';
import {makeCatalogItem,makeFloor,makeItem,makeLayout} from './__testfixtures__/fixtures';
import {resolveCatalogPosition} from './catalog-placement-position';

describe('catalog positioning against the current scene',()=>{
 it('searches nearby when the centre is occupied and keeps consecutive placements separate',()=>{
  const original=makeLayout({floors:[makeFloor({items:[makeItem({id:'existing'})]})]}),item=makeCatalogItem();
  const first=resolveCatalogPosition(original,0,item,'trial-1');expect(first.ok,JSON.stringify(first)).toBe(true);if(!first.ok)return;
  expect(first.position).not.toEqual({x:0,z:0});
  const next=structuredClone(original);next.floors[0]!.items.push(makeItem({id:'first',position:first.position}));
  const second=resolveCatalogPosition(next,0,item,'trial-2');expect(second.ok).toBe(true);if(!second.ok)return;
  expect(second.position).not.toEqual(first.position);
  expect(original.floors[0]!.items).toHaveLength(1);
 });
 it('rejects an occupied explicit point without moving it to a nearby position',()=>{
  const layout=makeLayout({floors:[makeFloor({items:[makeItem({id:'existing'})]})]});
  const result=resolveCatalogPosition(layout,0,makeCatalogItem(),'trial',{x:0,z:0});
  expect(result.ok).toBe(false);if(result.ok)return;expect(result.item.position).toEqual({x:0,z:0});
 });
 it('reports only a local search failure when a large obstacle covers the search',()=>{
  const layout=makeLayout({width:8,height:8,floors:[makeFloor({items:[makeItem({width:7,depth:7})]})]});
  const result=resolveCatalogPosition(layout,0,makeCatalogItem(),'trial');
  expect(result).toMatchObject({ok:false,code:'NO_NEARBY_POSITION'});
  if(!result.ok)expect(result.reason).toContain('附近');
 });
});
