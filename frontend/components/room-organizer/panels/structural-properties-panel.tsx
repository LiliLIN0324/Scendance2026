'use client';

import { BrickWall, Check, DoorOpen, Info, Minus, Plus, Ruler, Square } from '@/components/solid-icons';
import { useState, type FormEvent } from 'react';
import { sceneSchema, type SceneV2 } from '../../../../supabase/functions/_shared/domain';
import { measurement } from '../../../../supabase/functions/_shared/structural-geometry';
import { useRoomEditor, useSelection } from '../contexts';
import { backendSceneToLayout, layoutToBackendScene } from '../lib/backend-adapter';
import { mergeProposalPresentation } from '../lib/creative-brief';
import { canApplyLayoutGeometry, layoutGeometryScene } from '../lib/structural-layout';
import { MAX_STOREY_HEIGHT, MIN_STOREY_HEIGHT } from '../lib/storeys';
import type { RoomLayout } from '../lib/types';
import './structural-properties-panel.css';

const statuses = { detected: '识别待核对', inferred: '推定待核对', confirmed: '已确认' };

/** Explicit structural edits use the same scene contract and collision gate as generation. */
export function StructuralPropertiesPanel(): JSX.Element | null {
  const { layout, actions, history } = useRoomEditor();
  const { selectOnly } = useSelection();
  const [selection, setSelection] = useState('');
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  // 普通矢量壳体没有云端结构（backendSceneV2），几何仍可从 floor.interiorWalls 现算；
  // 它的场地尺寸走既有 reducer 的 setWidth / setHeight / setStoreyHeight。
  const shell = !layout.backendSceneV2;
  let current: SceneV2;
  try {
    if (shell) current = layoutGeometryScene(layout);
    else {
      const scene = layoutToBackendScene(layout);
      if (scene.schemaVersion !== 2) return null;
      current = scene;
    }
  } catch { return <p className="sc-warning">结构存在未解决的尺寸冲突，请在图纸核对中修正。</p>; }
  const choices = [
    ...current.structure.walls.map((value, index) => ({ kind: 'wall' as const, value, label: `${value.kind === 'exterior' ? '外墙' : '内墙'} ${index + 1}` })),
    ...current.structure.openings.map((value, index) => ({ kind: 'opening' as const, value, label: `${value.kind === 'door' ? '门' : '窗'} ${index + 1}` })),
    ...current.structure.columns.map((value, index) => ({ kind: 'column' as const, value, label: `柱子 ${index + 1}` })),
  ];
  const selected = choices.find(entry => `${entry.kind}:${entry.value.id}` === selection) ?? choices[0];
  // 有结构就编辑墙/门窗/柱子；普通壳体没有结构时，这一处就编辑场地尺寸。
  if (!selected && !shell) return <div className="sc-lib-empty">
    <BrickWall size={14} aria-hidden="true"/><span>还没有结构</span>
    <details className="sc-space-info is-right is-up">
      <summary aria-label="结构从哪来"><Info size={12} aria-hidden="true"/></summary>
      <p>先上传图纸生成结构，或核对场地尺寸后重试。</p>
    </details>
  </div>;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice('');
    setFailed(false);
    const fields = new FormData(event.currentTarget);
    const confirmStructure=fields.get('confirmStructure')==='yes';
    const statusAfter=(status:SceneV2['structure']['walls'][number]['status'],changed:boolean)=>confirmStructure?'confirmed' as const:changed&&status==='confirmed'?'inferred' as const:status;
    const read = (key: string) => {
      const raw = fields.get(key);
      if (typeof raw !== 'string' || !raw.trim() || !Number.isFinite(Number(raw))) throw new Error('请填写有效的米制尺寸。');
      return Number(raw);
    };
    try {
      if (!selected) {
        // 普通壳体只改场地尺寸：沿用已有 reducer，贴墙门窗与分区会跟着新边界重排。
        const width = read('width');
        const depth = read('depth');
        const storey = read('storeyHeight');
        if (width === layout.width && depth === layout.height && storey === current.venue.height) {
          setNotice('尺寸没有变化。');
          return;
        }
        history.commitNow();
        if (width !== layout.width) actions.setWidth(width);
        if (depth !== layout.height) actions.setHeight(depth);
        if (storey !== current.venue.height) actions.setStoreyHeight(storey);
        setNotice('场地尺寸已更新，可撤销。');
        return;
      }
      const candidate = structuredClone(current);
      const { id } = selected.value;
      if (selected.kind === 'wall') {
        const wall = candidate.structure.walls.find(value => value.id === id)!;
        wall.thickness = read('thickness');
        wall.height = read('height');
        wall.status = statusAfter(selected.value.status,wall.thickness!==selected.value.thickness||wall.height!==selected.value.height);
      } else if (selected.kind === 'opening') {
        const opening = candidate.structure.openings.find(value => value.id === id)!;
        opening.offset = read('offset');
        opening.width = read('width');
        opening.height = read('height');
        opening.sillHeight = read('sillHeight');
        opening.status = statusAfter(selected.value.status,opening.offset!==selected.value.offset||opening.width!==selected.value.width||opening.height!==selected.value.height||opening.sillHeight!==selected.value.sillHeight);
      } else {
        const column = candidate.structure.columns.find(value => value.id === id)!;
        column.position = { x: read('x'), z: read('z') };
        column.size = { width: read('width'), depth: read('depth'), height: read('height') };
        column.rotation = read('rotation');
        column.status = statusAfter(selected.value.status,column.position.x!==selected.value.position.x||column.position.z!==selected.value.position.z||column.size.width!==selected.value.size.width||column.size.depth!==selected.value.size.depth||column.size.height!==selected.value.size.height||column.rotation!==selected.value.rotation);
      }
      const moved = selected.kind === 'opening'
        ? candidate.structure.openings.find(opening => opening.id === id)!.offset !== selected.value.offset
        : selected.kind === 'column'
          ? (() => { const column = candidate.structure.columns.find(value => value.id === id)!;
            return column.position.x !== selected.value.position.x || column.position.z !== selected.value.position.z || column.rotation !== selected.value.rotation; })()
          : false;
      // Retain old evidence as unconfirmed whenever the referenced object moved.
      const manualDimensions: typeof candidate.dimensions = [];
      candidate.dimensions = candidate.dimensions.map(dimension => {
        if (dimension.label.startsWith('旧记录，当前尺寸已改变：') || ['width','depth','height'].includes(dimension.kind)) return dimension;
        const touchesObject = dimension.targetId === id || dimension.targetEndId === id;
        if (!touchesObject) return dimension;
        const directSize = dimension.targetId === id && !dimension.targetEndId && (selected.kind === 'opening' || selected.kind === 'wall' && dimension.measure === 'height'
          || selected.kind === 'column' && !!dimension.measure && dimension.measure !== 'length');
        const { sourceAssetId: _source, start: _start, end: _end, ...targetMeasurement } = dimension;
        const value = directSize ? measurement(candidate, targetMeasurement) : undefined;
        const changed = value !== undefined && Math.abs(value - dimension.valueMeters) > 1e-6;
        if (!changed && !moved) return dimension;
        // Keep the old evidence and its value; a manual edit cannot alter what the source measured.
        if (changed && value !== undefined) manualDimensions.push({ id: crypto.randomUUID(), kind: dimension.kind, targetId: id,
          ...(dimension.measure ? { measure: dimension.measure } : {}), valueMeters: value, status: confirmStructure?'confirmed':'inferred',
          label: `人工修改，来源待核验：${dimension.label}`.slice(0, 200) });
        return { ...dimension, status: 'inferred' as const,
          label: `旧记录，当前尺寸已改变：${dimension.label}`.slice(0, 200) };
      });
      candidate.dimensions.push(...manualDimensions);
      const valid = sceneSchema.safeParse(candidate);
      if (!valid.success || valid.data.schemaVersion !== 2) throw new Error('结构尺寸不合法。');
      let next: RoomLayout;
      if (shell) {
        next = applyShellGeometry(layout, valid.data);
      } else {
        const assetItems = layout.floors.flatMap(floor => floor.items).filter(item => item.assetId && item.glbUrl);
        const converted = backendSceneToLayout(valid.data, {
          name: layout.name, ...(layout.id ? { projectId: layout.id } : {}),
          assetUrls: Object.fromEntries(assetItems.map(item => [item.assetId!, item.glbUrl!])),
          assetNames: Object.fromEntries(assetItems.map(item => [item.assetId!, item.name])),
        });
        next = mergeProposalPresentation(layout, converted);
      }
      if (!canApplyLayoutGeometry(layout, next)) throw new Error('这项修改会让物件穿墙、进入柱子或超出场地。请先调整物件位置。');
      history.commitNow();
      actions.applyLayout(next);
      setNotice('结构尺寸已更新，可撤销。');
    } catch (error) {
      setFailed(true);
      setNotice(error instanceof Error ? error.message : '无法修改结构尺寸。');
    }
  };
  const wall = selected?.kind === 'wall' ? current.structure.walls.find(value => value.id === selected.value.id)! : null;
  const opening = selected?.kind === 'opening' ? current.structure.openings.find(value => value.id === selected.value.id)! : null;
  const column = selected?.kind === 'column' ? current.structure.columns.find(value => value.id === selected.value.id)! : null;

  const confirmed = selected?.value.status === 'confirmed';
  const choose = (entry: typeof choices[number]) => {
    setSelection(`${entry.kind}:${entry.value.id}`);
    setNotice('');
    setFailed(false);
    const marker = layout.floors[0]?.items.find(item => entry.kind === 'opening' ? item.structuralOpeningId === entry.value.id : entry.kind === 'column' ? item.structuralColumnId === entry.value.id : false);
    if (marker) selectOnly(marker.id);
  };
  const body = <>
    {choices.length > 0 && <div className="sc-structure-chips" role="group" aria-label="选择结构">
      {choices.map(entry => {
        const Icon = entry.kind === 'wall' ? BrickWall : entry.kind === 'opening' ? DoorOpen : Square;
        const active = selected?.kind === entry.kind && selected.value.id === entry.value.id;
        return <button type="button" key={`${entry.kind}:${entry.value.id}`}
          className={`${active ? 'is-active' : ''}`}
          aria-pressed={active}
          aria-label={`选择${entry.label}`} title={`${entry.label} · ${statuses[entry.value.status]}`}
          onClick={() => choose(entry)}>
          <Icon size={12} aria-hidden="true"/><span>{entry.label}</span>
        </button>;
      })}
    </div>}
    <form key={selected ? `${selected.kind}:${selected.value.id}:${JSON.stringify(selected.value)}` : 'venue'} onSubmit={submit}>
      <div className="sc-structure-rows">
        {/* 普通壳体没有墙/门窗时，这一处就是场地尺寸，走既有 reducer，3D 与 2D 一起变。 */}
        {!selected && <>
          <Dimension label="总宽 / m" name="width" value={current.venue.width} min={2} max={100} step={0.1} wide/>
          <Dimension label="总长 / m" name="depth" value={current.venue.depth} min={2} max={100} step={0.1} wide/>
          <Dimension label="层高 / m" name="storeyHeight" value={current.venue.height} min={MIN_STOREY_HEIGHT} max={MAX_STOREY_HEIGHT} step={0.1} wide/>
        </>}
        {wall && <>
          <div className="sc-structure-row is-static">
            <span className="sc-structure-row-label">墙长</span>
            <output>{Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z).toFixed(2)} m</output>
          </div>
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
          <Dimension label="柱旋转 / °" name="rotation" value={column.rotation} min={-360} max={360} unit="°" step={15}/>
        </>}
      </div>
      <div className="sc-structure-foot">
        {selected&&<label><input type="checkbox" name="confirmStructure" value="yes"/><span>我已核对该结构的完整位置、尺寸和高度，与现场或图纸一致</span></label>}
        <button type="submit" className="sc-structure-apply"><Check size={13} aria-hidden="true"/><span>应用</span></button>
        {notice && <p role="status" className={`sc-structure-notice${failed ? ' is-error' : ''}`}>{notice}</p>}
      </div>
    </form>
    {!selected && <p className="sc-lib-empty">
      <BrickWall size={13} aria-hidden="true"/><span>还没有墙和门窗，先用 2D 的墙工具画出墙体。</span>
    </p>}
  </>;
  // 普通壳体：入口收成卡内一行，点开才展开同一套结构面板。
  if (shell) return <details className="sc-space-section sc-space-fold sc-structure-editor">
    <summary className="sc-space-section-head">
      <Ruler size={15} aria-hidden="true"/><h3>结构</h3>
      <small>{selected ? statuses[selected.value.status] : '普通壳体'}</small>
    </summary>
    <div className="sc-structure-body">{body}</div>
  </details>;
  return <section aria-label="结构" className="sc-space-section sc-structure-editor">
    <div className="sc-space-section-head">
      <Ruler size={15} aria-hidden="true"/><h3>结构</h3>
      <span className={`sc-structure-state ${confirmed ? 'is-confirmed' : 'is-pending'}`}>
        <span className="sc-structure-dot" aria-hidden="true"/>{statuses[selected!.value.status]}
      </span>
    </div>
    {body}
  </section>;
}

