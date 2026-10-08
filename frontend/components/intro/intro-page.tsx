'use client';

import { ArrowRight, Box, ImagePlus, Layers3, LockKeyhole } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useEmailCooldown } from '@/lib/auth-provider';
import { useBackendSession, type BackendSession } from '@/lib/backend-session';
import { BrandMark } from '../brand-mark';
import './intro.css';

interface IntroPageProps {
  controller: BackendSession;
  onEnter: () => void;
  onAuthenticated?: () => void;
  ready?: boolean;
  authError?: string;
}

function EventIllustration(): JSX.Element {
  return (
    <svg className="sc-intro-scene" viewBox="0 -65 680 450" role="img" aria-labelledby="sc-intro-scene-title">
      <title id="sc-intro-scene-title">活动空间概念插画：温暖灯光下的交流桌椅、舞台和绿植</title>
      <defs>
        <linearGradient id="sc-intro-wall" x1="0" x2="0" y1="0" y2="1">
          <stop stopColor="#e3dccd" /><stop offset="1" stopColor="#f4efdf" />
        </linearGradient>
        <linearGradient id="sc-intro-floor" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#fdf9ec" /><stop offset="1" stopColor="#e5dcc8" />
        </linearGradient>
        <radialGradient id="sc-intro-glow">
          <stop stopColor="#ffda83" stopOpacity=".52" /><stop offset="1" stopColor="#ffda83" stopOpacity="0" />
        </radialGradient>
        <filter id="sc-intro-shadow" x="-30%" y="-30%" width="170%" height="190%">
          <feDropShadow dx="0" dy="18" stdDeviation="15" floodColor="#695e3f" floodOpacity=".1" />
        </filter>
        <g id="sc-intro-chair">
          <path d="M-10-7v12m20-12v12M-10 3v14m20-14v14" stroke="#466150" strokeWidth="3" />
          <path d="m-14-3 14-8 14 8-14 8z" fill="#809880" />
          <path d="m-14-3 14 8v7l-14-8z" fill="#506e59" />
          <path d="m0 5 14-8v7L0 12z" fill="#64816a" />
          <path d="M-14-3v-17l14 8V5" fill="#a1b39a" stroke="#7e967d" strokeLinejoin="round" />
        </g>
        <g id="sc-intro-table">
          <ellipse cy="14" rx="47" ry="22" fill="#95866c" opacity=".12" />
          <path d="M-26-5v36M26-5v36M0 7v37" stroke="#947d5d" strokeWidth="5" />
          <ellipse rx="44" ry="23" fill="#b49973" />
          <ellipse cy="-4" rx="44" ry="23" fill="#e8ce9f" />
          <ellipse cy="-5" rx="8" ry="4" fill="#a69374" />
          <path d="M-5-6v-11h10v11c0 4-10 4-10 0" fill="#f7f0dc" />
          <path d="M0-17v-11m0 8-8-8m8 5 7-7" stroke="#6d885b" strokeWidth="2" />
          <ellipse cx="-7" cy="-28" rx="5" ry="3" fill="#819765" transform="rotate(20 -7 -28)" />
          <ellipse cx="7" cy="-30" rx="5" ry="3" fill="#607c53" transform="rotate(-20 7 -30)" />
        </g>
        <g id="sc-intro-plant">
          <ellipse cy="8" rx="21" ry="9" fill="#8c7b62" opacity=".13" />
          <path d="m-16-17 5 29h22l5-29z" fill="#c3a78b" /><ellipse cy="-17" rx="16" ry="7" fill="#a18468" />
          <path d="M0-17v-49m0 28-18-18m18 7 17-17" stroke="#5f7950" strokeWidth="3" />
          <ellipse cx="-17" cy="-55" rx="9" ry="18" fill="#759168" transform="rotate(-42 -17 -55)" />
          <ellipse cx="16" cy="-64" rx="9" ry="19" fill="#64825b" transform="rotate(38 16 -64)" />
          <ellipse cy="-72" rx="9" ry="20" fill="#8ca779" transform="rotate(-8 0 -72)" />
        </g>
      </defs>
      <g filter="url(#sc-intro-shadow)">
        <path d="m67 214 278-158 272 157-278 160z" fill="#d4cbb7" />
        <path d="m67 203 278-158 272 157-278 159z" fill="url(#sc-intro-floor)" />
        <path d="M67 203V105L345-53V45z" fill="url(#sc-intro-wall)" />
        <path d="M345 45V-53l272 157v98z" fill="#e6e0d1" />
        <path d="m95 224 250-144 244 141M156 259 403 116m-175 184 246-144m-175 185 245-144" fill="none" stroke="#c7bca7" strokeWidth="1" opacity=".38" />
        <path d="m97 187 242 140m-180-176 242 140m-180-176 242 140m-180-176 242 140" fill="none" stroke="#c7bca7" strokeWidth="1" opacity=".3" />
        <path d="M345-53v98" stroke="#cfc7b8" strokeWidth="2" />
        <path d="m379 29 133 77v65l-133-77z" fill="#536b57" />
        <path d="m390 47 111 64m-111-43 68 39" stroke="#e5e5cd" strokeWidth="3" opacity=".8" />
        <path d="m355 130 149 86 53-30-149-87z" fill="#c4b192" />
        <path d="m355 130 149 86v14l-149-86z" fill="#ac9575" />
        <path d="m504 216 53-30v14l-53 30z" fill="#998064" />
        <ellipse cx="227" cy="229" rx="123" ry="64" fill="url(#sc-intro-glow)" />
        <ellipse cx="449" cy="213" rx="125" ry="55" fill="url(#sc-intro-glow)" />
        <use href="#sc-intro-chair" x="194" y="178" /><use href="#sc-intro-chair" x="253" y="170" />
        <use href="#sc-intro-table" x="226" y="196" />
        <use href="#sc-intro-chair" x="187" y="221" /><use href="#sc-intro-chair" x="262" y="213" />
        <use href="#sc-intro-chair" x="341" y="263" /><use href="#sc-intro-chair" x="395" y="245" />
        <use href="#sc-intro-table" x="371" y="280" />
        <use href="#sc-intro-chair" x="333" y="304" /><use href="#sc-intro-chair" x="410" y="297" />
        <use href="#sc-intro-plant" x="129" y="197" /><use href="#sc-intro-plant" x="564" y="218" />
        <path d="M178 125V44m112 18V-3m226 164V95" stroke="#a7977e" strokeWidth="1.5" />
        <path d="m178 118-19 13c0 11 38 11 38 0z" fill="#ead6a3" />
        <ellipse cx="178" cy="132" rx="19" ry="6" fill="#ffe8ad" />
        <path d="m290 55-19 13c0 11 38 11 38 0z" fill="#ead6a3" />
        <ellipse cx="290" cy="69" rx="19" ry="6" fill="#ffe8ad" />
        <path d="m516 154-16 12c0 9 32 9 32 0z" fill="#e1c888" />
        <ellipse cx="516" cy="167" rx="16" ry="5" fill="#ffe8ad" />
      </g>
    </svg>
  );
}

