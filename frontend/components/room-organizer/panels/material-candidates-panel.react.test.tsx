// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import * as candidates from '../lib/material-candidates';
import {MaterialCandidatesPanel} from './material-candidates-panel';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
const success=(query:string,name:string):candidates.MaterialCandidateResult=>({status:'ok',query,total:1,items:[{slug:`id-${name}`,name,dimensions:{width:1,depth:2,height:3}}]});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}

describe('物料候选',()=>{
 it('shows real catalogue chair options and opens the library with the query, without selecting an item',async()=>{
  const open=vi.fn();render(<MaterialCandidatesPanel query="椅子" onOpenLibrary={open}/>);
  const section=screen.getByRole('region',{name:'物料候选'});expect(within(section).getByText(/实物规格、库存和价格还需核实/)).toBeTruthy();
  expect(await within(section).findByText(/软包餐椅/)).toBeTruthy();expect(within(section).getAllByText(/米（宽 × 深 × 高）/).length).toBeGreaterThan(1);
  expect(open).not.toHaveBeenCalled();fireEvent.click(within(section).getByRole('button',{name:'打开物料库'}));expect(open).toHaveBeenCalledExactlyOnceWith('椅子');
 });
 it('shows empty and missing queries without inventing alternatives',async()=>{
  const open=vi.fn(),view=render(<MaterialCandidatesPanel query="" onOpenLibrary={open}/>);expect(screen.getByText('先告诉我想找什么物料。')).toBeTruthy();
  view.rerender(<MaterialCandidatesPanel query="不存在的星际椅99999" onOpenLibrary={open}/>);expect(await screen.findByText(/没有找到/)).toBeTruthy();expect(screen.queryByRole('list')).toBeNull();
 });
 it('allows a real retry after a loading failure',async()=>{
  const actual=candidates.searchMaterialCandidates;const spy=vi.spyOn(candidates,'searchMaterialCandidates').mockResolvedValueOnce({status:'unavailable',items:[]}).mockImplementation(actual);
  render(<MaterialCandidatesPanel query="餐椅" onOpenLibrary={vi.fn()}/>);expect((await screen.findByRole('alert')).textContent).toContain('暂时无法读取物料');
  fireEvent.click(screen.getByRole('button',{name:'重试'}));expect(await screen.findByText(/软包餐椅/)).toBeTruthy();expect(spy).toHaveBeenCalledTimes(2);
 });
 it('ignores an earlier query response after a new query resolves',async()=>{
  const a=deferred<candidates.MaterialCandidateResult>(),b=deferred<candidates.MaterialCandidateResult>();
  vi.spyOn(candidates,'searchMaterialCandidates').mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const view=render(<MaterialCandidatesPanel query="椅" onOpenLibrary={vi.fn()}/>);view.rerender(<MaterialCandidatesPanel query="桌" onOpenLibrary={vi.fn()}/>);
  await act(async()=>b.resolve(success('桌','新桌')));expect(screen.getByText('新桌')).toBeTruthy();
  await act(async()=>a.resolve(success('椅','旧椅')));expect(screen.queryByText('旧椅')).toBeNull();expect(screen.getByText('新桌')).toBeTruthy();
 });
 it('does not render or update after unmount while a request finishes',async()=>{
  const pending=deferred<candidates.MaterialCandidateResult>();vi.spyOn(candidates,'searchMaterialCandidates').mockReturnValue(pending.promise);
  const view=render(<MaterialCandidatesPanel query="椅" onOpenLibrary={vi.fn()}/>);view.unmount();await act(async()=>pending.resolve(success('椅','迟到物料')));
  await waitFor(()=>expect(screen.queryByText('迟到物料')).toBeNull());
 });
});
