// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BingoScore } from '../../../lib/bingo-score';
import { BINGO_MARK_KEY, BINGO_RETURN_KEY } from '../lib/bingo-status';
import { __resetGenerationOutcome, setGenerationOutcome } from '../lib/use-generation-outcome';
import { BingoAuditCard } from './bingo-audit-card';
import {layoutStore} from '../hooks/use-layout-store';

const SHARE = '11111111-1111-4111-8111-111111111111';

const SCORE: BingoScore = {
  total: 88,
  breakdown: { spacing: 90, aisle: 80, bounds: 100, wall: 85 },
  itemCount: 12,
  passedCount: 10,
  failedCount: 2,
  fixedCount: 3,
  stuckCount: 1,
  summary: '发现 3 处堵点已自动挪开，1 处挪不动已标红（请手动调整）',
};

beforeEach(() => {
  localStorage.clear();
  __resetGenerationOutcome();
});
afterEach(() => {
  cleanup();
  __resetGenerationOutcome();
});

describe('BingoAuditCard', () => {
  it('renders nothing when no review was ever sent', () => {
    const { container } = render(<BingoAuditCard/>);
    expect(container.innerHTML).toBe('');
  });

  it('shows the plan, 待评 phase and pin count from the local review record', () => {
    localStorage.setItem(BINGO_MARK_KEY, JSON.stringify([{
      saved: true,
      status: 'needs-review',
      projectKey: 'local-draft',
      title: '发布会',
      shareId: SHARE,
      reviewPlanKey: SHARE,
      markedAt: '2026-10-31T00:00:00.000Z',
    }]));
    render(<BingoAuditCard/>);
    expect(screen.getByText('本机评审记录')).toBeTruthy();
    expect(screen.getByText(/对方的意见不会自动同步/)).toBeTruthy();
    expect(screen.getByText('记录 1')).toBeTruthy();
    expect(screen.getByText('发布会')).toBeTruthy();
    expect(screen.getByLabelText('打开评审页').getAttribute('href')).toBe(`/review/${SHARE}`);
  });
  it('does not offer copying or opening an old truncated review link',()=>{
    localStorage.setItem(BINGO_MARK_KEY,JSON.stringify([{saved:true,status:'needs-review',projectKey:'p',title:'旧记录',shareId:'p',markedAt:'2026-10-31T00:00:00.000Z',clientUrl:'https://example.test/review/#layout='+('a'.repeat(478)),reviewPlanKey:'link:old'}]));
    render(<BingoAuditCard/>);
    expect(screen.getByText(/原分享链接不完整，无法核验/)).toBeTruthy();
    expect(screen.queryByLabelText('复制甲方链接')).toBeNull();expect(screen.queryByLabelText('打开评审页')).toBeNull();
  });

  it('does not present a system score as customer review or safety approval',()=>{
    render(<BingoAuditCard score={SCORE}/>);
    expect(screen.getByText('系统体检结果')).toBeTruthy();
    expect(screen.queryByText('本机评审记录')).toBeNull();
    expect(screen.getByText(/现场净宽、出入口、消防和规范验收均未核验/)).toBeTruthy();
    expect(screen.getByText(/修改场景后请重新体检/)).toBeTruthy();
  });

  it('does not show a perfect score for an empty layout or unchecked exits',()=>{
    render(<BingoAuditCard score={{...SCORE,total:100,itemCount:0,failedCount:0,breakdown:{spacing:100,aisle:100,bounds:100,wall:100}}}/>);
    expect(screen.queryByText('100')).toBeNull();
    for(const label of ['椅子分布','画布中线附近','矩形画布边界','已建模内墙'])expect(screen.getByText(`${label}：待核验`)).toBeTruthy();
    expect(screen.getByText(/现场净宽、出入口、消防和规范验收均未核验/)).toBeTruthy();
  });

  it('corrects legacy removed entries and excludes structure markers from the card',()=>{
    setGenerationOutcome({placed:[{id:'chair'},{id:'door',structuralOpeningId:'opening'}],refused:[],skipped:[{item:{id:'old'},code:'REMOVED',reason:'旧候选未保留'}],
      report:{score:SCORE,suggestion:'体检 88 分，确认净宽够 1.2 m'}});
    render(<BingoAuditCard/>);
    expect(screen.getByText(/放了 1 件、移除 1 件/)).toBeTruthy();
    expect(screen.queryByText(/跳过 1 件/)).toBeNull();expect(screen.queryByText(/体检 88 分/)).toBeNull();
  });

  it('marks a real applied result historical after undo or any later revision',()=>{
    const current=layoutStore.getState();
    setGenerationOutcome({placed:[{id:'chair'}],removed:[{id:'old'}],refused:[],skipped:[],appliedLayout:structuredClone(current.layout),appliedRevision:current.revision,
      report:{score:SCORE,suggestion:'体检 100 分，通道净宽已通过 1.2 m'}});
    render(<BingoAuditCard/>);expect(screen.getByText('本次结果：')).toBeTruthy();
    expect(screen.getByText(/放了 1 件、移除 1 件/)).toBeTruthy();expect(screen.queryByText(/体检 100 分/)).toBeNull();
    act(()=>layoutStore.setState({layout:{...current.layout,name:'另一版'},revision:current.revision+1}));
    expect(screen.getByText(/历史操作结果/)).toBeTruthy();expect(screen.getByText('历史系统体检记录')).toBeTruthy();
    act(()=>layoutStore.setState({layout:current.layout,revision:current.revision+2}));
    expect(screen.getByText(/历史操作结果/)).toBeTruthy();
    act(()=>layoutStore.setState({layout:current.layout,revision:current.revision+3}));
  });

  it('distinguishes two saved shares of the same activity by local record and time', () => {
    localStorage.setItem(BINGO_MARK_KEY, JSON.stringify([
      { saved: true, status: 'needs-review', projectKey: 'house-a', title: '发布会', shareId: SHARE, markedAt: '2026-10-31T02:00:00.000Z' },
      { saved: true, status: 'needs-review', projectKey: 'house-a', title: '发布会', shareId: SHARE, markedAt: '2026-10-31T01:00:00.000Z' },
    ]));
    render(<BingoAuditCard/>);
    expect(screen.getByText('记录 1')).toBeTruthy();
    expect(screen.getByText('记录 2')).toBeTruthy();
    expect(screen.getAllByText(/分享于/)).toHaveLength(2);
  });

  it('clears the receipt from the audit card', () => {
    localStorage.setItem(BINGO_RETURN_KEY, JSON.stringify({
      version: 1, planKey: SHARE, at: '2026-10-31T02:00:00.000Z', href: `/review/${SHARE}`,
    }));
    render(<BingoAuditCard/>);
    expect(screen.getByText(/本机旧回执，未核对当前版本/)).toBeTruthy();
    expect(screen.queryByText('已回执')).toBeNull();
    fireEvent.click(screen.getByLabelText('清回执'));
    expect(localStorage.getItem(BINGO_RETURN_KEY)).toBeNull();
  });

  it('renders the generation outcome summary next to the receipt when present', () => {
    localStorage.setItem(BINGO_RETURN_KEY, JSON.stringify({
      version: 1, planKey: SHARE, at: '2026-10-31T02:00:00.000Z', href: `/review/${SHARE}`,
    }));
    setGenerationOutcome({
      placed: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      refused: [{ item: { id: 'd' }, reason: '越界', code: 'OUT_OF_BOUNDS' }],
      skipped: [
        { item: { id: 'e' }, reason: '锁着', code: 'LOCKED' },
        { item: { id: 'f' }, reason: '没落点', code: 'NO_SPOT' },
      ],
    });
    render(<BingoAuditCard/>);
    expect(screen.getByText(/历史操作结果/)).toBeTruthy();
    expect(screen.getByText(/放了 3 件/)).toBeTruthy();
    expect(screen.getByText(/被拒 1 件/)).toBeTruthy();
    expect(screen.getByText(/跳过 2 件/)).toBeTruthy();
  });

  it('hides the outcome line when no outcome was injected (placeholder)', () => {
    localStorage.setItem(BINGO_RETURN_KEY, JSON.stringify({
      version: 1, planKey: SHARE, at: '2026-10-31T02:00:00.000Z', href: `/review/${SHARE}`,
    }));
    render(<BingoAuditCard/>);
    expect(screen.queryByText('本次结果：')).toBeNull();
  });

  it('renders the体检分 / 完成卡 / 被拒件 from the outcome report (第 7 批收尾)', () => {
    localStorage.setItem(BINGO_RETURN_KEY, JSON.stringify({
      version: 1, planKey: SHARE, at: '2026-10-31T02:00:00.000Z', href: `/review/${SHARE}`,
    }));
    setGenerationOutcome({
      placed: [{ id: 'a' }, { id: 'b' }],
      refused: [{ item: { id: 'x' }, reason: '出界', code: 'OUT_OF_BOUNDS' }],
      skipped: [],
      report: {
        score: SCORE,
        reasoning: '按 120 m² 的场地摆了 2 件。',
        suggestion: '先处理 1 处标红（压通道或压墙），再交场。',
        durationMs: 1234,
      },
    });
    render(<BingoAuditCard/>);

    // 体检分分区
    expect(screen.getByTestId('bingo-score')).toBeTruthy();
    expect(screen.getByText(/几何检查：待核验/)).toBeTruthy();
    expect(screen.queryByText('88')).toBeNull();
    // 完成卡 Z8
    expect(screen.getByTestId('bingo-z8')).toBeTruthy();
    expect(screen.queryByText('按 120 m² 的场地摆了 2 件。')).toBeNull();
    expect(screen.getByText('后续建议')).toBeTruthy();
    expect(screen.getByText(/消防与无障碍要求需另行核验/)).toBeTruthy();
    // 耗时行标题写准：report 里的耗时只覆盖落盘段
    expect(screen.getByText('落盘耗时')).toBeTruthy();
    expect(screen.getByText('1.2s')).toBeTruthy();
    // 被拒件有人话，不给 code
    const refused = screen.getByTestId('bingo-refused');
    expect(screen.getByText('被拒件（1）')).toBeTruthy();
    expect(within(refused).getByText('出界')).toBeTruthy();
  });

  it('omits the思考轮数 row when the report carries no rounds', () => {
    localStorage.setItem(BINGO_RETURN_KEY, JSON.stringify({
      version: 1, planKey: SHARE, at: '2026-10-31T02:00:00.000Z', href: `/review/${SHARE}`,
    }));
    setGenerationOutcome({
      placed: [{ id: 'a' }],
      refused: [],
      skipped: [],
      report: { score: SCORE, durationMs: 300 },
    });
    render(<BingoAuditCard/>);
    expect(screen.queryByText('思考轮数')).toBeNull();
  });

  it('lets props win over the outcome report (调用方注入优先)', () => {
    localStorage.setItem(BINGO_RETURN_KEY, JSON.stringify({
      version: 1, planKey: SHARE, at: '2026-10-31T02:00:00.000Z', href: `/review/${SHARE}`,
    }));
    setGenerationOutcome({
      placed: [{ id: 'a' }],
      refused: [],
      skipped: [],
      report: { score: SCORE, reasoning: '账本里的理由', suggestion: '账本里的建议', durationMs: 999 },
    });
    render(<BingoAuditCard score={{ ...SCORE, total: 60 }} reasoning="props 的理由" durationMs={40}/>);
    expect(screen.queryByText('60')).toBeNull();
    expect(screen.queryByText('props 的理由')).toBeNull();
    expect(screen.queryByText('账本里的理由')).toBeNull();
    expect(screen.getByText('耗时')).toBeTruthy();
    expect(screen.getByText('40ms')).toBeTruthy();
  });

  it('refreshes when an outcome is written after the card mounted (Outcome 写了但卡不刷新)', () => {
    localStorage.setItem(BINGO_RETURN_KEY, JSON.stringify({
      version: 1, planKey: SHARE, at: '2026-10-31T02:00:00.000Z', href: `/review/${SHARE}`,
    }));
    render(<BingoAuditCard/>);
    expect(screen.queryByTestId('bingo-score')).toBeNull();

    act(() => {
      setGenerationOutcome({
        placed: [{ id: 'a' }],
        refused: [],
        skipped: [],
        report: { score: SCORE, durationMs: 500 },
      });
    });

    expect(screen.getByTestId('bingo-score')).toBeTruthy();
    expect(screen.getByText(/几何检查：待核验/)).toBeTruthy();
    expect(screen.getByText(/历史操作结果/)).toBeTruthy();
  });});
