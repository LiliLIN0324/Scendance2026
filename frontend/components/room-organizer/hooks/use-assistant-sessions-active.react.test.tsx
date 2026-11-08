// @vitest-environment jsdom
import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {resetAssistantSessionsStoreForTests,subscribeActiveAssistantSession,useAssistantSessions} from './use-assistant-sessions';

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
});
