'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { uuid } from '../../../../supabase/functions/_shared/domain';
import { useRoomEditor, useSelection } from '../contexts';
import { layoutReducer } from '../hooks/layout-reducer';
import { layoutStore } from '../hooks/use-layout-store';
import { batchLayerEdit, materialLayers, switchDesign } from '../lib/scene-layers';
import { canApplyLayoutGeometry } from '../lib/structural-layout';
import { ensureGlbAsset } from '../three/glb-assets';
import type { RoomLayout } from '../lib/types';
import type { BackendSession } from '@/lib/backend-session';

const ZERO_DELTA = { x: '0', y: '0', z: '0' };

export function SceneLayersPanel({ controller, onPreview }: { controller?: BackendSession; onPreview?(layout: RoomLayout | null): void }): JSX.Element {
  const { layout, activeFloor, activeFloorIndex, actions, history } = useRoomEditor();
  const { allSelectedIds, setSelectedItemId, setExtraSelectedIds, selectOnly } = useSelection();
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const selectionKey = JSON.stringify([...allSelectedIds].sort());
  const [draft, setDraft] = useState<{ base: RoomLayout; floorIndex: number; selectionKey: string; ids: string[]; delta: typeof ZERO_DELTA } | null>(null);
  const currentDraft = draft?.base === layout && draft.floorIndex === activeFloorIndex && draft.selectionKey === selectionKey ? draft : null;
  useEffect(() => { if (draft && !currentDraft) setDraft(null); }, [draft, currentDraft]);
  const delta = currentDraft?.delta ?? ZERO_DELTA;
  const movement = useMemo(() => {
    if (!currentDraft) return { candidate: null, error: '' };
    const values = Object.values(currentDraft.delta);
    if (values.some(value => value.trim() === '' || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 100)) return { candidate: null, error: '请输入 −100 到 100 米之间的位移。' };
    const offset = { x: Number(currentDraft.delta.x), y: Number(currentDraft.delta.y), z: Number(currentDraft.delta.z) };
    if (!offset.x && !offset.y && !offset.z) return { candidate: null, error: '' };
    try {
      const original = layout.floors[activeFloorIndex]!.items;
      const items = batchLayerEdit(original, new Set(currentDraft.ids), offset);
      if (items.every((item, index) => item === original[index])) return { candidate: null, error: '所选物料均已锁定或属于固定结构，无法移动。' };
      // Preview uses the same validation and bounds as the eventual commit.
      const candidate = layoutReducer({ layout, activeFloorIndex }, { type: 'replaceItems', items }).layout;
      if (candidate === layout) return { candidate: null, error: '移动与墙体、柱子或场地边界冲突，整组保持原位。' };
      return { candidate, error: '' };
    } catch (error) { return { candidate: null, error: error instanceof Error ? error.message : '无法预览移动，原布置已保留。' }; }
  }, [currentDraft, layout, activeFloorIndex]);
  useEffect(() => {
    onPreview?.(movement.candidate);
    return () => onPreview?.(null);
  }, [movement.candidate, onPreview]);
  const [color, setColor] = useState('#78958b');
  const layers = materialLayers(activeFloor.items);
  const available = new Set(layers.flatMap(layer => layer.itemIds));
  const custom = layout.itemLayers ?? [];
  const select = (ids: string[]) => {
    const [first, ...rest] = ids.filter(id => available.has(id));
    setSelectedItemId(first ?? null); setExtraSelectedIds(new Set(rest));
  };
  const applyBatch = (paint: boolean) => {
    try {
    if (!paint && !movement.candidate) return;
    const items = paint ? batchLayerEdit(activeFloor.items, allSelectedIds, { x: 0, y: 0, z: 0, color }) : movement.candidate!.floors[activeFloorIndex]!.items;
    const next = { ...layout, floors: layout.floors.map((floor, index) => index === activeFloorIndex ? { ...floor, items } : floor) };
    if (!canApplyLayoutGeometry(layout, next)) { setNotice('移动与墙体、柱子或场地边界冲突，整组保持原位。'); return; }
    actions.replaceItems(items); setDraft(null); setNotice(paint ? '已修改可改色物料；锁定物料和自带材质模型保持原样。' : '已批量移动可编辑物料。');
    } catch (error) { setNotice(error instanceof Error ? error.message : '批量修改失败，原布置已保留。'); }
  };
  const chooseDesign = async (id: string) => {
    const base = layoutStore.getState();
    const next = switchDesign(base.layout, id);
    if (next === base.layout) return;
    setBusy(true); setNotice('');
    const scope = controller?.getSnapshot();
    try {
      const urls = new Map<string, string>();
      await Promise.all(next.floors.flatMap(f => f.items).filter(i => i.glbUrl).map(async item => {
        const key = item.assetId ?? item.glbUrl!;
        const url = controller && scope?.user && uuid.safeParse(item.assetId).success ? (await controller.authorizeAsset(item.assetId!)).url : item.glbUrl!;
        await ensureGlbAsset(key, url); urls.set(key, url);
      }));
      if (!alive.current) return;
      if (controller?.getSnapshot().user?.id !== scope?.user?.id || controller?.getSnapshot().project?.id !== scope?.project?.id) throw new Error('项目或账号已变化，请重新选择方案。');
      if (layoutStore.getState() !== base) throw new Error('加载期间场景已变化，请重新选择方案。');
      actions.applyLayout({ ...next, floors: next.floors.map(floor => ({ ...floor, items: floor.items.map(item => item.glbUrl ? { ...item, glbUrl: urls.get(item.assetId ?? item.glbUrl)! } : item) })) }); selectOnly(null);
    } catch (error) { if (alive.current) setNotice(error instanceof Error ? error.message : '方案加载失败，当前布置已保留。'); }
    finally { if (alive.current) setBusy(false); }
  };
  const row = (layer: { id: string; name: string; itemIds: string[] }, removable = false) => <div key={layer.id} className="sc-layer-branch"><div className="sc-layer-row">
    <button type="button" className={layer.itemIds.length > 0 && layer.itemIds.every(id => allSelectedIds.has(id)) ? 'is-selected' : ''} onClick={() => select(layer.itemIds)}><span>{layer.name}</span><small>{layer.itemIds.filter(id => available.has(id)).length}</small></button>
    {removable && <button type="button" aria-label={`删除图层 ${layer.name}`} onClick={() => actions.applyLayout({ ...layout, itemLayers: custom.filter(l => l.id !== layer.id) })}>×</button>}
    </div><details><summary>查看物料</summary><ul>{activeFloor.items.filter(item => layer.itemIds.includes(item.id)).map((item, index) => <li key={item.id}><button type="button" aria-pressed={allSelectedIds.has(item.id)} onClick={() => selectOnly(item.id)}>{index + 1}. {item.name}{item.locked ? ' · 已锁定' : ''}</button></li>)}</ul></details>
  </div>;
  return <section className="sc-layers" aria-label="方案与图层">
    <h2>方案与图层</h2><p className="sc-note">方案历史和编组保存在本机，云端保存当前场景。切换方案后可继续编辑并保存到云端。</p>
    {layout.designBook?.variants.map(variant => <div key={variant.id} className="sc-design-row">
      <button type="button" aria-pressed={variant.id === layout.designBook!.activeId} disabled={busy} onClick={() => void chooseDesign(variant.id)}>{variant.name}<small>{variant.id === layout.designBook!.activeId ? '当前' : '切换'}</small></button>
      {variant.id !== layout.designBook!.activeId && <button type="button" aria-label={`移除方案 ${variant.name}`} disabled={busy} onClick={() => {
        if (!window.confirm(`移除本机保留的“${variant.name}”？当前场景不受影响，可撤销恢复。`)) return;
        actions.applyLayout({ ...layout, designBook: { ...layout.designBook!, variants: layout.designBook!.variants.filter(v => v.id !== variant.id) } });
      }}>×</button>}
    </div>)}
    <div className="sc-layer-tree"><button type="button" className="sc-layer-root" onClick={() => select([...available])}>{layout.designBook?.variants.find(v => v.id === layout.designBook!.activeId)?.name ?? '当前方案'} · 全部物料 <small>{available.size}</small></button>
      {layers.map(layer => row(layer))}{custom.map(layer => row(layer, true))}
    </div>
    <form className="sc-layer-create" onSubmit={event => {
      event.preventDefault(); if (!name.trim() || custom.length >= 100) return;
      actions.applyLayout({ ...layout, itemLayers: [...custom, { id: crypto.randomUUID(), name: name.trim(), itemIds: [...allSelectedIds].filter(id => available.has(id)) }] }); setName('');
    }}><label>自建图层<input aria-label="新图层名称" value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder="例如：舞台区"/></label><button type="submit" disabled={!name.trim() || custom.length >= 100}>用已选物料创建</button></form>
    {custom.length > 0 && <label className="sc-field">将已选物料加入图层<select aria-label="将已选物料加入图层" value="" disabled={allSelectedIds.size === 0} onChange={event => actions.applyLayout({ ...layout, itemLayers: custom.map(layer => layer.id === event.target.value ? { ...layer, itemIds: [...new Set([...layer.itemIds, ...allSelectedIds])].filter(id => available.has(id)) } : layer) })}><option value="">选择图层</option>{custom.map(layer => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select></label>}
    <fieldset disabled={allSelectedIds.size === 0}><legend>批量编辑 · 已选 {allSelectedIds.size} 件</legend>
      <p className="sc-note">X、Y 沿水平面移动，Z 竖直升降。输入位移可预览，确认后应用。</p>
      <div className="sc-dimension-grid">{(['x', 'y', 'z'] as const).map(axis => <label key={axis} className="sc-field">{axis.toUpperCase()} 位移 / m<input aria-label={`图层 ${axis.toUpperCase()} 位移`} type="number" min={-100} max={100} step={0.1} value={delta[axis]} onChange={event => { setNotice(''); setDraft({ base: layout, floorIndex: activeFloorIndex, selectionKey, ids: [...allSelectedIds], delta: { ...delta, [axis]: event.target.value } }); }}/></label>)}</div>
      <button type="button" disabled={!movement.candidate} onClick={() => applyBatch(false)}>移动已选物料</button>
      <button type="button" disabled={!currentDraft} onClick={() => { setDraft(null); setNotice(''); }}>取消移动预览</button>
      {movement.error && <p role="alert" className="sc-note">{movement.error}</p>}
      <label className="sc-layer-color">统一颜色<input type="color" aria-label="图层颜色" value={color} onChange={event => setColor(event.target.value)}/><button type="button" onClick={() => applyBatch(true)}>应用颜色</button></label>
      <p className="sc-note">可直接拖动选中物料进行整体移动。锁定物料不参与修改；模型保留自身材质。</p>
    </fieldset>
    {notice && <p role="status" className="sc-note">{notice}</p>}
    <button type="button" disabled={!history.canUndo} onClick={history.undo}>撤销上一步</button>
  </section>;
}
