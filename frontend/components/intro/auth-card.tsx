'use client';

import { ArrowRight, KeyRound, LockKeyhole } from '@/components/solid-icons';
import { useState, type FormEvent } from 'react';
import { useEmailCooldown } from '@/lib/auth-provider';
import { useBackendSession, type BackendSession } from '@/lib/backend-session';
import './auth-card.css';

export interface DemoAccount {
  email: string;
  password: string;
}

interface AuthCardProps {
  controller: BackendSession;
  /** 登录 / 注册 / 验证码 / 访客任一方式拿到真实会话后调用。 */
  onAuthenticated: () => void;
  /** 已登录态点「进入工作台」；缺省与 onAuthenticated 相同。 */
  onEnter?: () => void;
  /** 会话还在恢复时锁住提交，避免重复登录。 */
  ready?: boolean;
  authError?: string;
  /** 演示账号默认取构建环境变量，测试可显式注入。 */
  demoAccount?: DemoAccount;
}

/** 账户浮窗的未登录态：登录 / 注册 / 六位验证码 / 已登录就地切换，不跳整页。 */
export function AuthCard({ controller, onAuthenticated, onEnter, ready = true, authError = '', demoAccount: injectedDemo }: AuthCardProps): JSX.Element {
  const cloud = useBackendSession(controller);
  const [signUp, setSignUp] = useState(false);
  const [name, setName] = useState('');
  const [verificationEmail, setVerificationEmail] = useState('');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  const cooldown = useEmailCooldown();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [guestBusy, setGuestBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const demoEmail = (process.env.NEXT_PUBLIC_DEMO_EMAIL ?? '').trim();
  const demoPassword = process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? '';
  const demoAccount: DemoAccount | undefined = injectedDemo ?? (demoEmail && demoPassword ? { email: demoEmail, password: demoPassword } : undefined);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !ready || !cloud.configured) return;
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      if (verificationEmail) {
        await controller.verifyEmailCode(verificationEmail, code, 'signup');
      } else if (signUp) {
        const signedIn = await controller.signUp(email, password, name, `${window.location.origin}/auth/callback`);
        if (!signedIn) {
          setVerificationEmail(email.trim());
          cooldown.start();
          setNotice('请检查收件箱和垃圾邮件。如果已经确认过邮箱，请直接登录。');
          return;
        }
      } else await controller.signIn(email, password);
      onAuthenticated();
    } catch (thrown) {
      const failure = controller.getSnapshot().error;
      setError(signUp ? (thrown instanceof Error ? thrown.message : '注册失败，请重试。') : failure?.code === 'NETWORK_ERROR'
        ? '暂时无法连接登录服务，请稍后重试。'
        : failure?.code === 'INVALID_RESPONSE'
          ? '登录服务暂时无法完成验证，请稍后重试。'
          : failure?.code === 'UNAUTHENTICATED'
            ? '当前无法登录，请检查账号状态或稍后再试。'
            : failure?.message ?? '暂时无法登录，请稍后再试。');
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  async function leaveAccount(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await controller.signOut();
    } catch {
      setError('暂时无法退出，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  async function enterAsGuest(): Promise<void> {
    if (busy || !ready || !cloud.configured) return;
    setBusy(true); setGuestBusy(true); setError(null); setNotice('');
    try {
      await controller.signInAsGuest();
      onAuthenticated();
    } catch {
      setError('暂时无法创建访客会话，请稍后重试。');
    } finally {
      setBusy(false); setGuestBusy(false);
    }
  }

  function changeMode(value: boolean): void {
    setSignUp(value); setVerificationEmail(''); setCode(''); setPassword(''); setNotice(''); setError(null);
  }

  return (
    <section className="sc-auth-card">
      {!cloud.user && <div className="sc-auth-tabs" role="group" aria-label="登录或注册">
        <button type="button" aria-pressed={!signUp} disabled={busy} onClick={() => changeMode(false)}>Sign in · 登录</button>
        <button type="button" aria-pressed={signUp} disabled={busy} onClick={() => changeMode(true)}>Sign up · 注册</button>
      </div>}
      <h2 className="sc-auth-title">{cloud.user ? '欢迎来到幕景' : verificationEmail ? '确认你的邮箱' : signUp ? '创建你的工作室' : '欢迎回来'}</h2>
      <p className="sc-auth-copy">{cloud.user ? '一个空间，装下你的下一场相聚。' : verificationEmail ? `请输入发送至 ${verificationEmail} 的六位验证码。` : signUp ? '确认邮箱后，即可拥有独立的场景工作室。' : '登录后，继续你的场景。'}</p>

      {cloud.user ? (
        <div className="sc-auth-signed-in">
          <p className="sc-auth-account-caption">当前已登录</p>
          <p className="sc-auth-account">{cloud.user.is_anonymous ? '访客' : cloud.user.email ?? '工作室账号'}</p>
          <button className="sc-auth-primary" type="button" onClick={onEnter ?? onAuthenticated}>进入工作台<ArrowRight size={16} aria-hidden="true" /></button>
          <div className="sc-auth-links"><button type="button" disabled={busy} onClick={() => { void leaveAccount(); }}>{cloud.user.is_anonymous ? '退出访客，换一个账号' : '退出登录'}</button></div>
        </div>
      ) : (
        <>
          {demoAccount && !signUp && !verificationEmail && <div className="sc-auth-demo" role="group" aria-label="演示账号">
            <KeyRound size={16} aria-hidden="true" />
            <div className="sc-auth-demo-fields">
              <p><span>邮箱</span><code>{demoAccount.email}</code></p>
              <p><span>密码</span><code>{demoAccount.password}</code></p>
            </div>
            <button type="button" disabled={busy} onClick={() => { setEmail(demoAccount.email); setPassword(demoAccount.password); setError(null); }}>填入</button>
          </div>}
          <form className="sc-auth-form" aria-label={verificationEmail ? '邮箱验证' : signUp ? '工作室注册' : '工作室登录'} onSubmit={(event) => { void submit(event); }} aria-busy={busy}>
            {verificationEmail ? <>
              <label htmlFor="sc-auth-code">六位验证码</label>
              <input id="sc-auth-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} disabled={busy} required />
            </> : <>
              {signUp && <>
                <label htmlFor="sc-auth-name">如何称呼你</label>
                <input id="sc-auth-name" autoComplete="nickname" maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="你的名字" disabled={busy} required />
              </>}
              <label htmlFor="sc-auth-email">邮箱</label>
              <input id="sc-auth-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} required />
              <label htmlFor="sc-auth-password">密码</label>
              <input id="sc-auth-password" name="password" type="password" autoComplete={signUp ? 'new-password' : 'current-password'} minLength={signUp ? 12 : undefined} placeholder={signUp ? '至少 12 位' : '输入你的密码'} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} required />
            </>}
            {(error || authError) && <p className="sc-auth-error" role="alert">{error || authError}</p>}
            <button className="sc-auth-primary" type="submit" disabled={!ready || !cloud.configured || busy}>{busy ? (signUp ? '正在处理…' : '正在登录…') : !ready ? '正在恢复会话…' : verificationEmail ? '验证并进入工作室' : signUp ? '创建账号' : '登录并进入工作台'}<ArrowRight size={16} aria-hidden="true" /></button>
          </form>
          <div className="sc-auth-links">
            {verificationEmail ? <>
              <button type="button" disabled={busy || cooldown.remaining > 0} onClick={async () => {
                setBusy(true); setError(null); setNotice(''); cooldown.start();
                try { await controller.resendSignup(verificationEmail, `${window.location.origin}/auth/callback`); setNotice('若邮箱仍待确认，新的验证码将发送到邮箱。请使用最新邮件中的验证码。'); }
                catch (err) { setError(err instanceof Error ? err.message : '发送失败，请稍后重试。'); }
                finally { setBusy(false); }
              }}>{cooldown.remaining > 0 ? `${cooldown.remaining} 秒后可重新发送` : '重新发送验证码'}</button>
              <button type="button" disabled={busy} onClick={() => { setVerificationEmail(''); setCode(''); setNotice(''); setError(null); }}>修改邮箱</button>
            </> : signUp ? <button type="button" disabled={busy || !email.trim()} onClick={() => { setVerificationEmail(email.trim()); setError(null); setNotice('请输入收到的注册验证码，或重新发送。'); }}>输入已有验证码</button> : <a href="/reset-password">忘记密码？</a>}
          </div>
          {notice && <p className="sc-auth-notice" role="status">{notice}</p>}
          {!cloud.configured && <p className="sc-auth-offline" role="status">登录服务尚未配置，暂时只能本地体验。</p>}
          <div className="sc-auth-separator"><span>或</span></div>
          <button className="sc-auth-secondary" type="button" onClick={() => { void enterAsGuest(); }} disabled={busy || !ready || !cloud.configured}>{guestBusy ? '正在进入…' : '访客进入'}<ArrowRight size={16} aria-hidden="true" /></button>
          <p className="sc-auth-note">无需注册，享有普通用户功能。访客身份保留在此浏览器，退出或清除浏览器数据后失效。</p>
        </>
      )}
      <div className="sc-auth-footer"><LockKeyhole size={16} aria-hidden="true" /><span>每位用户拥有独立身份与私有项目</span></div>
    </section>
  );
}
