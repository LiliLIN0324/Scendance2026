'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { submitMaterialGenerate } from '../lib/material-generate';
import { CREDIT_CONFIRM_LABEL } from '../lib/site-recon-mock';

/**
 * 物料横条最前面的大「＋」。菜单只有两条：描述生成、拍照/图片生成。
 * 提交走现有 Aholo 文生和图生；代理没开时只说明，不提交。
 */
export function MaterialCreateCell({ disabled = false, onAccepted }: {
  disabled?: boolean;
  onAccepted?(item: { id: string; name: string }): void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'menu' | 'text' | 'image'>('menu');
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

  async function submitText() {
    const text = prompt.trim();
    if (!text || busy) return;
    if (!credit) { setNeedCredit(true); return; }
    setBusy(true);
    setNote('');
    const result = await submitMaterialGenerate({ kind: 'text', prompt: text });
    setBusy(false);
    if (!result.ok) { setNote(result.message); if (!result.stub) setCredit(false); return; }
    onAccepted?.({ id: `pending:${result.taskid}`, name: text });
    setPrompt('');
    setCredit(false);
    setNote(`已提交描述生成（任务 ${result.taskid}）。完成后带「生成」标签留在这个物料库。`);
  }

  async function submitImage() {
    if (!imageRef.current || busy) return;
    if (!credit) { setNeedCredit(true); return; }
    setBusy(true);
    setNote('');
    const result = await submitMaterialGenerate({ kind: 'image', imageDataUrl: imageRef.current });
    setBusy(false);
    if (!result.ok) { setNote(result.message); if (!result.stub) setCredit(false); return; }
    onAccepted?.({ id: `pending:${result.taskid}`, name: imageName || '图片物料' });
    imageRef.current = '';
    setImageName('');
    setCredit(false);
    setNote(`已提交图片生成（任务 ${result.taskid}，Aholo /image-to-3d）。完成后带「生成」标签留在这个物料库。`);
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

  return <div className="sc-material-tile sc-material-create">
    <button
      type="button"
      ref={buttonRef}
      className="sc-material-card sc-material-plus"
      aria-label="生成物料"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      disabled={disabled}
      onClick={() => { setOpen(value => !value); setMode('menu'); }}
    >
      <span className="sc-material-plus-mark" aria-hidden="true">＋</span>
      <span className="sc-material-name">生成</span>
    </button>
    {open && typeof document !== 'undefined' && createPortal(<div
      ref={panelRef}
      id={menuId}
      className="sc-material-create-menu"
      role={mode === 'menu' ? 'menu' : 'dialog'}
      aria-label={mode === 'image' ? '拍照/图片生成物料' : mode === 'text' ? '通过描述生成物料' : '生成物料'}
      style={rect ? { left: Math.max(8, rect.left), bottom: Math.max(8, window.innerHeight - rect.top + 8) } : undefined}
    >
      {mode === 'menu' && <>
        <button type="button" role="menuitem" onClick={() => { setMode('text'); setNote(''); }}>通过描述生成物料</button>
        <button type="button" role="menuitem" onClick={() => { setMode('image'); setNote(''); }}>拍照/图片生成物料</button>
      </>}
      {mode === 'text' && <form onSubmit={event => { event.preventDefault(); void submitText(); }}>
        <label className="sc-material-create-field">描述<textarea rows={3} maxLength={200} value={prompt} disabled={busy} aria-label="物料描述" placeholder="例如：一把沙滩折叠椅" onChange={event => setPrompt(event.target.value)}/></label>
        <CreditRow checked={credit} disabled={busy} invalid={needCredit && !credit} onChange={value => { setCredit(value); if (value) setNeedCredit(false); }}/>
        <div className="sc-material-create-actions">
          <button type="button" onClick={() => setMode('menu')}>返回</button>
          <button type="submit" disabled={busy || !prompt.trim()}>{busy ? '提交中…' : '生成'}</button>
        </div>
      </form>}
      {mode === 'image' && <form onSubmit={event => { event.preventDefault(); void submitImage(); }}>
        <label className="sc-material-create-field">照片或图片
          <input type="file" accept="image/png,image/jpeg" aria-label="物料图片" disabled={busy} onChange={event => pickImage(event.target.files?.[0])}/>
        </label>
        {imageName && <p className="sc-note">{imageName}</p>}
        <p className="sc-note">图片交给 Aholo 图生（/image-to-3d）。不在这里填写密钥。</p>
        <CreditRow checked={credit} disabled={busy} invalid={needCredit && !credit} onChange={value => { setCredit(value); if (value) setNeedCredit(false); }}/>
        <div className="sc-material-create-actions">
          <button type="button" onClick={() => setMode('menu')}>返回</button>
          <button type="submit" disabled={busy || !imageName}>{busy ? '提交中…' : '生成'}</button>
        </div>
      </form>}
      {note && <p className="sc-note" role="status">{note}</p>}
      {mode !== 'menu' && <button type="button" className="sc-material-create-dismiss" onClick={close}>收起</button>}
    </div>, document.body)}
  </div>;
}

function CreditRow({ checked, disabled, invalid, onChange }: { checked: boolean; disabled: boolean; invalid: boolean; onChange(value: boolean): void }): JSX.Element {
  return <label className="sc-material-create-credit">
    <input type="checkbox" checked={checked} disabled={disabled} aria-invalid={invalid} aria-label={CREDIT_CONFIRM_LABEL} onChange={event => onChange(event.target.checked)}/>
    <span>确认扣额度后才会提交</span>
  </label>;
}
