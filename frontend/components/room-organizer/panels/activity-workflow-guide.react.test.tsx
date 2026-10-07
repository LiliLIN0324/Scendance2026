// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { INITIAL_BRIEF, MANUAL_BRIEF_TEMPLATE } from '../lib/creative-brief';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { createOperation } from '../lib/event-operations';
import { ActivityWorkflowGuide } from './activity-workflow-guide';

afterEach(cleanup);
const empty={brief:INITIAL_BRIEF,ready:true,error:null,hasSavedBrief:false};

it('starts with the brief, marks the sample, and uses a decorative generated icon',()=>{
  const open=vi.fn();const view=render(<ActivityWorkflowGuide layout={INITIAL_LAYOUT} briefState={empty} onOpenBrief={open}/>);
  expect(screen.getByText('活动简报 → 场地与物料 → 分工排期 → 验收交接')).toBeTruthy();
  expect(screen.getByText(/示例布置，尺寸待核对/)).toBeTruthy();
  expect(screen.queryByText(/24 人|10.*8.*已确认/)).toBeNull();
  const image=view.container.querySelector('img')!;
  expect(image.alt).toBe('');expect(image.width).toBe(60);expect(image.getAttribute('decoding')).toBe('async');
  fireEvent.click(screen.getByRole('button',{name:'先填写活动简报'}));expect(open).toHaveBeenCalledOnce();
});

it.each([null,'读取被拒绝'])('keeps loading or errors distinct from an empty brief (error=%s)',error=>{
  render(<ActivityWorkflowGuide layout={INITIAL_LAYOUT} briefState={{...empty,ready:false,error}} onOpenBrief={vi.fn()}/>);
  expect(screen.queryByRole('button',{name:'先填写活动简报'})).toBeNull();
  expect(screen.getByText(error?/简报读取或保存遇到问题/:/正在读取简报/)).toBeTruthy();
  if(!error)expect(screen.getByRole('button',{name:'等待简报读取'}).hasAttribute('disabled')).toBe(true);
});

it('labels rehearsal and template text as records without claiming a completed activity',()=>{
  const task={...createOperation('验收演练','event'),ownerName:'演练负责人',status:'accepted' as const,evidenceNote:'演练核对说明',acceptance:'演练要求'};
  const current={...INITIAL_LAYOUT,eventOperations:{schemaVersion:1 as const,dataKind:'rehearsal' as const,tasks:[task]}};
  render(<ActivityWorkflowGuide layout={current} briefState={{...empty,brief:{...INITIAL_BRIEF,description:MANUAL_BRIEF_TEMPLATE},hasSavedBrief:true}} onOpenBrief={vi.fn()}/>);
  expect(screen.getByText(/演练记录.*简报含待填写提纲.*1 条分工记录/)).toBeTruthy();
  expect(screen.getByText(/1 条含核对说明或证据/)).toBeTruthy();
  expect(screen.queryByText(/目标已确认|活动已完成|当前阶段|正在执行/)).toBeNull();
  expect(screen.getByRole('button',{name:'核对活动简报'})).toBeTruthy();
});
