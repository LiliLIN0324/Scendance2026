import {describe,expect,it} from 'vitest';
import {projectSessionScope} from './project-session-scope';
import {DEFAULT_OUTDOOR_PROJECT_ID} from './outdoor-project-store';

describe('项目会话身份键',()=>{
 it('云项目用 project 前缀 + 项目 id',()=>{
  expect(projectSessionScope('abc-123')).toBe('project:abc-123');
 });
 it('忽略首尾空白',()=>{
  expect(projectSessionScope('  abc-123  ')).toBe('project:abc-123');
 });
 it('null / 空串 / 空白回退默认草稿槽',()=>{
  expect(projectSessionScope(null)).toBe(`project:${DEFAULT_OUTDOOR_PROJECT_ID}`);
  expect(projectSessionScope('')).toBe(`project:${DEFAULT_OUTDOOR_PROJECT_ID}`);
  expect(projectSessionScope('   ')).toBe(`project:${DEFAULT_OUTDOOR_PROJECT_ID}`);
 });
 it('不携带室内 layout.id 概念',()=>{
  expect(projectSessionScope('x')).not.toContain('activity:');
  expect(projectSessionScope(undefined)).not.toContain('unidentified');
 });
});