function Dimension({ label, name, value, min, max, unit = 'm', step = 0.01, wide = false }: {
  label: string; name: string; value: number; min: number; max: number; unit?: string; step?: number; wide?: boolean;
}): JSX.Element {
  const [current, setCurrent] = useState(() => Number(value.toFixed(6)));
  const clamp = (next: number) => Number(Math.min(max, Math.max(min, next)).toFixed(3));
  return <div className={`sc-structure-row${wide ? ' is-wide' : ''}`}>
    <span className="sc-structure-row-label">{label}</span>
    <div className="sc-structure-stepper">
      <button type="button" tabIndex={-1} aria-label={`减小${label}`} onClick={() => setCurrent(next => clamp(next - step))}><Minus size={12} aria-hidden="true"/></button>
      <input required aria-label={label} name={name} type="number" min={min} max={max} step="0.001" value={current}
        onChange={event => setCurrent(Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0)}/>
      <button type="button" tabIndex={-1} aria-label={`增大${label}`} onClick={() => setCurrent(next => clamp(next + step))}><Plus size={12} aria-hidden="true"/></button>
    </div>
    <span className="sc-structure-unit">{unit}</span>
  </div>;
}

/**
 * 普通壳体的结构回写：面板改的是几何场景，落盘仍是 floor.interiorWalls 与门窗/柱子标记物件，
 * 不把壳体升级成 backendSceneV2；2D 与 3D 都读这份数据，所以两边一起变。
 */
