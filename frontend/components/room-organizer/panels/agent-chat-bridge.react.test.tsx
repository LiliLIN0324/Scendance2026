// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {AgentChatBridge} from './agent-chat-bridge';
import type {BackendSession} from '@/lib/backend-session';

const mock=vi.hoisted(()=>({current:true,understanding:false,allowed:true,mode:'layout',session:'conversation-a' as string|null,
  snapshot:{user:{id:'user-a'},sessionId:'session-a'},listeners:new Set<()=>void>(),send:vi.fn(),forwarded:undefined as boolean|undefined,controller:undefined as unknown}));
vi.mock('./agent-panel',()=>({useAgent:()=>({
  sessionScope:'activity:a',isSessionCurrent:()=>mock.current,isUnderstanding:()=>mock.understanding,canForward:()=>mock.allowed,
  callbacks:{workbenchMode:mock.mode},send:mock.send,
})}));
vi.mock('../hooks/use-assistant-sessions',()=>({getActiveAssistantSessionId:()=>mock.session}));
vi.mock('./agent-chat',()=>({AgentChat:({onForwardToActivity,controller}:{onForwardToActivity:(text:string)=>Promise<boolean>;controller?:unknown})=>{mock.controller=controller;return <button onClick={()=>{void onForwardToActivity('帮我规划活动').then(value=>{mock.forwarded=value;});}}>转交</button>;}}));
const controller={config:{apiUrl:'https://fixture.invalid'},getSnapshot:()=>mock.snapshot,
  subscribe:(listener:()=>void)=>{mock.listeners.add(listener);return()=>mock.listeners.delete(listener);}} as unknown as BackendSession;
beforeEach(()=>{mock.current=true;mock.understanding=false;mock.allowed=true;mock.mode='layout';mock.session='conversation-a';mock.snapshot={user:{id:'user-a'},sessionId:'session-a'};mock.forwarded=undefined;mock.send.mockReset();mock.listeners.clear();});
afterEach(cleanup);

describe('activity conversation bridge',()=>{
  it('waits for the activity send to finish before opening the activity view',async()=>{
    let finish!:()=>void;mock.send.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const open=vi.fn();render(<AgentChatBridge controller={controller} agent="material" onOpenActivity={open}/>);
    fireEvent.click(screen.getByRole('button',{name:'转交'}));
    expect(mock.controller).toBe(controller);
    expect(mock.send).toHaveBeenCalledExactlyOnceWith('帮我规划活动');expect(open).not.toHaveBeenCalled();
    await act(async()=>{finish();});await waitFor(()=>expect(mock.forwarded).toBe(true));expect(open).toHaveBeenCalledOnce();
  });
  it('does not navigate when the asynchronous activity send rejects',async()=>{
    mock.send.mockRejectedValue(new Error('failed'));const open=vi.fn();render(<AgentChatBridge controller={controller} agent="space" onOpenActivity={open}/>);
    fireEvent.click(screen.getByRole('button',{name:'转交'}));await waitFor(()=>expect(mock.forwarded).toBe(false));expect(open).not.toHaveBeenCalled();
  });
  it.each(['stale','duplicate','uncertain','different-mode'])('refuses %s rather than lose input',async caseName=>{
    if(caseName==='stale')mock.current=false;
    if(caseName==='duplicate')mock.understanding=true;
    if(caseName==='uncertain')mock.allowed=false;
    if(caseName==='different-mode')mock.mode='other';
    const open=vi.fn();render(<AgentChatBridge controller={controller} agent="space" onOpenActivity={open}/>);
    fireEvent.click(screen.getByRole('button',{name:'转交'}));await waitFor(()=>expect(mock.forwarded).toBe(false));
    expect(mock.send).not.toHaveBeenCalled();expect(open).not.toHaveBeenCalled();
  });
  it('does not navigate after the account changes and then changes back during a send',async()=>{
    let finish!:()=>void;mock.send.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));const open=vi.fn();
    render(<AgentChatBridge controller={controller} agent="space" onOpenActivity={open}/>);fireEvent.click(screen.getByRole('button',{name:'转交'}));
    act(()=>{mock.snapshot={...mock.snapshot,user:{id:'user-b'}};mock.listeners.forEach(listener=>listener());mock.snapshot={...mock.snapshot,user:{id:'user-a'}};mock.listeners.forEach(listener=>listener());});
    await act(async()=>{finish();});await waitFor(()=>expect(mock.forwarded).toBe(false));expect(open).not.toHaveBeenCalled();
  });
  it('does not navigate when the original conversation changes during a send',async()=>{
    let finish!:()=>void;mock.send.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));const open=vi.fn();
    render(<AgentChatBridge controller={controller} agent="space" onOpenActivity={open}/>);fireEvent.click(screen.getByRole('button',{name:'转交'}));
    mock.session='conversation-b';await act(async()=>{finish();});await waitFor(()=>expect(mock.forwarded).toBe(false));expect(open).not.toHaveBeenCalled();
  });
});
