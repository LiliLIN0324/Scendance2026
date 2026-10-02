'use client';

import { useState } from 'react';
import { useAuth, useEmailCooldown } from '@/lib/auth-provider';
import { useBackendSession } from '@/lib/backend-session';

export default function ResetPasswordPage(): JSX.Element {
  const auth = useAuth()!;
  const cloud = useBackendSession(auth.controller);
  const cooldown = useEmailCooldown();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  const requestCode = async () => {
    cooldown.start();
    // Keep the already-allowed callback URL for old link templates as well.
    await auth.controller.requestPasswordReset(email, `${window.location.origin}/auth/callback`);
    setSent(true); cooldown.start();
    setNotice('如果该邮箱已注册，你会收到密码重置邮件。请同时检查垃圾邮件。');
  };

  return <main className="sc-auth-page">
    <a className="sc-auth-brand" href="/introduction#scene">幕景 <span>Scendance</span></a>
    <section className="sc-auth-card">
      <div className="sc-auth-intro"><span>BACK TO YOUR SCENE</span><h1>重新连接，<br />你的创作。</h1><p>验证邮箱后设置新密码，<br />回到你的工作室。</p><a href="/auth">← 返回登录</a></div>
      <div className="sc-auth-form-wrap">
        <h2>{done ? '密码已更新' : cloud.recoveryReady ? '设置新密码' : sent ? '输入验证码' : '找回密码'}</h2>
        <p className="sc-auth-hint">{done ? '请使用新密码重新登录。' : cloud.recoveryReady ? '新密码至少 12 位。刷新页面后需要重新获取验证码。' : sent ? `请输入发送至 ${email.trim()} 的六位验证码。` : '输入注册邮箱，我们会发送六位验证码。'}</p>
        {!done && <form onSubmit={async event => {
          event.preventDefault();
          if (busy) return;
          setBusy(true); setFailed(false); setNotice('');
          try {
            if (cloud.recoveryReady) {
              if (password !== confirmation) throw new Error('两次输入的密码不一致。');
              const result = await auth.controller.updatePassword(password);
              setDone(true);
              setNotice(result.signedOutEverywhere ? '密码已更新，请用新密码登录。' : '密码已更新，但其他设备的退出请求未完成。如有异常登录，请联系管理员。');
            } else if (sent) await auth.controller.verifyEmailCode(email, code, 'recovery');
            else await requestCode();
          } catch (err) { setFailed(true); setNotice(err instanceof Error ? err.message : '操作失败，请稍后重试。'); }
          finally { setPassword(''); setConfirmation(''); setBusy(false); }
        }}>
          {cloud.recoveryReady ? <>
            <label>新密码<input type="password" autoComplete="new-password" minLength={12} value={password} onChange={e => setPassword(e.target.value)} required /></label>
            <label>确认新密码<input type="password" autoComplete="new-password" minLength={12} value={confirmation} onChange={e => setConfirmation(e.target.value)} required /></label>
          </> : sent ? <label>六位验证码<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required /></label> : <label>注册邮箱<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>}
          <button className="sc-auth-submit" type="submit" disabled={busy || !auth.ready || !cloud.configured || !sent && !cloud.recoveryReady && cooldown.remaining > 0}>{busy ? '正在处理…' : cloud.recoveryReady ? '保存新密码' : sent ? '验证邮箱' : cooldown.remaining > 0 ? `${cooldown.remaining} 秒后可发送` : '发送验证码'}</button>
        </form>}
        {!done && !cloud.recoveryReady && <div className="sc-auth-actions">
          {sent ? <>
            <button type="button" disabled={busy || cooldown.remaining > 0} onClick={async () => {
              setBusy(true); setFailed(false); cooldown.start();
              try { await requestCode(); setCode(''); }
              catch (err) { setFailed(true); setNotice(err instanceof Error ? err.message : '发送失败，请稍后重试。'); }
              finally { setBusy(false); }
            }}>{cooldown.remaining > 0 ? `${cooldown.remaining} 秒后可重新发送` : '重新发送验证码'}</button>
            <button type="button" disabled={busy} onClick={() => { setSent(false); setCode(''); setNotice(''); }}>修改邮箱</button>
          </> : <button type="button" disabled={busy || !email.trim()} onClick={() => { setSent(true); setNotice('请输入收到的密码重置验证码，或重新发送。'); }}>输入已有验证码</button>}
        </div>}
        {!done && cloud.recoveryReady && <div className="sc-auth-actions"><button type="button" disabled={busy} onClick={() => { auth.controller.clearPasswordRecovery(); setSent(false); setCode(''); setPassword(''); setConfirmation(''); setNotice(''); }}>重新验证邮箱</button></div>}
        {(notice || auth.error || !cloud.configured) && <p className="sc-auth-notice" role={failed || auth.error || !cloud.configured ? 'alert' : 'status'}>{notice || auth.error || '登录服务尚未配置，请联系管理员。'}</p>}
        {done && <a className="sc-auth-submit" href="/auth">返回登录</a>}
      </div>
    </section>
  </main>;
}