export function IntroPage({ controller, onEnter, onAuthenticated = onEnter, ready = true, authError = '' }: IntroPageProps): JSX.Element {
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
        ? '暂时无法连接登录服务，请稍后重试，也可以先体验本地工作台。'
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
    <main className="sc-intro">
      <header className="sc-intro-header">
        <a className="sc-intro-brand" href="/introduction" aria-label="打开幕景官网"><span className="sc-intro-brand-icon" aria-hidden="true"><BrandMark size={23} /></span><span>幕景<span className="sc-intro-wordmark">SCENDANCE</span></span></a>
        <span className="sc-intro-version">活动空间工作台 <span>v1.0.0 · 图纸重建预览</span></span>
      </header>

      <div className="sc-intro-content">
        <section className="sc-intro-story" aria-labelledby="sc-intro-title">
          <p className="sc-intro-eyebrow"><span aria-hidden="true" />让每一个活动想法，都有落脚的地方</p>
          <h1 id="sc-intro-title">为相聚，<br />留<span>一方空间。</span></h1>
          <p className="sc-intro-description">上传图纸或现场照片，补充实测尺寸和活动需求，<br className="sc-intro-desktop-break" />核对空间结构，再在三维场景里完善你的方案。</p>
          <figure className="sc-intro-visual">
            <div className="sc-intro-visual-label"><span aria-hidden="true" />从一个想法，到一个空间</div>
            <EventIllustration />
            <figcaption>活动空间概念示意 · 实际方案由你来布置</figcaption>
          </figure>
          <ol className="sc-intro-steps" aria-label="幕景使用流程">
            <li><ImagePlus size={18} aria-hidden="true" /><div><span>01 / 提供资料</span><p>上传图纸或照片，填写尺寸与需求</p></div></li>
            <li><Box size={18} aria-hidden="true" /><div><span>02 / 布置空间</span><p>在三维画布里调整物料</p></div></li>
            <li><Layers3 size={18} aria-hidden="true" /><div><span>03 / 保存方案</span><p>保存草稿，继续完善细节</p></div></li>
          </ol>
        </section>

        <section id="sign-in" className="sc-intro-login" aria-labelledby="sc-intro-login-title">
          {!cloud.user && <div className="sc-intro-auth-tabs" role="group" aria-label="登录或注册">
            <button type="button" aria-pressed={!signUp} disabled={busy} onClick={() => changeMode(false)}>Sign in · 登录</button>
            <button type="button" aria-pressed={signUp} disabled={busy} onClick={() => changeMode(true)}>Sign up · 注册</button>
          </div>}
          <h2 id="sc-intro-login-title">{cloud.user ? '欢迎来到幕景' : verificationEmail ? '确认你的邮箱' : signUp ? '创建你的工作室' : '欢迎回来'}</h2>
          <p className="sc-intro-login-copy">{cloud.user ? '一个空间，装下你的下一场相聚。' : verificationEmail ? `请输入发送至 ${verificationEmail} 的六位验证码。` : signUp ? '确认邮箱后，即可拥有独立的场景工作室。' : '登录后，继续你的场景。'}</p>
          {cloud.user ? (
            <div className="sc-intro-signed-in">
              <p className="sc-intro-account-caption">当前已登录</p>
              <p className="sc-intro-account">{cloud.user.is_anonymous ? '访客' : cloud.user.email ?? '工作室账号'}</p>
              <button className="sc-intro-primary" type="button" onClick={onAuthenticated}>进入工作台<ArrowRight size={18} aria-hidden="true" /></button>
            </div>
          ) : (
            <>
              <form className="sc-intro-form" aria-label={verificationEmail ? '邮箱验证' : signUp ? '工作室注册' : '工作室登录'} onSubmit={(event) => { void submit(event); }} aria-busy={busy}>
                {verificationEmail ? <>
                  <label htmlFor="sc-intro-code">六位验证码</label>
                  <input id="sc-intro-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} disabled={busy} required />
                </> : <>
                  {signUp && <>
                    <label htmlFor="sc-intro-name">如何称呼你</label>
                    <input id="sc-intro-name" autoComplete="nickname" maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="你的名字" disabled={busy} required />
                  </>}
                  <label htmlFor="sc-intro-email">邮箱</label>
                  <input id="sc-intro-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} required />
                  <label htmlFor="sc-intro-password">密码</label>
                  <input id="sc-intro-password" name="password" type="password" autoComplete={signUp ? 'new-password' : 'current-password'} minLength={signUp ? 12 : undefined} placeholder={signUp ? '至少 12 位' : '输入你的密码'} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} required />
                </>}
                {(error || authError) && <p className="sc-intro-error" role="alert">{error || authError}</p>}
                <button className="sc-intro-primary" type="submit" disabled={!ready || !cloud.configured || busy}>{busy ? (signUp ? '正在处理…' : '正在登录…') : !ready ? '正在恢复会话…' : verificationEmail ? '验证并进入工作室' : signUp ? '创建账号' : '登录并进入工作台'}<ArrowRight size={18} aria-hidden="true" /></button>
              </form>
              <div className="sc-intro-auth-links">
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
              {notice && <p className="sc-intro-notice" role="status">{notice}</p>}
              {!cloud.configured && <p className="sc-intro-offline" role="status">登录服务尚未配置，暂时只能本地体验。</p>}
              <div className="sc-intro-separator"><span>或</span></div>
              <button className="sc-intro-secondary" type="button" onClick={() => { void enterAsGuest(); }} disabled={busy || !ready || !cloud.configured}>{guestBusy ? '正在进入…' : '访客进入'}<ArrowRight size={17} aria-hidden="true" /></button>
              <p className="sc-intro-local-note">无需注册，享有普通用户功能。访客身份保留在此浏览器，退出或清除浏览器数据后失效。</p>
              <div className="sc-intro-auth-links"><button type="button" onClick={onEnter} disabled={busy}>先体验本地工作台</button></div>
            </>
          )}
          <div className="sc-intro-login-footer"><LockKeyhole size={14} aria-hidden="true" /><span>每位用户拥有独立身份与私有项目</span></div>
        </section>
      </div>

      <footer className="sc-intro-footer"><span>SCENDANCE / 为相聚，留一方空间。</span><span>想法从这里落地。</span></footer>
    </main>
  );
}
