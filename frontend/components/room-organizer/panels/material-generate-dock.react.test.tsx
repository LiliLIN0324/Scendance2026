// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CREDIT_CONFIRM_LABEL } from '../lib/site-recon-mock';
import { GENERATE_SUGGESTIONS, MaterialGenerateDock } from './material-generate-dock';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function dock(forceProxy = false) {
  return render(<MaterialGenerateDock onBackToChat={vi.fn()} {...(forceProxy ? { forceProxy: true } : {})}/>);
}

/** 生成条左下只有一颗「+」：在菜单里选过物料/场地之后，图标换成对应那颗，但仍是一颗按钮。 */
function plusIcon(): string {
  return document.querySelector('.ap-plus-btn svg')?.getAttribute('class') ?? '';
}

describe('物件生成条', () => {
  it('空着时提交键半禁用，Tab 填入建议后可用；类型从「+」菜单切，选中后按钮图标跟着换、菜单收起', () => {
    dock();
    const button = screen.getByRole('button', { name: '生成物件' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(plusIcon()).toContain('lucide-plus');
    const input = screen.getByLabelText('物件描述') as HTMLTextAreaElement;
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.value).toBe(GENERATE_SUGGESTIONS[0]);
    expect(button.disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '生成种类' }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map(item => item.querySelector('.ap-menu-label')?.textContent)).toEqual(['物料', '场地']);
    expect(screen.queryByRole('menu')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /^场地/ }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(plusIcon()).toContain('lucide-scan');
    expect(screen.getByLabelText('场景描述')).toBeTruthy();
  });

  it('提交前先问扣额度：取消退回来，确认之后才真提交', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/health')) return { ok: true, json: async () => ({ keyConfigured: true }) };
      if (init?.method === 'POST') return { ok: true, json: async () => ({ taskid: '7' }) };
      return { ok: true, json: async () => ({ status: 0, outputs: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    dock(true);
    await waitFor(() => expect(document.querySelector('[data-lane="generate"]')?.getAttribute('data-online')).toBe('yes'));
    fireEvent.keyDown(screen.getByLabelText('物件描述'), { key: 'Tab' });

    fireEvent.click(screen.getByRole('button', { name: '生成物件' }));
    expect(screen.getByText(new RegExp(CREDIT_CONFIRM_LABEL))).toBeTruthy();
    expect(fetchMock.mock.calls.some(call => call[1]?.method === 'POST')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('group', { name: '扣额度确认' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '生成物件' }));
    fireEvent.click(screen.getByRole('button', { name: '确认提交' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(call => call[1]?.method === 'POST')).toBe(true));
  });

  it('确认之后才提交一次；生成中同一颗按钮变成停止，停止不再提交', async () => {
    let posts = 0;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/health')) return Promise.resolve({ ok: true, json: async () => ({ keyConfigured: true }) });
      if (init?.method === 'POST') {
        posts += 1;
        return new Promise((_resolve, reject) => {
          const abort = () => reject(new DOMException('aborted', 'AbortError'));
          if (init.signal?.aborted) abort();
          else init.signal?.addEventListener('abort', abort, { once: true });
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ status: 0, statusLabel: '排队中', outputs: [] }) });
    }));
    dock(true);
    await waitFor(() => expect(document.querySelector('[data-lane="generate"]')?.getAttribute('data-online')).toBe('yes'));
    fireEvent.keyDown(screen.getByLabelText('物件描述'), { key: 'Tab' });
    fireEvent.click(screen.getByRole('button', { name: '生成物件' }));
    fireEvent.click(screen.getByRole('button', { name: '确认提交' }));
    fireEvent.click(await screen.findByRole('button', { name: '停止生成' }));
    expect(await screen.findByText(/已停下/)).toBeTruthy();
    expect(posts).toBe(1);
  });

  it('本机代理没开时，确认了也不会提交', () => {
    dock();
    fireEvent.change(screen.getByLabelText('物件描述'), { target: { value: '一张白桌' } });
    fireEvent.click(screen.getByRole('button', { name: '生成物件' }));
    fireEvent.click(screen.getByRole('button', { name: '确认提交' }));
    expect(screen.getByText(/不会提交，也不会扣额度/)).toBeTruthy();
  });

  it('物料生成与场地生成在输入框上方，跟「布置」一样有「你可以做什么」，不再挂页脚细链接', () => {
    const aholo = vi.fn();
    render(<MaterialGenerateDock onBackToChat={vi.fn()} onOpenAholo={aholo}/>);
    const group = screen.getByRole('group', { name: '你可以做什么' });
    expect(screen.getByText('你可以做什么')).toBeTruthy();
    expect(screen.queryByText('图片和重建')).toBeNull();
    // 芯片在输入框之前（DOM 顺序），不是挂在页脚。
    const input = screen.getByLabelText('物件描述');
    expect(group.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 两条能力各自落在观感面板对应那组标签上。
    fireEvent.click(screen.getByRole('button', { name: '物料生成' }));
    expect(aholo).toHaveBeenLastCalledWith('text');
    fireEvent.click(screen.getByRole('button', { name: '场地生成' }));
    expect(aholo).toHaveBeenLastCalledWith('world');
  });
});