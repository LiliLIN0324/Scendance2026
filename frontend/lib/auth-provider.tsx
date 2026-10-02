'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createBackendSession, type BackendSession } from './backend-session';

const AuthContext = createContext<{ controller: BackendSession; ready: boolean; error: string } | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [controller] = useState(() => createBackendSession());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const started = useRef(false);
  useEffect(() => controller.retain(), [controller]);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const hash = window.location.hash;
    const path = window.location.pathname.replace(/\/$/, '');
    const callback = path === '/auth/callback' || path === '/reset-password' && Boolean(hash);
    // Remove credentials from the address bar before loading any scene assets.
    if (callback) window.history.replaceState(null, '', window.location.pathname);
    const task = callback ? controller.acceptCallback(hash, path === '/reset-password' ? 'recovery' : undefined) : controller.restoreSession();
    void task.catch(err => setError(err instanceof Error ? err.message : '登录验证失败，请重试。')).finally(() => setReady(true));
  }, [controller]);
  return <AuthContext.Provider value={{ controller, ready, error }}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }

export function safeReturnPath(value: string | null): string {
  if (!value?.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  const url = new URL(value, 'https://scendance.invalid');
  if (url.origin !== 'https://scendance.invalid' || url.pathname.startsWith('/auth') || url.pathname.startsWith('/reset-password')) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}

export function useEmailCooldown() {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRemaining(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  return { remaining, start: () => setRemaining(60) };
}
