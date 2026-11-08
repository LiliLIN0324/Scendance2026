// @vitest-environment jsdom
import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {resetAssistantSessionsStoreForTests,scopedAssistantStorage,subscribeActiveAssistantSession,useAssistantSessions} from './use-assistant-sessions';

beforeEach(()=>{localStorage.clear();resetAssistantSessionsStoreForTests();});
afterEach(()=>{cleanup();resetAssistantSessionsStoreForTests();localStorage.clear();});
describe('active conversation subscription',()=>{
 it('observes an away-and-back change in the same React batch without conflating scopes',()=>{
  const scope='activity:queue-test',other='activity:other';
  const hook=renderHook(()=>useAssistantSessions(()=>{},scope));const first=hook.result.current.activeId;
  expect(first).toBeTruthy();const seen:Array<string|null>=[],otherSeen:Array<string|null>=[];
  const off=subscribeActiveAssistantSession(scope,id=>seen.push(id));const offOther=subscribeActiveAssistantSession(other,id=>otherSeen.push(id));
  act(()=>{hook.result.current.openSession();hook.result.current.selectSession(first!);});
  expect(seen).toHaveLength(2);expect(seen[0]).not.toBe(first);expect(seen[1]).toBe(first);expect(otherSeen).toEqual([]);
  off();offOther();
 });
 it('proves a user-created session only after independent index and history readback',()=>{
  const hook=renderHook(()=>useAssistantSessions(()=>{},'activity:fresh'));
  let created:ReturnType<typeof hook.result.current.openSession>=null;
  act(()=>{created=hook.result.current.openSession();});
  expect(created).toMatchObject({id:expect.any(String),verifiedFresh:true});
  expect(hook.result.current.activeId).toBe(created!.id);
 });
 it('does not treat malformed stored history as proof of a new session',()=>{
  const scope='activity:broken',hook=renderHook(()=>useAssistantSessions(()=>{},scope));
  scopedAssistantStorage(scope)!.setItem('scendance.assistant-session-bodies.v1','{broken');
  let created:ReturnType<typeof hook.result.current.openSession>=null;
  act(()=>{created=hook.result.current.openSession();});
  expect(created).toMatchObject({id:expect.any(String),verifiedFresh:false});
 });
 it('does not grant a fresh-session proof when the index write is blocked',()=>{
  const hook=renderHook(()=>useAssistantSessions(()=>{throw new Error('locked');},'activity:locked'));
  let created:ReturnType<typeof hook.result.current.openSession>=null;
  act(()=>{created=hook.result.current.openSession();});
  expect(created).toMatchObject({id:expect.any(String),verifiedFresh:false});
 });
 it('does not grant a fresh-session proof when stored requirement memory is malformed',()=>{
  const scope='activity:broken-brief',hook=renderHook(()=>useAssistantSessions(()=>{},scope));
  scopedAssistantStorage(scope)!.setItem('scendance.assistant-brief-memory.v1','{broken');
  let created:ReturnType<typeof hook.result.current.openSession>=null;
  act(()=>{created=hook.result.current.openSession();});
  expect(created).toMatchObject({id:expect.any(String),verifiedFresh:false});
 });
});
