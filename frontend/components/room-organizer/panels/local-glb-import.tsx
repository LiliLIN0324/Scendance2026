'use client';

import { useRef, useState, useSyncExternalStore, type DragEvent } from 'react';
import { Pencil, Loader2, Upload } from '@/components/solid-icons';
import { importBrief, importDisplayName, newLocalGlbKey, validateLocalGlbPick } from '../lib/glb-import';
import {
  importLocalGlb,
  listImportedGlbAssets,
  renameImportedGlbAsset,
  subscribeGlbAssets,
  getGlbAssetRevision,
  createGlbCatalogItem,
  type ImportedGlbAsset,
} from '../three/glb-assets';
import { InfoTip } from './info-tip';
import { MaterialSymbol } from './material-symbol';
import type { CatalogItem } from '../lib/types';

/**
 * 本机 GLB 入口：桌面拖拽、手机点选，导入即归一化并落画布。
 * 只认单文件 .glb；导入的模型留在本机本次编辑，刷新后需要重新导入。
 */

export interface LocalGlbImportProps {
  onAdd(item: CatalogItem): void;
  disabled?: boolean;
  /** tile = 旧横条物料轨的一格；card = Agent 面板「物料」卡里的一行。 */
  variant?: 'tile' | 'card';
}

const SERVER_REVISION = () => 0;

/** 会话内一次性的导入缓存键；实现收口在 lib/glb-import.ts（画布「导入 GLB」也用它）。 */
const nowKey = newLocalGlbKey;

const HELP = <>
  只收单文件 .glb。导入时按现有规则归一化：最长边 ≥ 20 判厘米 ×0.01，Z-up 绕 X 转 -90°，
  Box3 底面中心贴原点，尺寸限制 0.005–50 m。落画布后可直接拖动 / 旋转（15° 吸附）/ 缩放（5 cm 步进、0.2×–5×）。
  导入的模型只在本机本次编辑有效，刷新后需重新导入。
</>;

