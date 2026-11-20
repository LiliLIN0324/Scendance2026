import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  newReviewCode,
  REVIEW_CODE_PATTERN,
  reviewClientLinkKind,
  reviewCodeFromHash,
  reviewCodeFromPath,
  reviewShortHref,
  revokeReviewLink,
} from './review-link-cloud';

const { getSession, createClientMock } = vi.hoisted(() => ({
  getSession: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: createClientMock,
}));

const fetchMock = vi.fn();
const reviewCode = 'abcdef1234567890abcdef12';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-test-key');
  getSession.mockReset();
  createClientMock.mockReset();
  createClientMock.mockReturnValue({ auth: { getSession } });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('review short link helpers', () => {
  it('reads only the review short-code fragment', () => {
    expect(reviewCodeFromHash('#review=abcdef123456')).toBe('abcdef123456');
    expect(reviewCodeFromHash('review=abcdef123456')).toBe('abcdef123456');
    expect(reviewCodeFromHash('#layout=2.abc')).toBeNull();
    expect(reviewCodeFromHash('#review=ABC')).toBeNull();
    expect(reviewCodeFromHash('#review=abc')).toBeNull();
    expect(reviewCodeFromHash('#review=abcdef123456&x=1')).toBeNull();
    expect(reviewCodeFromPath('/r/abcdef123456')).toBe('abcdef123456');
    expect(reviewCodeFromPath('/r/abcdef123456/')).toBe('abcdef123456');
    expect(reviewCodeFromPath('/review/abcdef123456')).toBeNull();
    expect(reviewCodeFromPath('/r/short')).toBeNull();
  });

  it('builds a path short link and classifies the three client URL shapes', () => {
    expect(reviewShortHref('https://app.example/editor?local=1', 'abcdef123456'))
      .toBe('https://app.example/r/abcdef123456');
    expect(reviewClientLinkKind(new URL('https://app.example/r/abcdef123456'))).toBe('path');
    expect(reviewClientLinkKind(new URL('https://app.example/review/#review=abcdef123456'))).toBe('hash');
    expect(reviewClientLinkKind(new URL('https://app.example/review/#layout=abc'))).toBe('layout');
    expect(reviewClientLinkKind(new URL('https://app.example/r/abcdef123456?view=1'))).toBeNull();
    expect(reviewClientLinkKind(new URL('https://app.example/r/abcdef123456#review=abcdef123456'))).toBeNull();
    expect(reviewShortHref('not a url', 'abcdef123456')).toBeNull();
    expect(reviewShortHref('https://app.example', 'short')).toBeNull();
  });

  it('generates an unguessable 24-char lowercase hex code', () => {
    const first = newReviewCode();
    const second = newReviewCode();
    expect(first).toMatch(REVIEW_CODE_PATTERN);
    expect(first).toHaveLength(24);
    expect(first).not.toBe(second);
  });
});

describe('review link revocation client', () => {
  function session(accessToken: string | null): void {
    getSession.mockResolvedValue({ data: { session: accessToken ? { access_token: accessToken } : null }, error: null });
  }

  it('calls the revoke RPC with the signed-in token and returns the code', async () => {
    session('owner-token');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ code: reviewCode, revoked: true }),
    });

    const result = await revokeReviewLink(reviewCode);
    expect(result).toEqual({ ok: true, code: reviewCode });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/rpc/review_share_link_revoke');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ p_code: reviewCode }));
    expect(init.headers.Authorization).toBe('Bearer owner-token');
  });

  it('reports signed-out when there is no session and does not call the RPC', async () => {
    session(null);
    await expect(revokeReviewLink(reviewCode)).resolves.toEqual({ ok: false, reason: 'signed-out' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports disabled when the backend is not configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    await expect(revokeReviewLink(reviewCode)).resolves.toEqual({ ok: false, reason: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps 401/403 to signed-out and other failures to rejected', async () => {
    session('owner-token');
    fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => 'FORBIDDEN' });
    await expect(revokeReviewLink(reviewCode)).resolves.toEqual({ ok: false, reason: 'signed-out' });

    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => 'bad request' });
    await expect(revokeReviewLink(reviewCode)).resolves.toEqual({ ok: false, reason: 'rejected' });
  });

  it('rejects an invalid code without touching the network', async () => {
    session('owner-token');
    await expect(revokeReviewLink('short')).resolves.toEqual({ ok: false, reason: 'rejected' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
