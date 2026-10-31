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

describe('物件生成条', () => {
  it('空着时按钮是半禁用，Tab 填入建议后才可点', () => {
    dock();
    const button = screen.getByRole('button', { name: '生成物件' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('按 Tab 填入')).toBeTruthy();
    const input = screen.getByLabelText('物件描述') as HTMLTextAreaElement;
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.value).toBe(GENERATE_SUGGESTIONS[0]);
    expect(button.disabled).toBe(false);
  });

  it('没勾选确认扣额度就不会提交', async () => {
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
    expect(screen.getByText('先勾选确认扣额度，才会提交。')).toBeTruthy();
    expect(fetchMock.mock.calls.some(call => call[1]?.method === 'POST')).toBe(false);
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
    fireEvent.click(screen.getByRole('checkbox', { name: CREDIT_CONFIRM_LABEL }));
    fireEvent.click(screen.getByRole('button', { name: '生成物件' }));
    fireEvent.click(await screen.findByRole('button', { name: '停止生成' }));
    expect(await screen.findByText(/已停下/)).toBeTruthy();
    expect(posts).toBe(1);
  });

  it('本机代理没开时，写了字也不会提交', () => {
    dock();
    fireEvent.change(screen.getByLabelText('物件描述'), { target: { value: '一张白桌' } });
    fireEvent.click(screen.getByRole('checkbox', { name: CREDIT_CONFIRM_LABEL }));
    fireEvent.click(screen.getByRole('button', { name: '生成物件' }));
    expect(screen.getByText(/不会提交，也不会扣额度/)).toBeTruthy();
  });
});
