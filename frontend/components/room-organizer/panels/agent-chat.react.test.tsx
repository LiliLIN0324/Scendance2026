// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { AgentChat } from './agent-chat';

function editor(): RoomEditorContextValue {
  return {
    layout: INITIAL_LAYOUT,
    activeFloor: INITIAL_LAYOUT.floors[0]!,
    activeFloorIndex: 0,
    actions: {},
    history: { commitNow: vi.fn() },
    playCue: vi.fn(),
    pushColor: vi.fn(),
  } as unknown as RoomEditorContextValue;
}

function renderChat(agent: 'space' | 'material', onNewSpace?: (mode?: 'blank' | 'template') => void, onForwardToActivity?: (text:string)=>boolean|Promise<boolean>): void {
  const chat = <AgentChat agent={agent} onNewSpace={onNewSpace} onForwardToActivity={onForwardToActivity}/>;
  render(<RoomEditorProvider value={editor()}>
    {chat}
  </RoomEditorProvider>);
}

afterEach(cleanup);

describe('AgentChat composer entry points', () => {
  it.each(['space','material'] as const)('forwards an unhandled %s request once and clears only on acceptance',async agent=>{
    const forward=vi.fn(()=>true);renderChat(agent,undefined,forward);
    const input=screen.getByRole('textbox',{name:agent==='space'?'空间输入框':'物料输入框'}) as HTMLTextAreaElement;
    fireEvent.change(input,{target:{value:'帮我规划一场社区活动'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
    expect(forward).toHaveBeenCalledExactlyOnceWith('帮我规划一场社区活动');await waitFor(()=>expect(input.value).toBe(''));
  });
  it('keeps the input when the activity conversation rejects the transfer',async()=>{
    const forward=vi.fn(()=>false);renderChat('material',undefined,forward);
    const input=screen.getByRole('textbox',{name:'物料输入框'}) as HTMLTextAreaElement;
    fireEvent.change(input,{target:{value:'帮我选择椅子'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
    expect(forward).toHaveBeenCalledExactlyOnceWith('帮我选择椅子');expect(input.value).toBe('帮我选择椅子');
    await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('暂时无法转交'));
  });
  it('keeps text and prevents duplicate sends while waiting, including after rejection',async()=>{
    let fail!:(error:Error)=>void;const forward=vi.fn(()=>new Promise<boolean>((_resolve,reject)=>{fail=reject;}));renderChat('material',undefined,forward);
    const input=screen.getByRole('textbox',{name:'物料输入框'}) as HTMLTextAreaElement;
    fireEvent.change(input,{target:{value:'帮我选择椅子'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
    expect(screen.getByRole('status').textContent).toContain('正在转交');expect((screen.getByRole('button',{name:'发送'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(input.closest('form')!);expect(forward).toHaveBeenCalledOnce();expect(input.value).toBe('帮我选择椅子');
    await act(async()=>{fail(new Error('unavailable'));});expect(input.value).toBe('帮我选择椅子');expect(screen.getByRole('status').textContent).toContain('暂时无法转交');
  });
  it('keeps unaccepted input in its own page-memory scope across activity changes',()=>{
    const renderScoped=(scope:string)=><RoomEditorProvider value={editor()}><AgentChat key={scope} agent="material" draftScope={scope}/></RoomEditorProvider>;
    const {rerender}=render(renderScoped('input-test-a'));
    fireEvent.change(screen.getByRole('textbox',{name:'物料输入框'}),{target:{value:'旧活动中的椅子'}});
    rerender(renderScoped('input-test-b'));expect((screen.getByRole('textbox',{name:'物料输入框'}) as HTMLTextAreaElement).value).toBe('');
    rerender(renderScoped('input-test-a'));expect((screen.getByRole('textbox',{name:'物料输入框'}) as HTMLTextAreaElement).value).toBe('旧活动中的椅子');
  });
  it('preserves a pending message in its original scope when the activity switches and transfer fails',async()=>{
    let fail!:(error:Error)=>void;const forward=vi.fn(()=>new Promise<boolean>((_resolve,reject)=>{fail=reject;}));
    const renderScoped=(scope:string)=><RoomEditorProvider value={editor()}><AgentChat key={scope} agent="material" draftScope={scope} onForwardToActivity={forward}/></RoomEditorProvider>;
    const {rerender}=render(renderScoped('pending-test-a'));
    fireEvent.change(screen.getByRole('textbox',{name:'物料输入框'}),{target:{value:'原活动物料需求'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
    rerender(renderScoped('pending-test-b'));expect((screen.getByRole('textbox',{name:'物料输入框'}) as HTMLTextAreaElement).value).toBe('');
    await act(async()=>{fail(new Error('session changed'));});rerender(renderScoped('pending-test-a'));
    expect((screen.getByRole('textbox',{name:'物料输入框'}) as HTMLTextAreaElement).value).toBe('原活动物料需求');
  });
  it.each(['space', 'material'] as const)('keeps unhandled %s requests and tells the user where to continue', agent => {
    renderChat(agent);
    const input = screen.getByRole('textbox', { name: agent === 'space' ? '空间输入框' : '物料输入框' });
    fireEvent.change(input, { target: { value: '帮我规划一场社区活动' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect((input as HTMLTextAreaElement).value).toBe('帮我规划一场社区活动');
    expect(screen.getByRole('status').textContent).toContain('打开活动对话继续');
  });
  it('puts 生成物料 in the bottom-left of the material chat', () => {
    renderChat('material');
    const generate = screen.getByRole('button', { name: '生成物料' });
    expect(document.querySelector('.ap-composer-left')?.contains(generate)).toBe(true);
    fireEvent.click(generate);
    const menu = screen.getByRole('menu', { name: '生成物料' });
    expect([...menu.querySelectorAll('button')].map(button => button.textContent)).toEqual(['通过描述生成物料', '拍照/图片生成物料']);
  });

  it('keeps the space chat on its own plus menu without a generate button', () => {
    const onNewSpace = vi.fn();
    renderChat('space', onNewSpace);
    expect(screen.queryByRole('button', { name: '生成物料' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '新建空白空间' }));
    expect(onNewSpace).toHaveBeenCalledWith('blank');
  });
  it('retains the explicit space-reconstruction shortcut but forwards a negation',async()=>{
    const open=vi.fn(),forward=vi.fn(()=>true);
    render(<RoomEditorProvider value={editor()}><AgentChat agent="space" onOpenAholo={open} onForwardToActivity={forward}/></RoomEditorProvider>);
    const input=screen.getByRole('textbox',{name:'空间输入框'});
    fireEvent.change(input,{target:{value:'请重建场地'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
    expect(open).toHaveBeenCalledExactlyOnceWith('recon',undefined);expect(forward).not.toHaveBeenCalled();
    fireEvent.change(input,{target:{value:'不要重建真实场地'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
    await waitFor(()=>expect(forward).toHaveBeenCalledExactlyOnceWith('不要重建真实场地'));
    expect(open).toHaveBeenCalledOnce();
  });
});