function applyShellGeometry(layout: RoomLayout, edited: SceneV2): RoomLayout {
  const floor = layout.floors[0]!;
  const dx = layout.width / 2;
  const dz = layout.height / 2;
  const walls = edited.structure.walls.map(wall => ({
    ...floor.interiorWalls?.find(original => original.id === wall.id),
    id: wall.id,
    x1: wall.start.x - dx, z1: wall.start.z - dz,
    x2: wall.end.x - dx, z2: wall.end.z - dz,
    thickness: wall.thickness, height: wall.height, kind: wall.kind, status: wall.status,
  }));
  const items = floor.items.map(item => {
    const opening = edited.structure.openings.find(entry => entry.id === (item.structuralOpeningId ?? item.id));
    if (opening) {
      const wall = edited.structure.walls.find(entry => entry.id === opening.wallId);
      if (!wall) return item;
      const length = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z);
      const t = length ? (opening.offset + opening.width / 2) / length : 0;
      return { ...item, structuralOpeningId: item.structuralOpeningId ?? opening.id,
        width: opening.width, height: opening.height, depth: wall.thickness, sillHeight: opening.sillHeight,
        position: { x: wall.start.x + (wall.end.x - wall.start.x) * t - dx,
          z: wall.start.z + (wall.end.z - wall.start.z) * t - dz },
        rotation: -Math.atan2(wall.end.z - wall.start.z, wall.end.x - wall.start.x) };
    }
    const column = edited.structure.columns.find(entry => entry.id === item.structuralColumnId);
    if (column) return { ...item,
      width: column.size.width, depth: column.size.depth, height: column.size.height,
      position: { x: column.position.x - dx, z: column.position.z - dz },
      rotation: -column.rotation * Math.PI / 180 };
    return item;
  });
  return { ...layout, floors: [{ ...floor, interiorWalls: walls, items }] };
}
