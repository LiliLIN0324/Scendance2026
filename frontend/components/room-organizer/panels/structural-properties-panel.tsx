'use client';

import { useState, type FormEvent } from 'react';
import { sceneSchema, type SceneV2 } from '../../../../supabase/functions/_shared/domain';
import { measurement } from '../../../../supabase/functions/_shared/structural-geometry';
import { useRoomEditor, useSelection } from '../contexts';
import { backendSceneToLayout, layoutToBackendScene } from '../lib/backend-adapter';
import { mergeProposalPresentation } from '../lib/creative-brief';
import { canApplyLayoutGeometry } from '../lib/structural-layout';
import './structural-properties-panel.css';

type EntityKind = 'wall' | 'opening' | 'column';
const statuses = { detected: '识别待核对', inferred: '推定待核对', confirmed: '已确认' };

/** Explicit structural edits use the same scene contract and collision gate as generation. */
export function StructuralPropertiesPanel(): JSX.Element | null {
  const { layout, actions, history } = useRoomEditor();
  const { selectOnly } = useSelection();
  const [selection, setSelection] = useState('');
  const [notice, setNotice] = useState('');
  if (!layout.backendSceneV2) return null;
  let current: SceneV2;
  try {
    const scene = layoutToBackendScene(layout);
    if (scene.schemaVersion !== 2) return null;
    current = scene;
  } catch { return <p className="sc-warning">结构存在未解决的尺寸冲突，请在图纸核对中修正。</p>; }
  const choices = [
    ...current.structure.walls.map((value, index) => ({ kind: 'wall' as const, value, label: `${value.kind === 'exterior' ? '外墙' : '内墙'} ${index + 1}` })),
    ...current.structure.openings.map((value, index) => ({ kind: 'opening' as const, value, label: `${value.kind === 'door' ? '门' : '窗'} ${index + 1}` })),
    ...current.structure.columns.map((value, index) => ({ kind: 'column' as const, value, label: `柱子 ${index + 1}` })),
  ];
  const selected = choices.find(entry => `${entry.kind}:${entry.value.id}` === selection) ?? choices[0];
  if (!selected) return <p className="sc-note">尚无结构，请先上传资料生成，或核对场地尺寸。</p>;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice('');
    const fields = new FormData(event.currentTarget);
    const read = (key: string) => {
      const raw = fields.get(key);
      if (typeof raw !== 'string' || !raw.trim() || !Number.isFinite(Number(raw))) throw new Error('请填写有效的米制尺寸。');
      return Number(raw);
    };
    try {
      const candidate = structuredClone(current);
      const { id } = selected.value;
      if (selected.kind === 'wall') {
        const wall = candidate.structure.walls.find(value => value.id === id)!;
        wall.thickness = read('thickness');
        wall.height = read('height');
        wall.status = 'confirmed';
      } else if (selected.kind === 'opening') {
        const opening = candidate.structure.openings.find(value => value.id === id)!;
        opening.offset = read('offset');
        opening.width = read('width');
        opening.height = read('height');
        opening.sillHeight = read('sillHeight');
        opening.status = 'confirmed';
      } else {
        const column = candidate.structure.columns.find(value => value.id === id)!;
        column.position = { x: read('x'), z: read('z') };
        column.size = { width: read('width'), depth: read('depth'), height: read('height') };
        column.rotation = read('rotation');
        column.status = 'confirmed';
      }
      // A direct size edit is an explicit replacement of that measured size.
      // Coupled distances (for example two column centres) remain constraints.
      candidate.dimensions = candidate.dimensions.map(dimension => {
        if (dimension.targetId !== id || dimension.targetEndId || ['width','depth','height'].includes(dimension.kind)) return dimension;
        const directSize = selected.kind === 'opening' || selected.kind === 'wall' && dimension.measure === 'height'
          || selected.kind === 'column' && dimension.measure && dimension.measure !== 'length';
        const value = directSize ? measurement(candidate, dimension) : undefined;
        return value === undefined ? dimension : { ...dimension, valueMeters: value, status: 'confirmed' };
      });
      const valid = sceneSchema.safeParse(candidate);
      if (!valid.success) throw new Error(valid.error.issues[0]?.message ?? '结构尺寸不合法。');
      const assetItems = layout.floors.flatMap(floor => floor.items).filter(item => item.assetId && item.glbUrl);
      const converted = backendSceneToLayout(valid.data, {
        name: layout.name, ...(layout.id ? { projectId: layout.id } : {}),
        assetUrls: Object.fromEntries(assetItems.map(item => [item.assetId!, item.glbUrl!])),
        assetNames: Object.fromEntries(assetItems.map(item => [item.assetId!, item.name])),
      });
      const next = mergeProposalPresentation(layout, converted);
      if (!canApplyLayoutGeometry(layout, next)) throw new Error('这项修改会让物件穿墙、进入柱子或超出场地。请先调整物件位置。');
      history.commitNow();
      actions.applyLayout(next);
      setNotice('结构尺寸已更新，可撤销。');
    } catch (error) { setNotice(error instanceof Error ? error.message : '无法修改结构尺寸。'); }
  };
  const wall = selected.kind === 'wall' ? current.structure.walls.find(value => value.id === selected.value.id)! : null;
  const opening = selected.kind === 'opening' ? current.structure.openings.find(value => value.id === selected.value.id)! : null;
  const column = selected.kind === 'column' ? current.structure.columns.find(value => value.id === selected.value.id)! : null;

  return <section aria-label="建筑结构尺寸" className="sc-structure-editor">
    <div className="sc-section-heading"><h3>建筑结构</h3><span>{statuses[selected.value.status]}</span></div>
    <label className="sc-field">选择结构<select aria-label="选择结构" value={`${selected.kind}:${selected.value.id}`} onChange={event => {
      setSelection(event.target.value); setNotice('');
      const [kind, id] = event.target.value.split(':') as [EntityKind, string];
      const marker = layout.floors[0]?.items.find(item => kind === 'opening' ? item.structuralOpeningId === id : kind === 'column' ? item.structuralColumnId === id : false);
      if (marker) selectOnly(marker.id);
    }}>{choices.map(entry => <option key={`${entry.kind}:${entry.value.id}`} value={`${entry.kind}:${entry.value.id}`}>{entry.label} · {statuses[entry.value.status]}</option>)}</select></label>
    <form key={`${selected.kind}:${selected.value.id}:${JSON.stringify(selected.value)}`} onSubmit={submit}>
      <div className="sc-dimension-grid">
        {wall && <>
          <label className="sc-field">墙长 / m<output>{Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z).toFixed(3)}</output></label>
          <Dimension label="墙厚 / m" name="thickness" value={wall.thickness} min={0.02} max={2}/>
          <Dimension label="墙高 / m" name="height" value={wall.height} min={0.02} max={current.venue.height}/>
        </>}
        {opening && <>
          <Dimension label="距墙起点 / m" name="offset" value={opening.offset} min={0} max={400}/>
          <Dimension label="门窗宽 / m" name="width" value={opening.width} min={0.02} max={20}/>
          <Dimension label="门窗高 / m" name="height" value={opening.height} min={0.02} max={current.venue.height}/>
          <Dimension label="离地高度 / m" name="sillHeight" value={opening.sillHeight} min={0} max={current.venue.height}/>
        </>}
        {column && <>
          <Dimension label="柱中心 X / m" name="x" value={column.position.x} min={0} max={current.venue.width}/>
          <Dimension label="柱中心 Z / m" name="z" value={column.position.z} min={0} max={current.venue.depth}/>
          <Dimension label="柱宽 / m" name="width" value={column.size.width} min={0.02} max={current.venue.width}/>
          <Dimension label="柱深 / m" name="depth" value={column.size.depth} min={0.02} max={current.venue.depth}/>
          <Dimension label="柱高 / m" name="height" value={column.size.height} min={0.02} max={current.venue.height}/>
          <Dimension label="柱旋转 / °" name="rotation" value={column.rotation} min={-360} max={360}/>
        </>}
      </div>
      <button type="submit" className="sc-structure-save">确认结构尺寸</button>
    </form>
    {wall && <p className="sc-note">墙长与相邻墙共同约束场地轮廓。请在“需求 → 尺寸核对”中修改墙长并重新校验。</p>}
    {notice && <p role="status" className="sc-note">{notice}</p>}
  </section>;
}

function Dimension({ label, name, value, min, max }: { label: string; name: string; value: number; min: number; max: number }): JSX.Element {
  return <label className="sc-field">{label}<input required aria-label={label} name={name} type="number" min={min} max={max} step="0.001" defaultValue={Number(value.toFixed(6))}/></label>;
}
