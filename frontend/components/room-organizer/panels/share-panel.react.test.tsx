// @vitest-environment jsdom
/**
 * P0-B / P1-B（2026-11-20 发布闭环）发布界面测试。
 * SharePanel 只做展示：状态/阻塞/摘要/反馈/记录全部由宿主通过可选 props 传入；
 * 不传 props 时必须保持旧版发布页渲染（普通发布与完整分享历史兼容）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatShareTime, SharePanel, type PublishPrecheckState, type PublishRecordsState, type ShareTab } from './share-panel';

afterEach(cleanup);

function panelProps(extra: Partial<Parameters<typeof SharePanel>[0]> = {}): Parameters<typeof SharePanel>[0] {
  return {
    tab: 'publish',
    onTab: () => undefined,
    title: '发布会',
    published: null,
    busy: false,
    notice: '',
    bingoStatus: '待发',
    qrOpen: false,
    qrSvg: '',
    exports: [],
    onIssueAudience: () => undefined,
    onSendBingo: () => undefined,
    onPublish: () => undefined,
    onCopy: () => undefined,
    onToggleQr: () => undefined,
    ...extra,
  };
}

function blockersOf(extra: Partial<PublishPrecheckState> = {}): PublishPrecheckState {
  return {
    checking: false,
    saveLine: '已保存到云端 · 版本 4',
    lastPublished: null,
    blockers: [],
    ...extra,
  };
}

describe('发布页历史兼容（不传新 props）', () => {
  it('未发布时仍是旧版绿色 CTA，不出现预检/记录新区块', () => {
    render(<SharePanel {...panelProps()} />);
    expect(screen.getByRole('button', { name: '发布并复制链接' }).getAttribute('data-tone')).toBe('green');
    expect(screen.getByText('发布后即可查看场地、分区和尺度，页里可看 3D。')).toBeTruthy();
    expect(screen.queryByTestId('publish-status')).toBeNull();
    expect(screen.queryByTestId('publish-blockers')).toBeNull();
    expect(screen.queryByTestId('publish-summary')).toBeNull();
    expect(screen.queryByTestId('publish-records')).toBeNull();
    expect(screen.queryByTestId('publish-feedback')).toBeNull();
  });

  it('已发布时保留链接行，并新增打开与完整地址手动取走路径', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      render(<SharePanel {...panelProps({ published: { url: 'https://studio.example/view/#tok', revision: 3 } })} />);
      expect(screen.getByTestId('share-link-row').textContent).toContain('studio.example/view/#tok');
      expect(screen.queryByRole('button', { name: '发布并复制链接' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '打开' }));
      expect(open).toHaveBeenCalledWith('https://studio.example/view/#tok', '_blank', 'noopener,noreferrer');
      const details = screen.getByTestId('share-fullurl');
      expect(details.textContent).toContain('https://studio.example/view/#tok');
      expect(details.querySelector('summary')?.textContent).toBe('完整地址');
    } finally { open.mockRestore(); }
  });
});

describe('P0-B：预检状态与阻塞清单', () => {
  it('展示保存状态、已发布版本与未发布修改', () => {
    render(<SharePanel {...panelProps({
      precheck: blockersOf({
        lastPublished: { revision: 4, at: '2026-11-19T14:02:00Z' },
        dirty: true,
      }),
    })} />);
    const status = screen.getByTestId('publish-status');
    expect(status.textContent).toContain('保存状态：已保存到云端 · 版本 4');
    expect(status.textContent).toContain('已发布：版本 4 · 11-19');
    expect(status.textContent).toContain('当前修改：有未发布的修改，可发布为新版本。');
    // 未发布修改明确标注：CTA 变为发布新版
    expect(screen.getByRole('button', { name: '发布新版并复制链接' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '发布并复制链接' })).toBeNull();
  });

  it('没有发布过的方案显示「还没有发布过」，CTA 仍是首发', () => {
    render(<SharePanel {...panelProps({ precheck: blockersOf() })} />);
    expect(screen.getByTestId('publish-status').textContent).toContain('还没有发布过。');
    expect(screen.getByRole('button', { name: '发布并复制链接' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '发布新版并复制链接' })).toBeNull();
  });

  it('预检进行中只显示检查中，不提前判可发布', () => {
    render(<SharePanel {...panelProps({ precheck: blockersOf({ checking: true }) })} />);
    const blockers = screen.getByTestId('publish-blockers');
    expect(blockers.textContent).toContain('正在检查保存状态与资源归档…');
    expect(blockers.textContent).not.toContain('检查通过，可以发布。');
    expect(screen.queryByRole('button', { name: '发布并复制链接' })).toBeNull();
  });

  it('阻塞清单逐条展示，动作按钮调用宿主回调；没有动作的条目只说明', () => {
    const onSelect = vi.fn();
    render(<SharePanel {...panelProps({
      precheck: blockersOf({
        blockers: [
          { id: 'save', message: '还有改动没保存。', action: { label: '保存当前修改', onSelect } },
          { id: 'lease', message: '编辑权在另一位成员手里，等对方释放后重试。' },
        ],
      }),
    })} />);
    const list = screen.getByTestId('publish-blockers');
    expect(list.textContent).toContain('还有 2 项需要处理：');
    expect(screen.getByTestId('publish-blocker-save').textContent).toContain('还有改动没保存。');
    expect(screen.getByRole('button', { name: '保存当前修改' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /取回|释放/ })).toBeNull();
    // 接口约定 §2/§3.1：预检阻塞不隐藏主按钮，闸门在发布链内强制执行；清单只提供处理入口。
    expect(screen.getByRole('button', { name: '发布并复制链接' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '保存当前修改' }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('阻塞清空后显示检查通过并恢复发布主按钮', () => {
    render(<SharePanel {...panelProps({ precheck: blockersOf() })} />);
    expect(screen.getByTestId('publish-blockers').textContent).toContain('检查通过，可以发布。');
    expect(screen.getByRole('button', { name: '发布并复制链接' })).toBeTruthy();
  });

  it('展示本次发布内容与对外可见范围，缺失项如实标注', () => {
    render(<SharePanel {...panelProps({
      precheck: blockersOf({
        summary: [
          { label: '场地', detail: '12 × 8 米 · 1 层' },
          { label: '实景扫描', detail: '西湖扫描未归档', missing: true },
        ],
        visibilityLine: '客户可见：三维布置、物料清单；资料原件不公开。',
      }),
    })} />);
    const summary = screen.getByTestId('publish-summary');
    expect(summary.textContent).toContain('场地：12 × 8 米 · 1 层');
    expect(summary.textContent).toContain('实景扫描：西湖扫描未归档（缺失）');
    expect(summary.textContent).toContain('客户可见：三维布置、物料清单；资料原件不公开。');
  });

  it('发布成功、复制成功、复制失败分开反馈且角色正确', () => {
    render(<SharePanel {...panelProps({
      precheck: blockersOf(),
      publishFeedback: { tone: 'ok', text: '已发布 · 版本 5' },
      copyFeedback: { tone: 'err', text: '复制没成功：请在完整地址里手动选择复制。' },
    })} />);
    const publish = screen.getByTestId('publish-feedback');
    const copy = screen.getByTestId('copy-feedback');
    expect(publish.getAttribute('role')).toBe('status');
    expect(publish.textContent).toBe('已发布 · 版本 5');
    expect(copy.getAttribute('role')).toBe('alert');
    expect(copy.textContent).toContain('复制没成功');
  });

  it('已发布且无未发布修改时不再给发布按钮', () => {
    render(<SharePanel {...panelProps({
      published: { url: 'https://studio.example/view/#tok', revision: 4 },
      precheck: blockersOf({ lastPublished: { revision: 4 }, dirty: false }),
    })} />);
    expect(screen.getByTestId('publish-status').textContent).toContain('当前修改：与已发布版本一致。');
    expect(screen.queryByRole('button', { name: '发布并复制链接' })).toBeNull();
    expect(screen.queryByRole('button', { name: '发布新版并复制链接' })).toBeNull();
  });

  it('已发布且有未发布修改时，链接行下方给发布新版的独立按钮', () => {
    render(<SharePanel {...panelProps({
      published: { url: 'https://studio.example/view/#tok', revision: 4 },
      precheck: blockersOf({ lastPublished: { revision: 4 }, dirty: true }),
    })} />);
    expect(screen.getByTestId('share-link-row')).toBeTruthy();
    expect(screen.getByRole('button', { name: '发布新版并复制链接' })).toBeTruthy();
  });
});

describe('P1-B：发布记录与版本管理', () => {
  const rows = [
    { key: 'r1', kind: 'web' as const, revision: 3, at: Date.parse('2026-11-19T10:00:00Z'), url: 'https://studio.example/view/#old', shareId: 'share-3', revoked: false },
    { key: 'r2', kind: 'web' as const, revision: 2, at: Date.parse('2026-11-18T10:00:00Z'), url: null, shareId: 'share-2', revoked: false },
    { key: 'r3', kind: 'web' as const, revision: 1, at: Date.parse('2026-11-17T10:00:00Z'), url: 'https://studio.example/view/#dead', shareId: 'share-1', revoked: true },
    { key: 'r4', kind: 'viewer' as const, revision: null, at: 0, url: 'https://studio.example/view/#s1=abc', shareId: null, revoked: false },
  ];

  function records(extra: Partial<PublishRecordsState> = {}): PublishRecordsState {
    return { rows, ...extra };
  }

  it('逐版本展示记录：web/3D 快照、已撤回、无链接说明', () => {
    render(<SharePanel {...panelProps({ precheck: blockersOf(), publishRecords: records() })} />);
    const list = screen.getByTestId('publish-records');
    expect(list.textContent).toContain('版本 3 · 11-19');
    // 时间展示走 formatShareTime，断言不依赖测试机时区
    expect(list.textContent).toContain(`版本 1 · ${formatShareTime(Date.parse('2026-11-17T10:00:00Z'))} · 已撤回`);
    expect(list.textContent).toContain('3D 快照 · 版本 — · 时间未知');
    expect(list.textContent).toContain('链接只在生成时显示一次，没有留存完整地址');
    const revoked = screen.getByTestId('publish-record-r3');
    expect(revoked.querySelector('button')).toBeNull();
    expect(revoked.getAttribute('data-revoked')).toBe('true');
  });

  it('记录行的复制用剪贴板、打开走新窗口', async () => {
    const clipboard = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboard } });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      render(<SharePanel {...panelProps({ precheck: blockersOf(), publishRecords: records() })} />);
      const row = screen.getByTestId('publish-record-r1');
      fireEvent.click(row.querySelector('.sc-share-copy')!);
      await waitFor(() => expect(clipboard).toHaveBeenCalledWith('https://studio.example/view/#old'));
      expect(screen.getByTestId('publish-records').textContent).toContain('已复制版本 3 的链接。');
      fireEvent.click(screen.getByTestId('publish-record-r1').querySelectorAll('button')[1]!);
      expect(open).toHaveBeenCalledWith('https://studio.example/view/#old', '_blank', 'noopener,noreferrer');
    } finally { open.mockRestore(); }
  });

  it('复制失败提示手动路径；撤销按钮带 shareId 调宿主回调', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    const onRevoke = vi.fn();
    render(<SharePanel {...panelProps({ precheck: blockersOf(), publishRecords: records({ onRevoke }) })} />);
    fireEvent.click(screen.getByTestId('publish-record-r1').querySelector('.sc-share-copy')!);
    await waitFor(() => expect(screen.getByTestId('publish-records').textContent).toContain('复制没成功'));
    fireEvent.click(screen.getByTestId('publish-record-r1').querySelectorAll('button')[2]!);
    expect(onRevoke).toHaveBeenCalledWith(rows[0]);
  });

  it('加载中与读取失败如实展示，不伪造记录', () => {
    const view = render(<SharePanel {...panelProps({ precheck: blockersOf(), publishRecords: records({ rows: [], loading: true }) })} />);
    expect(view.getByTestId('publish-records').textContent).toContain('正在读取发布记录…');
    view.unmount();
    render(<SharePanel {...panelProps({ precheck: blockersOf(), publishRecords: records({ rows: [], error: '发布记录暂时读不到，稍后重试。' }) })} />);
    expect(screen.getByTestId('publish-records').textContent).toContain('发布记录暂时读不到');
  });
});

describe('P1-B：键盘页签导航与焦点', () => {
  /** 页签选择由状态驱动的挂载方式，模拟宿主把 onTab 接到 state。 */
  function TabHarness({ cases }: { cases?: ReactNode }) {
    const [tab, setTab] = useState<ShareTab>('share');
    return <SharePanel {...panelProps({ tab, onTab: setTab, cases })} />;
  }

  it('方向键在页签间循环移动选择和焦点，Home/End 跳两端', () => {
    render(<TabHarness />);
    const tablist = screen.getByRole('tablist', { name: '分享、发布、案例、导出' });
    screen.getByRole('tab', { name: '分享' }).focus();
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: '发布' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '发布' }));
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: '分享' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '分享' }));
    fireEvent.keyDown(tablist, { key: 'End' });
    expect(screen.getByRole('tab', { name: '导出' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tablist, { key: 'Home' });
    expect(screen.getByRole('tab', { name: '分享' }).getAttribute('aria-selected')).toBe('true');
    // 方向键以外的键不接管
    fireEvent.keyDown(tablist, { key: 'Enter' });
    expect(screen.getByRole('tab', { name: '分享' }).getAttribute('aria-selected')).toBe('true');
  });

  it('有案例页签时方向键覆盖四个页签', () => {
    render(<TabHarness cases={<p>案例</p>} />);
    const tablist = screen.getByRole('tablist', { name: '分享、发布、案例、导出' });
    fireEvent.keyDown(tablist, { key: 'End' });
    expect(screen.getByRole('tab', { name: '导出' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: '分享' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: '发布' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: '案例' }).getAttribute('aria-selected')).toBe('true');
  });

  it('打开弹层时焦点进入弹层，关闭后还给触发钮', () => {
    const view = render(<div>
      <button type="button">分享</button>
    </div>);
    const trigger = screen.getByRole('button', { name: '分享' });
    trigger.focus();
    // 模拟「点触发钮后弹层挂载」：焦点应自动移进弹层根节点
    view.rerender(<div>
      <button type="button">分享</button>
      <SharePanel {...panelProps()} />
    </div>);
    expect(document.activeElement).toBe(screen.getByTestId('share-panel'));
    // 卸载（关闭）时焦点在弹层根上，应恢复到触发钮
    view.rerender(<div>
      <button type="button">分享</button>
    </div>);
    expect(document.activeElement).toBe(trigger);
  });

  it('焦点在弹层内按钮上时关闭，焦点同样返回触发钮', () => {
    const view = render(<div>
      <button type="button">分享</button>
    </div>);
    const trigger = screen.getByRole('button', { name: '分享' });
    trigger.focus();
    view.rerender(<div>
      <button type="button">分享</button>
      <SharePanel {...panelProps({ tab: 'share' })} />
    </div>);
    // 把焦点放进弹层内的页签按钮再关闭
    screen.getByRole('tab', { name: '分享' }).focus();
    view.rerender(<div>
      <button type="button">分享</button>
    </div>);
    expect(document.activeElement).toBe(trigger);
  });
});

describe('P1-B：完整只读链接行', () => {
  it('完整分享行提供打开与完整地址手动取走，撤销仍是最后一个按钮', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      render(<SharePanel {...panelProps({
        completeShare: { url: 'https://studio.example/view/#ca'.padEnd(70, 'b'), revision: 4 },
        onCreateCompleteShare: () => undefined,
        onCopyComplete: () => undefined,
        onRevokeCompleteShare: () => undefined,
      })} />);
      const row = screen.getByTestId('complete-share-link-row');
      const buttons = row.querySelectorAll('button');
      expect(buttons[0]?.textContent).toBe('复制');
      expect(buttons[1]?.textContent).toBe('打开');
      expect(buttons[buttons.length - 1]?.textContent).toBe('撤销');
      fireEvent.click(row.querySelectorAll('button')[1]!);
      expect(open).toHaveBeenCalledWith(expect.stringContaining('/view/#c'), '_blank', 'noopener,noreferrer');
      expect(screen.getByTestId('complete-share-fullurl').textContent).toContain('/view/#c');
    } finally { open.mockRestore(); }
  });
});
