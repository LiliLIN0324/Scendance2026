'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth, safeReturnPath, useEmailCooldown } from '@/lib/auth-provider';
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
  const [verificationEmail, setVerificationEmail] = useState('');
  const [code, setCode] = useState('');
  const cooldown = useEmailCooldown();
  useEffect(() => {
    if (auth.ready && cloud.user) router.replace(safeReturnPath(new URLSearchParams(window.location.search).get('next')));
  }, [auth.ready, cloud.user, router]);

  return <main className="sc-auth-page">
    <a className="sc-auth-brand" href="/introduction#scene">幕景 <span>Scendance</span></a>
    <section className="sc-auth-card">
      <div className="sc-auth-intro"><span>YOUR NEXT SCENE</span><h1>让想象，<br />在这里成形。</h1><p>登录你的工作室，保存布置方案，<br />继续创造下一场相聚。</p><a href="/introduction#scene">← 返回场景介绍</a></div>
      <div className="sc-auth-form-wrap">
        <div className="sc-auth-tabs" role="group" aria-label="登录或注册">
          <button type="button" aria-pressed={!signUp} disabled={busy} onClick={() => { setSignUp(false); setVerificationEmail(''); setCode(''); setPassword(''); setNotice(''); }}>Sign in · 登录</button>
          <button type="button" aria-pressed={signUp} disabled={busy} onClick={() => { setSignUp(true); setVerificationEmail(''); setCode(''); setPassword(''); setNotice(''); }}>Sign up · 注册</button>
        </div>
        <h2>{verificationEmail ? '确认你的邮箱' : signUp ? '创建你的工作室' : '欢迎回来'}</h2>
        <p className="sc-auth-hint">{verificationEmail ? `请输入发送至 ${verificationEmail} 的六位验证码。` : signUp ? '确认邮箱后，即可拥有独立的场景工作室。' : '登录后，继续你的场景。'}</p>
        <form onSubmit={async event => {
          event.preventDefault();
          if (busy) return;
          setBusy(true); setNotice(''); setFailed(false);
          try {
            if (verificationEmail) {
              await auth.controller.verifyEmailCode(verificationEmail, code, 'signup');
            } else if (signUp) {
              const signedIn = await auth.controller.signUp(email, password, name, `${window.location.origin}/auth/callback`);
              if (!signedIn) {
                setVerificationEmail(email.trim()); cooldown.start();
                setNotice('请检查收件箱和垃圾邮件。如果已经确认过邮箱，请直接登录。');
              }
            } else await auth.controller.signIn(email, password);
          } catch (err) {
            setFailed(true);
            setNotice(signUp ? (err instanceof Error ? err.message : '注册失败，请重试。') : auth.controller.getSnapshot().error?.message ?? '登录失败，请重试。');
          } finally { setPassword(''); setBusy(false); }
        }}>
          {verificationEmail ? <label>六位验证码<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required /></label> : <>
            {signUp && <label>如何称呼你<input autoComplete="nickname" maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="你的名字" required /></label>}
            <label>邮箱<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required /></label>
            <label>密码<input type="password" autoComplete={signUp ? 'new-password' : 'current-password'} minLength={signUp ? 12 : undefined} value={password} onChange={e => setPassword(e.target.value)} placeholder={signUp ? '至少 12 位' : '输入你的密码'} required /></label>
          </>}
          <button className="sc-auth-submit" disabled={busy || !auth.ready || !cloud.configured} type="submit">{busy ? '正在处理…' : !auth.ready ? '正在恢复会话…' : verificationEmail ? '验证并进入工作室' : signUp ? '创建账号' : '登录并进入场景'} <span aria-hidden="true">↗</span></button>
        </form>
        <div className="sc-auth-actions">
          {verificationEmail ? <>
            <button type="button" disabled={busy || cooldown.remaining > 0} onClick={async () => {
              setBusy(true); setFailed(false); setNotice(''); cooldown.start();
              try { await auth.controller.resendSignup(verificationEmail, `${window.location.origin}/auth/callback`); setNotice('若邮箱仍待确认，新的验证码将发送到邮箱。请使用最新邮件中的验证码。'); }
              catch (err) { setFailed(true); setNotice(err instanceof Error ? err.message : '发送失败，请稍后重试。'); }
              finally { setBusy(false); }
            }}>{cooldown.remaining > 0 ? `${cooldown.remaining} 秒后可重新发送` : '重新发送验证码'}</button>
            <button type="button" disabled={busy} onClick={() => { setVerificationEmail(''); setCode(''); setNotice(''); }}>修改邮箱</button>
          </> : signUp ? <button type="button" disabled={busy || !email.trim()} onClick={() => { setVerificationEmail(email.trim()); setNotice('请输入收到的注册验证码，或重新发送。'); }}>输入已有验证码</button> : <a href="/reset-password">忘记密码？</a>}
        </div>
        {(notice || auth.error || !cloud.configured) && <p className="sc-auth-notice" role={failed || auth.error || !cloud.configured ? 'alert' : 'status'}>{notice || auth.error || '登录服务尚未配置，请联系管理员。'}</p>}
        <p className="sc-auth-footnote">你的场景保存在你的工作室中。</p>
      </div>
    </section>
  </main>;
}
