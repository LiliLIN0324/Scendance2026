import {describe,expect,it} from 'vitest';
import {bindPendingCandidateRegistry,createPendingCandidateRegistry} from './pending-candidate-registry';

describe('pending candidate registry',()=>{
 it('keeps independent local and cloud owners and a hidden candidate stays pending',()=>{
  const registry=createPendingCandidateRegistry(),scope=registry.setScope({})!,local={},cloud={};
  expect(registry.register(scope,'local',local)).toBe(true);
  expect(registry.register(scope,'cloud',cloud)).toBe(true);
  expect(registry.retain(scope,'local',local)).toBe(true);
  expect(registry.capture(scope)).toMatchObject({hasPending:true,local:true,cloud:true});
  expect(registry.clear(scope,'cloud',cloud)).toBe(true);
  expect(registry.capture(scope)).toMatchObject({hasPending:true,local:true,cloud:false});
 });
 it('invalidates captures on register, replace and clear, even when tokens repeat',()=>{
  const registry=createPendingCandidateRegistry(),scope=registry.setScope({})!,owner={};
  const empty=registry.capture(scope)!;expect(empty.hasPending).toBe(false);
  registry.register(scope,'local',owner);expect(empty.isCurrent()).toBe(false);
  const first=registry.capture(scope)!;registry.register(scope,'local',owner);expect(first.isCurrent()).toBe(false);
  const replacement=registry.capture(scope)!;registry.clear(scope,'local',owner);expect(replacement.isCurrent()).toBe(false);
 });
 it('does not let stale cleanup clear another owner or source',()=>{
  const registry=createPendingCandidateRegistry(),scope=registry.setScope({})!,old={},next={},cloud={};
  registry.register(scope,'local',old);registry.register(scope,'local',next);registry.register(scope,'cloud',cloud);
  const current=registry.capture(scope)!;expect(registry.clear(scope,'local',old)).toBe(false);
  expect(current.isCurrent()).toBe(true);expect(registry.capture(scope)).toMatchObject({local:true,cloud:true});
 });
 it('invalidates a capture across authority A→B→A without forgetting retained candidates',()=>{
  const registry=createPendingCandidateRegistry(),scope=registry.setScope({})!,local={},cloud={};
  registry.register(scope,'local',local);registry.register(scope,'cloud',cloud);
  const before=registry.capture(scope)!;
  expect(registry.invalidate(scope)).toBe(true);expect(registry.invalidate(scope)).toBe(true);
  expect(before.isCurrent()).toBe(false);
  expect(registry.retain(scope,'local',local)).toBe(true);
  expect(registry.retain(scope,'cloud',cloud)).toBe(true);
  expect(registry.capture(scope)).toMatchObject({local:true,cloud:true,hasPending:true});
  expect(registry.clear(scope,'local',{})).toBe(false);
  expect(registry.clear(scope,'local',local)).toBe(true);
  expect(registry.capture(scope)).toMatchObject({local:false,cloud:true,hasPending:true});
 });
 it('prevents scope ABA from reviving an earlier capture or stale cleanup',()=>{
  const registry=createPendingCandidateRegistry(),a={},b={},owner={},replacement={};const firstScope=registry.setScope(a)!;
  registry.register(firstScope,'local',owner);const first=registry.capture(firstScope)!;
  registry.setScope(b);expect(first.isCurrent()).toBe(false);expect(registry.capture(firstScope)).toBeNull();
  const nextScope=registry.setScope(a)!;registry.register(nextScope,'local',replacement);
  expect(first.isCurrent()).toBe(false);expect(registry.clear(firstScope,'local',owner)).toBe(false);
  expect(registry.register(firstScope,'local',owner)).toBe(false);
  expect(registry.capture(nextScope)).toMatchObject({hasPending:true,local:true});
 });
 it('does not let stale activity closures reset a newer active scope',()=>{
  const registry=createPendingCandidateRegistry(),a={},b={},old={},fresh={};let current=a;
  const accessA=bindPendingCandidateRegistry(registry,a,()=>current===a),accessB=bindPendingCandidateRegistry(registry,b,()=>current===b);
  expect(accessA.register('local',old)).toBe(true);const capture=accessA.capture()!;
  current=b;expect(capture.isCurrent()).toBe(false);expect(accessB.register('cloud',fresh)).toBe(true);
  expect(accessA.clear('local',old)).toBe(false);expect(accessA.capture()).toBeNull();
  expect(accessB.capture()).toMatchObject({local:false,cloud:true});
 });
 it('rejects inactive scope changes and invalidates captures on scope removal',()=>{
  const registry=createPendingCandidateRegistry(),a=registry.setScope({})!,b={},owner={};
  const before=registry.capture(a)!;expect(registry.register(b,'cloud',owner)).toBe(false);
  expect(registry.clear(b,'cloud',owner)).toBe(false);expect(before.isCurrent()).toBe(true);
  registry.setScope(null);expect(before.isCurrent()).toBe(false);expect(registry.capture(a)).toBeNull();
 });
 it('fails closed on invalid runtime tokens and kinds',()=>{
  const registry=createPendingCandidateRegistry();
  expect(registry.register(null as never,'local',{})).toBe(false);
  const scope=registry.setScope({})!;
  expect(registry.register(scope,'__proto__' as never,{})).toBe(false);
  expect(registry.register(scope,'local',null as never)).toBe(false);
  expect(registry.capture(null as never)).toBeNull();
  expect(()=>registry.setScope('invalid' as never)).toThrow();
 });
});