export function LocalGlbImport({ onAdd, disabled = false, variant = 'tile' }: LocalGlbImportProps): JSX.Element {
  useSyncExternalStore(subscribeGlbAssets, getGlbAssetRevision, SERVER_REVISION);
  const imported = listImportedGlbAssets();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  async function importFile(file: File | undefined): Promise<void> {
    if (!file || busy) return;
    const reason = validateLocalGlbPick(file);
    if (reason) { setStatus({ kind: 'error', text: reason }); return; }
    setBusy(true);
    setStatus(null);
    try {
      const asset = await importLocalGlb(file, nowKey());
      setStatus({ kind: 'ok', text: `已导入「${asset.name}」：${importBrief(asset)}。已选中，可拖动 / 旋转 / 缩放；物料面板里也能再放一次。` });
      onAdd(createGlbCatalogItem({
        name: asset.name,
        url: asset.key,
        width: asset.width,
        depth: asset.depth,
        height: asset.height,
        source: 'local_sample',
      }));
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : '模型导入失败，请重试。' });
    } finally {
      setBusy(false);
    }
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault();
    setOver(false);
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;
    if (files.length > 1) setStatus({ kind: 'error', text: '一次只导入一个 .glb；请先删到只剩一个再拖进来。' });
    void importFile(files[0]);
  }

  function addAgain(asset: ImportedGlbAsset): void {
    if (disabled) return;
    onAdd(createGlbCatalogItem({
      name: asset.name,
      url: asset.key,
      width: asset.width,
      depth: asset.depth,
      height: asset.height,
      source: 'local_sample',
    }));
    setStatus({ kind: 'ok', text: `又放了一次「${asset.name}」：${importBrief(asset)}。` });
  }

  function startRename(asset: ImportedGlbAsset): void {
    setRenaming(asset.key);
    setDraft(asset.name);
  }

  function commitRename(): void {
    if (!renaming) return;
    renameImportedGlbAsset(renaming, draft || importDisplayName(''));
    setRenaming(null);
  }

  const message = status && (
    <p className={`sc-material-note sc-glb-status${status.kind === 'error' ? ' sc-warning' : ' sc-note'}`} role={status.kind === 'error' ? 'alert' : 'status'}>
      {status.text}
    </p>
  );

  const renameForm = (asset: ImportedGlbAsset) => (
    <form className="sc-glb-rename" onSubmit={event => { event.preventDefault(); commitRename(); }}>
      <input
        autoFocus
        aria-label={`重命名 ${asset.name}`}
        value={draft}
        maxLength={40}
        onChange={event => setDraft(event.target.value)}
        onBlur={commitRename}
        onKeyDown={event => { if (event.key === 'Escape') setRenaming(null); }}
      />
    </form>
  );

  const hiddenInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".glb,model/gltf-binary"
      className="sc-glb-file"
      aria-label="选择 GLB 模型文件"
      disabled={disabled || busy}
      onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        void importFile(file);
      }}
    />
  );

  if (variant === 'card') {
    return <div className={`sc-glb-bar${over ? ' is-over' : ''}`} onDragOver={event => { event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      {hiddenInput}
      <div className="sc-glb-bar-main">
        <button type="button" className="sc-glb-bar-btn" disabled={disabled || busy} onClick={() => inputRef.current?.click()}>
          {busy ? <Loader2 className="cr-spin" size={14} aria-hidden="true"/> : <Upload size={14} aria-hidden="true"/>}
          <span>{busy ? '归一化中…' : '导入本机模型（GLB）'}</span>
        </button>
        <InfoTip label="关于本机模型导入">本机 GLB 导入说明：{HELP}</InfoTip>
      </div>
      {imported.length > 0 && <ul className="sc-glb-chips" aria-label="本机导入的模型">
        {imported.map(asset => <li className="sc-glb-chip" key={asset.key}>
          {renaming === asset.key
            ? renameForm(asset)
            : <button type="button" className="sc-glb-chip-btn" disabled={disabled} title={`${asset.name}\n${importBrief(asset)}\n点一下再放一次`} onClick={() => addAgain(asset)}>
              <MaterialSymbol name="view_in_ar" size={14}/>
              <span>{asset.name}</span>
            </button>}
          {renaming !== asset.key && <button type="button" className="sc-glb-chip-edit" aria-label={`重命名 ${asset.name}`} title="重命名" onClick={() => startRename(asset)}><Pencil size={12}/></button>}
        </li>)}
      </ul>}
      {message}
    </div>;
  }

  return <>
    {hiddenInput}
    <div
      className={`sc-material-tile sc-material-create${over ? ' is-over' : ''}`}
      onDragOver={event => { event.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <button type="button" className="sc-material-card sc-material-plus sc-glb-entry" aria-label="导入本机模型（GLB）" title="导入本机模型（GLB）\n也可以把单个 .glb 拖到这里\n只收单文件 .glb；导入后按 0.005–50 m 归一化并自动选中" disabled={disabled || busy} onClick={() => inputRef.current?.click()}>
        {busy ? <Loader2 className="cr-spin" size={22} aria-hidden="true"/> : <Upload size={22} aria-hidden="true"/>}
        <span className="sc-material-name">{busy ? '导入中…' : '导入 GLB'}</span>
      </button>
    </div>
    {imported.map(asset => <div className="sc-material-tile sc-glb-tile" key={asset.key}>
      <button type="button" className="sc-material-card" disabled={disabled} title={`${asset.name}\n${importBrief(asset)}\n点一下再放一次`} aria-label={`再放一次 ${asset.name}`} onClick={() => addAgain(asset)}>
        <span className="sc-material-preview"><MaterialSymbol name="view_in_ar" size={22}/></span>
        <span className="sc-material-name">{asset.name}</span>
      </button>
      {renaming === asset.key
        ? renameForm(asset)
        : <button type="button" className="sc-material-star sc-glb-edit" aria-label={`重命名 ${asset.name}`} title="重命名" onClick={() => startRename(asset)}><Pencil size={12}/></button>}
    </div>)}
    {message}
  </>;
}
