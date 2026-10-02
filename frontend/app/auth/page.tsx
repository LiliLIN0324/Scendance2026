'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth, safeReturnPath } from '@/lib/auth-provider';
import { useBackendSession } from '@/lib/backend-session';

export default function AuthPage(): JSX.Element {
  const auth = useAuth()!;
  const cloud = useBackendSession(auth.controller);
  const router = useRouter();
  const [signUp, setSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (auth.ready && cloud.user) router.replace(safeReturnPath(new URLSearchParams(window.location.search).get('next')));
  }, [auth.ready, cloud.user, router]);

  return <main className="sc-auth-page">
    <a className="sc-auth-brand" href="/introduction#scene">幕景 <span>Scendance</span></a>
    <section className="sc-auth-card">
      <div className="sc-auth-intro"><span>YOUR NEXT SCENE</span><h1>让想象，<br />在这里成形。</h1><p>登录你的工作室，保存布置方案，<br />继续创造下一场相聚。</p><a href="/introduction#scene">← 返回场景介绍</a></div>
      <div className="sc-auth-form-wrap">
        <div className="sc-auth-tabs" role="group" aria-label="登录或注册">
          <button type="button" aria-pressed={!signUp} disabled={busy} onClick={() => { setSignUp(false); setNotice(''); }}>Sign in · 登录</button>
          <button type="button" aria-pressed={signUp} disabled={busy} onClick={() => { setSignUp(true); setNotice(''); }}>Sign up · 注册</button>
        </div>
        <h2>{signUp ? '创建你的工作室' : '欢迎回来'}</h2>
        <p className="sc-auth-hint">{signUp ? '注册后即可拥有独立的场景工作室。' : '登录后，继续你的场景。'}</p>
        <form onSubmit={async event => {
          event.preventDefault();
          if (busy) return;
          setBusy(true); setNotice(''); setFailed(false);
          try {
            if (signUp) {
              const signedIn = await auth.controller.signUp(email, password, name, `${window.location.origin}/auth/callback`);
              if (!signedIn) setNotice('请查收验证邮件，点击邮件中的链接完成注册。如果已经注册，请直接登录。');
            } else await auth.controller.signIn(email, password);
          } catch (err) {
            setFailed(true);
            setNotice(signUp ? (err instanceof Error ? err.message : '注册失败，请重试。') : auth.controller.getSnapshot().error?.message ?? '登录失败，请重试。');
          } finally { setPassword(''); setBusy(false); }
        }}>
          {signUp && <label>如何称呼你<input autoComplete="nickname" maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="你的名字" required /></label>}
          <label>邮箱<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required /></label>
          <label>密码<input type="password" autoComplete={signUp ? 'new-password' : 'current-password'} minLength={signUp ? 12 : undefined} value={password} onChange={e => setPassword(e.target.value)} placeholder={signUp ? '至少 12 位' : '输入你的密码'} required /></label>
          <button className="sc-auth-submit" disabled={busy || !auth.ready || !cloud.configured} type="submit">{busy ? '正在处理…' : !auth.ready ? '正在恢复会话…' : signUp ? '创建账号' : '登录并进入场景'} <span aria-hidden="true">↗</span></button>
        </form>
        {(notice || auth.error || !cloud.configured) && <p className="sc-auth-notice" role={failed || auth.error || !cloud.configured ? 'alert' : 'status'}>{notice || auth.error || '登录服务尚未配置，请联系管理员。'}</p>}
        <p className="sc-auth-footnote">你的场景保存在你的工作室中。</p>
      </div>
    </section>
  </main>;
}
