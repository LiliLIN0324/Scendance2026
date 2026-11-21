// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isLocalDevHostname,
  localAutoLoginCredentials,
  parseLocalAutoLogin,
  rememberLocalAutoLogin,
  shouldAttemptLocalAutoLogin,
} from './local-auto-login';
import { MemoryStorage } from './test-support-memory-storage';

const ENV_KEY = 'NEXT_PUBLIC_SCENDANCE_LOCAL_LOGIN';
let mem: MemoryStorage;

function candidates(...accounts: Array<[string, string, ('local' | 'cloud')?]>): string {
  return JSON.stringify(accounts.map(([email, password, scope]) => ({ email, password, ...(scope ? { scope } : {}) })));
}

describe('parseLocalAutoLogin', () => {
  it('reads every complete pair in order', () => {
    const parsed = parseLocalAutoLogin(candidates(['a@scendance.test', 'p1'], ['b@scendance.test', 'p2', 'local']));
    expect(parsed).toEqual([
      { email: 'a@scendance.test', password: 'p1', scope: 'cloud' },
      { email: 'b@scendance.test', password: 'p2', scope: 'local' },
    ]);
  });

  it('drops incomplete entries and repeats of the same mailbox', () => {
    const parsed = parseLocalAutoLogin(JSON.stringify([
      { email: 'a@scendance.test', password: 'p1' },
      { email: 'a@scendance.test', password: 'p2' },
      { email: '  ', password: 'p3' },
      { email: 'c@scendance.test' },
      null,
      'nope',
    ]));
    expect(parsed).toEqual([{ email: 'a@scendance.test', password: 'p1', scope: 'cloud' }]);
  });

  it('treats missing or malformed input as "no credentials" instead of throwing', () => {
    expect(parseLocalAutoLogin(undefined)).toEqual([]);
    expect(parseLocalAutoLogin('')).toEqual([]);
    expect(parseLocalAutoLogin('{not json')).toEqual([]);
    expect(parseLocalAutoLogin('{"email":"a@b.c","password":"x"}')).toEqual([]);
  });
});

describe('isLocalDevHostname', () => {
  it('accepts loopback spellings only', () => {
    for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '[::1]', '0.0.0.0']) expect(isLocalDevHostname(host)).toBe(true);
    for (const host of ['192.168.1.101', 'scendance.com', 'localhost.example.com', 'wkhfvnzgopjdzxlmycks.supabase.co']) expect(isLocalDevHostname(host)).toBe(false);
  });
});

describe('auto-login attempt bookkeeping', () => {
  beforeEach(() => { mem = new MemoryStorage(); vi.stubGlobal('Storage', MemoryStorage); vi.stubGlobal('localStorage', mem); window.localStorage = mem; sessionStorage.clear(); localStorage.clear(); vi.stubEnv(ENV_KEY, candidates(['local@scendance.test', 'local-pw'], ['cloud@scendance.test', 'cloud-pw'])); });
  afterEach(() => { vi.unstubAllEnvs(); sessionStorage.clear(); mem?.clear(); vi.unstubAllGlobals(); });

  it('starts without a cooldown and prefers the credential order from the build', () => {
    expect(shouldAttemptLocalAutoLogin()).toBe(true);
    expect(localAutoLoginCredentials().map(account => account.email)).toEqual(['local@scendance.test', 'cloud@scendance.test']);
  });

  it('leaves the local-stack account out when the backend is the cloud project', () => {
    vi.stubEnv(ENV_KEY, candidates(['owner@scendance.test', 'local-pw', 'local'], ['cloud@scendance.test', 'cloud-pw']));
    expect(localAutoLoginCredentials({ localBackend: true }).map(account => account.email)).toEqual(['owner@scendance.test', 'cloud@scendance.test']);
    expect(localAutoLoginCredentials({ localBackend: false }).map(account => account.email)).toEqual(['cloud@scendance.test']);
  });

  it('cools down after a full sweep failed, then retries once the cooldown lapsed', () => {
    const now = 1_000_000;
    rememberLocalAutoLogin(null, 'failed', now);
    expect(shouldAttemptLocalAutoLogin(now + 1000)).toBe(false);
    expect(shouldAttemptLocalAutoLogin(now + 5 * 60 * 1000)).toBe(true);
  });

  it('puts the mailbox that already worked first and clears the failure mark', () => {
    rememberLocalAutoLogin(null, 'failed', 1_000_000);
    rememberLocalAutoLogin('cloud@scendance.test', 'ok');
    expect(shouldAttemptLocalAutoLogin()).toBe(true);
    expect(localAutoLoginCredentials().map(account => account.email)).toEqual(['cloud@scendance.test', 'local@scendance.test']);
    // 记录落在 localStorage：换个新标签页（sessionStorage 是空的）也还是它先试。
    sessionStorage.clear();
    expect(localAutoLoginCredentials().map(account => account.email)).toEqual(['cloud@scendance.test', 'local@scendance.test']);
  });

  it('exposes no credentials when the dev build injected nothing (production export)', () => {
    vi.stubEnv(ENV_KEY, '');
    expect(localAutoLoginCredentials()).toEqual([]);
    expect(shouldAttemptLocalAutoLogin()).toBe(true);
  });
});
