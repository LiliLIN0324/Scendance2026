// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {makeFloor,makeItem,makeLayout} from '../lib/__testfixtures__/fixtures';
import {CandidateInventoryPanel} from './candidate-inventory-panel';

afterEach(cleanup);
function candidate(count:number,width=.5){
 return makeLayout({floors:[makeFloor({items:Array.from({length:count},(_,index)=>makeItem({id:`chair-${index}`,type:'chair',name:'示意椅',width,depth:.5,height:.8,position:{x:index,z:0}}))})]});
}

describe('候选物料数量核对',()=>{
 it('根据是否支持会话继承说明数量暂存范围',()=>{
  const {rerender}=render(<CandidateInventoryPanel candidate={candidate(1)} scope="s" onChange={vi.fn()}/>);
  expect(screen.getByText(/仅对这次预览暂存/)).toBeTruthy();
  rerender(<CandidateInventoryPanel candidate={candidate(1)} scope="s" sessionMemory onChange={vi.fn()}/>);
  expect(screen.getByText(/同一对话中仅临时记住有明确资产编号/)).toBeTruthy();
 });
 it('同一候选面板重新挂载时保留已填写数量，不把已知不足静默重置为未知',()=>{
  const onChange=vi.fn(),layout=candidate(2),first=render(<CandidateInventoryPanel candidate={layout} scope="activity-1" onChange={onChange}/>);
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'0'}});
  const remembered=onChange.mock.lastCall?.[0];first.unmount();
  render(<CandidateInventoryPanel candidate={layout} scope="activity-1" initialInventory={remembered} onChange={onChange}/>);
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('0');
  expect(onChange.mock.lastCall?.[1].status).toBe('violated');
 });
 it('非法输入在面板重新挂载后仍然保留，直到用户明确清空或更正',()=>{
  const onChange=vi.fn(),layout=candidate(2),first=render(<CandidateInventoryPanel candidate={layout} scope="activity-1" onChange={onChange}/>);
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'-1'}});
  const remembered=onChange.mock.lastCall?.[0];expect(remembered.invalidInput).toBe(true);first.unmount();
  render(<CandidateInventoryPanel candidate={layout} scope="activity-1" initialInventory={remembered} onChange={onChange}/>);
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('-1');
  expect(onChange.mock.lastCall?.[0].invalidInput).toBe(true);
  fireEvent.change(screen.getByRole('textbox'),{target:{value:''}});
  expect(onChange.mock.lastCall?.[0]).toBeUndefined();
 });
 it('无效标记缺失原文时保守要求重新输入',()=>{
  const onChange=vi.fn();render(<CandidateInventoryPanel candidate={candidate(1)} scope="activity-1" initialInventory={{origin:'user_reported',entries:[],invalidInput:true}} onChange={onChange}/>);
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('?');
  expect(onChange.mock.lastCall?.[0].invalidInput).toBe(true);
 });
 it('只根据手动填写的当前规格总数报告缺口，不把模型当实物库存',()=>{
  const onChange=vi.fn();render(<CandidateInventoryPanel candidate={candidate(3)} scope="activity-1" onChange={onChange}/>);
  expect(screen.getByRole('status').textContent).toContain('未提供库存');
  const input=screen.getByRole('textbox');expect((input as HTMLInputElement).value).toBe('');
  fireEvent.change(input,{target:{value:'2'}});
  expect(screen.getByRole('status').textContent).toContain('缺 1 件示意椅');
  expect(onChange.mock.lastCall?.[0]).toMatchObject({origin:'user_reported',entries:[{available:2,identity:{kind:'type',value:'chair'}}]});
  expect(onChange.mock.lastCall?.[1]).toMatchObject({status:'violated',shortages:[{required:3,available:2,missing:1}]});
  fireEvent.change(input,{target:{value:'3'}});
  expect(screen.getByRole('status').textContent).toContain('不代表实物可用或现场条件已核验');
  expect(onChange.mock.lastCall?.[1].status).toBe('pass');
 });
 it('清空或无效数字保持未知，而不是当成零',()=>{
  const onChange=vi.fn();render(<CandidateInventoryPanel candidate={candidate(1)} scope="activity-1" onChange={onChange}/>);
  const input=screen.getByRole('textbox');
  fireEvent.change(input,{target:{value:'x'}});
  expect(screen.getByRole('alert').textContent).toContain('暂按未知处理');
  expect(onChange.mock.lastCall?.[0]).toMatchObject({invalidInput:true});expect(onChange.mock.lastCall?.[1].status).toBe('unknown');
  fireEvent.change(input,{target:{value:'0'}});expect(onChange.mock.lastCall?.[1].status).toBe('violated');
  fireEvent.change(input,{target:{value:''}});expect(onChange.mock.lastCall?.[1].status).toBe('unknown');
 });
 it('候选规格或项目作用域变化时立即清空并通知调用方失效',()=>{
  const onChange=vi.fn(),initial=candidate(1);
  const {rerender}=render(<CandidateInventoryPanel candidate={initial} scope="activity-1" onChange={onChange}/>);
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'10'}});
  rerender(<CandidateInventoryPanel candidate={candidate(1,.6)} scope="activity-1" onChange={onChange}/>);
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
  expect(onChange.mock.lastCall?.[0]).toBeUndefined();expect(onChange.mock.lastCall?.[1].status).toBe('unknown');
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'10'}});
  rerender(<CandidateInventoryPanel candidate={candidate(1,.6)} scope="activity-2" onChange={onChange}/>);
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
  expect(onChange.mock.lastCall?.[0]).toBeUndefined();expect(onChange.mock.lastCall?.[1].status).toBe('unknown');
 });
 it('没有明确资产 ID 的生成模型不出现可误认成实物的填写项',()=>{
  const layout=candidate(1);layout.floors[0]!.items[0]!.source='generated';
  const onChange=vi.fn();render(<CandidateInventoryPanel candidate={layout} scope="activity-1" onChange={onChange}/>);
  expect(screen.queryByRole('textbox')).toBeNull();expect(onChange.mock.lastCall?.[1].status).toBe('unknown');
 });
});
