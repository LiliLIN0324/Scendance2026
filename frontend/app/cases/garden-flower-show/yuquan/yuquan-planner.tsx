'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { boothBox, boothNotice, boothTypes, existingPlan, hallMarker, initialBooths, photoSources, placeAt, points, readBooths, site, survey, type Booth, type BoothType, type Point } from './yuquan-data';
import { layerTypes, Marks, type LayerId, type Mark } from './yuquan-marks';
import { YuquanBase } from './yuquan-plan';
import styles from './yuquan.module.css';

const STORAGE = 'scendance-yuquan-traced-v2';
const directions = [
  { icon: '←', title: '向左移动 0.5 米', x: -.5, y: 0 },
  { icon: '↑', title: '向上移动 0.5 米', x: 0, y: -.5 },
  { icon: '↓', title: '向下移动 0.5 米', x: 0, y: .5 },
  { icon: '→', title: '向右移动 0.5 米', x: .5, y: 0 },
];
const boothName = (id: number) => `B${String(id).padStart(2, '0')}`;

function pointerPosition(event: PointerEvent<SVGSVGElement>): Point | undefined {
  const matrix = event.currentTarget.getScreenCTM();
  if (!matrix) return;
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
}

export function YuquanPlanner() {
  const [booths, setBooths] = useState<Booth[]>(initialBooths);
  const [selected, setSelected] = useState<number | null>(null);
  const [placing, setPlacing] = useState<BoothType | null>(null);
  const [activePoint, setActivePoint] = useState('01');
  const [ready, setReady] = useState(false);
  const [saveProblem, setSaveProblem] = useState(false);
  const [zoom, setZoom] = useState<Point | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [draft, setDraft] = useState<Omit<Mark, 'id'> | null>(null);
  const [hidden, setHidden] = useState<LayerId[]>([]);
  const [boothsVisible, setBoothsVisible] = useState(true);
  const drag = useRef<{ id: number; pointer: number; offset: Point } | null>(null);
  const sourcePoint = points.find(point => point.id === activePoint) ?? points[0];
  const active = booths.find(booth => booth.id === selected);
  const activeBox = active && boothBox(active);
  const activeNotice = active && boothNotice(active, booths);
  const view = zoom ? `${zoom.x} ${zoom.y} ${site.width / 2} ${site.height / 2}` : `0 0 ${site.width} ${site.height}`;

  useEffect(() => {
    try {
      const restored = readBooths(window.localStorage.getItem(STORAGE));
      setBooths(restored);
      setSelected(restored[0]?.id ?? null);
    } catch {
      setSaveProblem(true);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE, JSON.stringify(booths));
      setSaveProblem(false);
    } catch {
      setSaveProblem(true);
    }
  }, [booths, ready]);

  function updateBooth(id: number, update: (booth: Booth) => Booth) {
    setBooths(current => current.map(booth => booth.id === id ? update(booth) : booth));
  }

  function addAt(point: Point) {
    if (!placing || booths.length >= 100) return;
    const id = Math.max(0, ...booths.map(booth => booth.id)) + 1;
    setBooths(current => [...current, placeAt({ id, type: placing, x: point.x, y: point.y, rotated: false }, point)]);
    setSelected(id);
    setPlacing(null);
  }

  function startPointer(event: PointerEvent<SVGSVGElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    const point = pointerPosition(event);
    if (!point) return;
    if (draft) {
      if (point.x < 0 || point.y < 0 || point.x > site.width || point.y > site.height) return;
      event.preventDefault();
      setDraft(current => current && { ...current, points: [...current.points, { x: point.x, y: point.y }] });
      return;
    }
    if (placing) {
      event.preventDefault();
      addAt(point);
      return;
    }
    const target = event.target instanceof Element ? event.target.closest('[data-booth]') : null;
    const booth = booths.find(item => item.id === Number(target?.getAttribute('data-booth')));
    if (!booth) return;
    event.preventDefault();
    setSelected(booth.id);
    drag.current = { id: booth.id, pointer: event.pointerId, offset: { x: point.x - booth.x, y: point.y - booth.y } };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePointer(event: PointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (current?.pointer !== event.pointerId) return;
    const point = pointerPosition(event);
    if (point) updateBooth(current.id, booth => placeAt(booth, { x: point.x - current.offset.x, y: point.y - current.offset.y }));
  }

  function stopPointer(event: PointerEvent<SVGSVGElement>) {
    if (drag.current?.pointer === event.pointerId) drag.current = null;
  }

  function zoomToSelection() {
    const center = active ?? hallMarker;
    setZoom({
      x: Math.max(0, Math.min(site.width / 2, center.x - site.width / 4)),
      y: Math.max(0, Math.min(site.height / 2, center.y - site.height / 4)),
    });
  }

  function finishMark() {
    if (!draft) return;
    setMarks(current => [...current, { ...draft, id: Math.max(0, ...current.map(mark => mark.id)) + 1 }]);
    setHidden(current => current.filter(id => id !== draft.type));
    setDraft(null);
  }

  function exportCsv() {
    const rows = booths.map(booth => {
      const spec = boothTypes.find(type => type.id === booth.type)!;
      const box = boothBox(booth);
      return [boothName(booth.id), spec.label, box.width, box.height, booth.x, booth.y, booth.rotated ? 90 : 0, boothNotice(booth, booths) || '现场可用范围待核'].join(',');
    });
    const url = URL.createObjectURL(new Blob([
      '\ufeff场地,玉泉鱼跃,方案性质,概念试排,坐标,图纸局部米制,实地放样,待复测\r\n',
      '编号,类型,宽米,深米,图上中心X米,图上中心Y米,转角,图上检查\r\n',
      rows.join('\r\n'),
    ], { type: 'text/csv;charset=utf-8' }));
    const download = document.createElement('a');
    download.href = url;
    download.download = '玉泉鱼跃-摊位试排.csv';
    download.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <main className={styles.page}>
    <header className={styles.mast}><div className={styles.wrap}>
      <a href="/introduction"><strong>幕景</strong> <span>SCENDANCE</span></a>
      <a href="/cases/garden-flower-show">← 花展演示</a>
    </div></header>
    <div className={styles.wrap}>
      <section className={styles.intro}>
        <span>2022 年公开现状图转绘 · 幕景试排</span>
        <h1>玉泉鱼跃 · 摊位试排</h1>
        <p>杭州植物园玉泉鱼跃局部。底图取自公开现状图上可辨认的线条，比例用玉泉主池的调查尺寸校准。2026 菊展实拍另作展期参照。</p>
      </section>
      <div className={styles.work}>
        <section className={styles.card} aria-labelledby="yuquan-map-title">
          <div className={styles.cardHead}>
            <div><p>玉泉鱼跃 / 三泉院落局部</p><h2 id="yuquan-map-title">场地俯视图</h2></div>
            <div className={styles.controls}><button type="button" onClick={zoomToSelection}>放大选区</button><button type="button" disabled={!zoom} onClick={() => setZoom(null)}>全图</button></div>
          </div>
          <div className={styles.mapFrame}>
            <svg viewBox={view} role="group" aria-label="玉泉鱼跃摊位规划平面" className={placing || draft ? styles.placing : undefined}
              onPointerDown={startPointer} onPointerMove={movePointer} onPointerUp={event => { movePointer(event); stopPointer(event); }}
              onPointerCancel={stopPointer} onLostPointerCapture={stopPointer}>
              <YuquanBase activePoint={activePoint} choosePoint={setActivePoint} />
              <Marks items={marks} draft={draft} hidden={hidden} />
              {boothsVisible && booths.map(booth => {
                const box = boothBox(booth);
                const spec = boothTypes.find(type => type.id === booth.type)!;
                const invalid = !!boothNotice(booth, booths);
                return <g key={booth.id} data-booth={booth.id} role="button" tabIndex={0}
                  aria-label={`图上 ${boothName(booth.id)} ${spec.label}`} aria-pressed={selected === booth.id}
                  className={styles.booth}
                  onKeyDown={event => {
                    const index = ['ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight'].indexOf(event.key);
                    if (index >= 0) {
                      event.preventDefault();
                      const direction = directions[index];
                      setSelected(booth.id);
                      updateBooth(booth.id, item => placeAt(item, { x: item.x + direction.x, y: item.y + direction.y }));
                    } else if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelected(booth.id);
                    }
                  }}>
                  <rect x={booth.x - 2} y={booth.y - 2} width="4" height="4" fill="transparent" />
                  <rect {...box} fill={invalid ? '#a3553d' : spec.color} stroke={selected === booth.id ? '#142c28' : '#fff'} strokeWidth={selected === booth.id ? '.4' : '.18'} />
                  <text x={booth.x} y={booth.y + .38} textAnchor="middle" fill="#fff" fontSize="1.1" fontWeight="700" pointerEvents="none">{boothName(booth.id)}</text>
                </g>;
              })}
            </svg>
          </div>
          <div className={styles.legend}><span><i /> 主池轮廓 · 调查值校准</span><span><i /> 原图可辨轮廓</span><span><i /> 可辨园路片段</span><span>图上 5 m 方格</span></div>
          <p className={styles.caption}>未识别的池、墙、入口和路径留白。空白处的地面条件与可摆范围待核。<br />
            <a href={survey} target="_blank" rel="noreferrer">《三普古井调查表》条目 141 ↗</a>{' · '}
            <a href={existingPlan} target="_blank" rel="noreferrer">核对原文图 1 ↗</a>{' · '}
            <a href="https://cimg.fx361.com/images/2023/0103/2f052e98b73a5f3e6fa7165a2f82aa8a9560a324.webp" target="_blank" rel="noreferrer">查看原图 ↗</a>
          </p>
        </section>

        <aside className={styles.side} aria-label="规划工具">
          <section className={styles.card}>
            <div className={styles.cardHead}><div><p>假设摊位 / 本机方案</p><h2>摆放摊位</h2></div><span>{booths.length} 个</span></div>
            <div className={styles.panelBody}>
              <div className={styles.types} role="group" aria-label="选择要摆放的摊位">
                {boothTypes.map(spec => <button key={spec.id} type="button" disabled={!ready || booths.length >= 100}
                  aria-pressed={placing === spec.id} onClick={() => { setDraft(null); setBoothsVisible(true); setPlacing(spec.id); }}>
                  <strong>{spec.label}</strong><span>{spec.width} × {spec.height} 米</span>
                </button>)}
              </div>
              <div className={styles.placement} role="status">{placing ? '点击平面放下摊位。' : '选规格后点击地图摆放。摊位可拖动，也可用方向键微调。'}</div>
              {placing && <div className={styles.controls}><a className={styles.jump} href="#yuquan-map-title">到图上摆放 ↑</a><button type="button" onClick={() => setPlacing(null)}>取消摆放</button></div>}
              <div className={styles.boothList} role="group" aria-label="已摆摊位">
                {booths.map(booth => <button key={booth.id} type="button" aria-pressed={booth.id === selected}
                  onClick={() => { setSelected(booth.id); setPlacing(null); }}>{boothName(booth.id)} {boothTypes.find(spec => spec.id === booth.type)?.label}</button>)}
              </div>
              {active && activeBox && <div className={styles.selection}>
                <strong>{boothName(active.id)} · {activeBox.width} × {activeBox.height} 米</strong>
                <p>图上中心 X {active.x.toFixed(1)} / Y {active.y.toFixed(1)} 米</p>
                <p>按试排规格摆放 · 方案草稿 · 由现场组核对可用范围</p>
                <p className={activeNotice ? styles.warning : undefined} role="status">{activeNotice || '现场可用范围待核'}</p>
                <div className={styles.controls}>
                  {directions.map(direction => <button type="button" aria-label={direction.title} key={direction.title} onClick={() => {
                    updateBooth(active.id, booth => placeAt(booth, { x: booth.x + direction.x, y: booth.y + direction.y }));
                  }}>{direction.icon}</button>)}
                  <button type="button" onClick={() => updateBooth(active.id, booth => placeAt({ ...booth, rotated: !booth.rotated }, booth))}>旋转 90°</button>
                  <button type="button" onClick={() => { setBooths(current => current.filter(booth => booth.id !== active.id)); setSelected(null); }}>移除</button>
                </div>
              </div>}
              <div className={styles.exports}><span>{saveProblem ? '浏览器无法保存，可导出清单。' : '自动保存在此浏览器'}</span><button type="button" disabled={!booths.length} onClick={exportCsv}>导出摊位表</button></div>
            </div>
          </section>
          <section className={styles.card} aria-labelledby="yuquan-layers">
            <div className={styles.cardHead}><div><p>方案图层 / 用户绘制</p><h2 id="yuquan-layers">边界、分区与路线</h2></div></div>
            <div className={styles.panelBody}>
              <div className={styles.controls} role="group" aria-label="绘制规划图层">
                {layerTypes.map(layer => <button type="button" key={layer.id} aria-pressed={draft?.type === layer.id} onClick={() => {
                  setPlacing(null);
                  setDraft({ type: layer.id, points: [] });
                }}>画{layer.title}</button>)}
              </div>
              {draft && <>
                <p role="status">在图上依次选点。已选 {draft.points.length} 点。</p>
                <div className={styles.controls}>
                  <a className={styles.jump} href="#yuquan-map-title">到图上选点 ↑</a>
                  <button type="button" disabled={draft.points.length < (layerTypes.find(layer => layer.id === draft.type)!.closed ? 3 : 2)} onClick={finishMark}>完成绘制</button>
                  <button type="button" onClick={() => setDraft(null)}>取消绘制</button>
                </div>
              </>}
              <div className={styles.controls} role="group" aria-label="显示规划图层">
                <button type="button" aria-pressed={boothsVisible} onClick={() => setBoothsVisible(value => !value)}>摊位与设施</button>
                {layerTypes.filter(layer => marks.some(mark => mark.type === layer.id)).map(layer => <button type="button" key={layer.id}
                  aria-pressed={!hidden.includes(layer.id)} onClick={() => setHidden(current => current.includes(layer.id)
                    ? current.filter(id => id !== layer.id) : [...current, layer.id])}>{layer.title}</button>)}
              </div>
              {marks.length > 0 && <button type="button" onClick={() => setMarks(current => current.slice(0, -1))}>撤回上一条标绘</button>}
              <p>活动边界、分区与路线是本页标绘草稿，刷新后清空。依据现场可用范围复核后再定稿。</p>
            </div>
          </section>
          <section className={styles.card}>
            <div className={styles.cardHead}><div><p>展期公开证据</p><h2>{sourcePoint.label}</h2></div><span>{sourcePoint.id}</span></div>
            <div className={styles.panelBody}>
              <div className={styles.controls} role="group" aria-label="定位现场资料">
                {points.map(point => <button type="button" key={point.id} aria-pressed={activePoint === point.id} onClick={() => setActivePoint(point.id)}>{point.label}</button>)}
              </div>
              <p>{sourcePoint.note}</p>
              <ul className={styles.links}>{sourcePoint.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a></li>)}</ul>
            </div>
          </section>
        </aside>
      </div>
      <section className={styles.sources} aria-labelledby="yuquan-sources">
        <div><p>杭州植物园主会场 · 2026 年 11 月</p><h2 id="yuquan-sources">现场照片索引</h2></div>
        <p>优先看长廊、池边、装置和行走路线的广角。链接打开发布方原页，各图集可能有重复画面。</p>
        <ol>{photoSources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a><p>{source.note}</p></li>)}</ol>
        <p>用于现场作业前，需要可使用的高清正射影像或有比例的当届场地图，以及实测铺装边缘、通行净宽和获准使用的范围。</p>
      </section>
    </div>
  </main>;
}
