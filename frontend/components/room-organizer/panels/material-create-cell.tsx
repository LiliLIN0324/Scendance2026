'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles } from '@/components/solid-icons';
import { addPendingMaterial, submitMaterialGenerate, type MaterialCloudLane } from '../lib/material-generate';
import { CREDIT_CONFIRM_LABEL } from '../lib/site-recon-mock';
import type { BackendSession } from '@/lib/backend-session';

/**
 * 物料生成的「＋」。菜单只有两条：描述生成、拍照/图片生成。
 * 直连代理在就优先走它（本机加速）；不在就走云端任务队列，GLB 由服务端归档后自动进画布。
 * variant='composer' 是底部对话左下角的那一颗；'tile' 给旧的横条物料轨。
 */
export function MaterialCreateCell({ disabled = false, variant = 'composer', controller, openBelow = false, importSlot }: {
  disabled?: boolean;
  openBelow?: boolean;
  variant?: 'tile' | 'composer' | 'action' | 'chat';
  importSlot?: ReactNode;
  /** 登录云项目后的会话：生成走服务端队列，不依赖本机脚本。 */
  controller?: BackendSession;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'menu' | 'text' | 'image' | 'import'>('menu');
  const [prompt, setPrompt] = useState('');
  const [credit, setCredit] = useState(false);
  const [needCredit, setNeedCredit] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [imageName, setImageName] = useState('');
  const imageRef = useRef('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const inline = variant === 'chat';
  const choose = (next: 'menu' | 'text' | 'image' | 'import') => {
    setMode(next);
    setNote('');
    setCredit(false);
    setNeedCredit(false);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const rect = open ? buttonRef.current?.getBoundingClientRect() : undefined;
  const close = () => { setOpen(false); setMode('menu'); setNote(''); setNeedCredit(false); };

  /** 云端队列：登录后走服务端，GLB 归档完由生成面板自动放进画布。 */
  const cloud: MaterialCloudLane | undefined = controller ? {
    createJob: (text, options) => controller.createGenerationJob(text, crypto.randomUUID(), { ...options, provider: 'aholo' }),
    uploadReference: file => controller.uploadGenerationReference(file),
  } : undefined;

  async function submitText() {
    const text = prompt.trim();
    if (!text || busy) return;
    if (!credit) { setNeedCredit(true); return; }
    setBusy(true);
    setNote('');
    const result = await submitMaterialGenerate({ kind: 'text', prompt: text }, cloud ? { cloud } : {});
    setBusy(false);
    if (!result.ok) { setNote(result.message); if (!result.stub) setCredit(false); return; }
    setPrompt('');
    setCredit(false);
    if (result.lane === 'cloud') {
      setNote('已开始生成。完成后会自动加入画布。');
      return;
    }
    addPendingMaterial({ id: `pending:${result.taskid}`, name: text, shipped: false });
    setNote('已开始生成。完成后可在「我的生成」查看。');
  }

  async function submitImage() {
    if (!imageRef.current || busy) return;
    if (!credit) { setNeedCredit(true); return; }
    setBusy(true);
    setNote('');
    const result = await submitMaterialGenerate({ kind: 'image', imageDataUrl: imageRef.current, prompt: imageName || '图片物料' }, cloud ? { cloud } : {});
    setBusy(false);
    if (!result.ok) { setNote(result.message); if (!result.stub) setCredit(false); return; }
    imageRef.current = '';
    setImageName('');
    setCredit(false);
    if (result.lane === 'cloud') {
      setNote('已开始生成。完成后会自动加入画布。');
      return;
    }
    addPendingMaterial({ id: `pending:${result.taskid}`, name: imageName || '图片物料', shipped: false });
    setNote('已开始生成。完成后可在「我的生成」查看。');
  }

  function pickImage(file: File | undefined) {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) {
      setNote('请选择不超过 5 MB 的 PNG 或 JPEG 图片。');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        imageRef.current = reader.result;
        setImageName(file.name);
        setNote('');
      }
    };
    reader.onerror = () => setNote('图片读取失败，请重新选择。');
    reader.readAsDataURL(file);
  }

  const trigger = <button
    type="button"
    ref={buttonRef}
    className={variant === 'tile' ? 'sc-material-card sc-material-plus' : variant === 'action' ? 'ap-gen-chip' : 'ap-plus-btn ap-generate-btn'}
    aria-label="生成物料"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls={open ? menuId : undefined}
    disabled={disabled}
    onClick={() => { setOpen(value => !value); setMode('menu'); }}
  >
    {variant !== 'tile'
      ? <><Sparkles size={15} aria-hidden="true"/>{variant === 'action' && '生成物料'}</>
      : <><span className="sc-material-plus-mark" aria-hidden="true">＋</span><span className="sc-material-name">生成</span></>}
  </button>;

  const panel = <div
      ref={panelRef}
      id={menuId}
      className={`sc-material-create-menu${inline ? ' is-inline' : ''}`}
      role={inline ? 'group' : mode === 'menu' ? 'menu' : 'dialog'}
      aria-label={mode === 'image' ? '拍照/图片生成物料' : mode === 'text' ? '通过描述生成物料' : '生成物料'}
      style={rect ? {
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 290)),
        ...(openBelow ? { top: rect.bottom + 8 } : { bottom: Math.max(8, window.innerHeight - rect.top + 8) }),
      } : undefined}
    >
      {mode === 'menu' && (inline ? <>
        <p>你想怎么添加物料？</p>
        <div className="sc-library-chat-choices">
          {importSlot && <button type="button" onClick={() => choose('import')}>导入素材</button>}
          <button type="button" onClick={() => choose('text')}>用描述生成</button>
          <button type="button" onClick={() => choose('image')}>用图片生成</button>
        </div>
      </> : <>
        <button type="button" role="menuitem" onClick={() => choose('text')}>通过描述生成物料</button>
        <button type="button" role="menuitem" onClick={() => choose('image')}>拍照/图片生成物料</button>
      </>)}
      {mode === 'import' && <>{importSlot}<button type="button" onClick={() => choose('menu')}>返回</button></>}
      {mode === 'text' && <form onSubmit={event => { event.preventDefault(); void submitText(); }}>
        <label className="sc-material-create-field">描述<textarea rows={3} maxLength={200} value={prompt} disabled={busy} aria-label="物料描述" placeholder="例如：一把沙滩折叠椅" onChange={event => setPrompt(event.target.value)}/></label>
        <CreditRow checked={credit} disabled={busy} invalid={needCredit && !credit} onChange={value => { setCredit(value); if (value) setNeedCredit(false); }}/>
        <div className="sc-material-create-actions">
          <button type="button" disabled={busy} onClick={() => choose('menu')}>返回</button>
          <button type="submit" disabled={busy || !prompt.trim()}>{busy ? '提交中…' : '生成'}</button>
        </div>
      </form>}
      {mode === 'image' && <form onSubmit={event => { event.preventDefault(); void submitImage(); }}>
        <label className="sc-material-create-field">照片或图片
          <input type="file" accept="image/png,image/jpeg" aria-label="物料图片" disabled={busy} onChange={event => pickImage(event.target.files?.[0])}/>
        </label>
        {imageName && <p className="sc-note">{imageName}</p>}
        <CreditRow checked={credit} disabled={busy} invalid={needCredit && !credit} onChange={value => { setCredit(value); if (value) setNeedCredit(false); }}/>
        <div className="sc-material-create-actions">
          <button type="button" disabled={busy} onClick={() => choose('menu')}>返回</button>
          <button type="submit" disabled={busy || !imageName}>{busy ? '提交中…' : '生成'}</button>
        </div>
      </form>}
      {note && <p className="sc-note" role="status">{note}</p>}
      {!inline && mode !== 'menu' && <button type="button" className="sc-material-create-dismiss" onClick={close}>收起</button>}
    </div>;
  if (inline) return panel;
  return <div className={variant !== 'tile' ? 'ap-generate' : 'sc-material-tile sc-material-create'}>
    {trigger}
    {open && typeof document !== 'undefined' && createPortal(panel, document.body)}
  </div>;
}

function CreditRow({ checked, disabled, invalid, onChange }: { checked: boolean; disabled: boolean; invalid: boolean; onChange(value: boolean): void }): JSX.Element {
  return <label className="sc-material-create-credit">
    <input type="checkbox" checked={checked} disabled={disabled} aria-invalid={invalid} aria-label={CREDIT_CONFIRM_LABEL} onChange={event => onChange(event.target.checked)}/>
    <span>确认扣额度后才会提交</span>
  </label>;
}
