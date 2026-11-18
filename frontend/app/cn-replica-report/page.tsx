'use client';

/**
 * 国内案例对比报告（内部验收页，不进导航）：官网平面 | 我们的 2D / 3D。
 *
 * 左幅是官网自己的描图与拟设（`officialPlan`，从官网数据文件搬进来，未叠加我们的内容）；
 * 右幅是我们这条产品线渲染的同一块场地。
 * 左幅按官网数据复现、不是官网截图——官网那张图叠在卫星瓦片上，静态单文件报告带不了瓦片。
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  REPORT_H,
  REPORT_W,
  captureOfficialPlan,
  capturePlan2D,
  make3DCapturer,
} from '@/components/room-organizer/lib/replica-report-capture';
import { reportFrameOf } from '@/components/room-organizer/lib/replica-report-frame';
import { CN_REPLICA_CASES, type ReplicaCase } from '@/components/room-organizer/lib/replica-cases';

type Row = {
  replica: ReplicaCase;
  urlOfficial: string;
  url2d: string;
  url3d: string;
};

export default function CnReplicaReportPage(): JSX.Element {
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const capture3D = make3DCapturer();
    void (async () => {
      const out: Row[] = [];
      for (const replica of CN_REPLICA_CASES) {
        const plan = replica.buildPlan();
        // 左右同口径：都以官网轮廓取景（没有轮廓的案用官网拟设点的包围盒），
        // 右幅轮廓外的派生内容会出框。
        const focus = replica.officialPlan
          ? replica.officialPlan.areas[0]?.polygon ?? replica.officialPlan.seeds.flatMap(s => s.points)
          : null;
        out.push({
          replica,
          urlOfficial: replica.officialPlan ? captureOfficialPlan(replica.officialPlan) : '',
          url2d: capturePlan2D(plan, focus),
          url3d: capture3D(plan, focus ? reportFrameOf(focus) : null),
        });
        setRows([...out]);
        setProgress(out.length);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    })();
  }, []);

  const exportHtml = useCallback(() => {
    const sections = rows.map(row => `
  <section class="case">
    <h2>${row.replica.title} <small>(${row.replica.category} · ${row.replica.region})</small></h2>
    <div class="pair">
      <figure class="theirs"><figcaption>他们的平面图 · 官网案例（按官网描图数据复现）</figcaption>${row.urlOfficial ? `<img src="${row.urlOfficial}"/>` : '<p class="missing">官网平面缺失</p>'}</figure>
      <div class="ours">
        <figure><figcaption>我们的产品 · 2D（与左幅同口径，官网轮廓取景）</figcaption><img src="${row.url2d}"/></figure>
        <figure><figcaption>我们的产品 · 3D（与左幅同口径，官网轮廓取景）</figcaption><img src="${row.url3d}"/></figure>
      </div>
    </div>
    <p class="loc"><a href="${row.replica.refLink}">案例出处</a>${row.replica.locationNote ? ` · ${row.replica.locationNote}` : ''}</p>
  </section>`).join('\n');
    const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"/><title>国内案例对比报告（${rows.length} 案）</title>
<style>
  body{font-family:system-ui,'Segoe UI',sans-serif;margin:24px;background:#f7f8f9;color:#23252c}
  h1{font-size:22px} h2{font-size:16px;margin:28px 0 8px} h2 small{color:#6b7280;font-weight:400}
  .pair{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}
  .theirs{flex:1 1 420px}
  .ours{flex:1 1 420px;display:flex;flex-direction:column;gap:12px}
  figure{margin:0;background:#fff;padding:8px;border:1px solid #d9dde2;border-radius:8px}
  figcaption{font-size:12px;color:#6b7280;margin-bottom:6px}
  img{width:100%;display:block;border-radius:4px}
  .loc{font-size:12px;color:#6b7280}
  .missing{color:#c0392b;font-size:13px}
</style></head><body>
<h1>国内案例对比报告 · ${rows.length} 案</h1>
<p>生成于 ${new Date().toLocaleString('zh-CN')} · 左幅=官网自己的轮廓与拟设（按官网数据复现，无卫星底图） · 右幅=我们同一块场地的 2D/3D。</p>
${sections}
</body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cn-case-report.html';
    a.click();
    URL.revokeObjectURL(a.href);
  }, [rows]);

  return <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', background: '#f7f8f9', minHeight: '100vh' }}>
    <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>国内案例对比报告 · {CN_REPLICA_CASES.length} 案</h1>
    <p style={{ color: '#6b7280', fontSize: 13, margin: '0 0 16px' }}>
      已生成 {progress}/{CN_REPLICA_CASES.length} · 左=官网平面（官网描图数据复现，无卫星底图） · 右=我们的 2D/3D
      <button type="button" onClick={exportHtml} disabled={progress < CN_REPLICA_CASES.length}
        style={{ marginLeft: 16, padding: '6px 14px', cursor: 'pointer' }}>导出静态 HTML</button>
    </p>
    {rows.map(row => <section key={row.replica.id} style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>
        {row.replica.title}
        <small style={{ color: '#6b7280', fontWeight: 400 }}>（{row.replica.category} · {row.replica.region}）</small>
      </h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <figure style={{ ...figureStyle, flex: '1 1 420px' }}>
          <figcaption style={capStyle}>他们的平面图 · 官网案例（按官网描图数据复现）</figcaption>
          {row.urlOfficial
            ? <img src={row.urlOfficial} alt={`${row.replica.title} 官网平面`} style={imgStyle} width={REPORT_W} height={REPORT_H}/>
            : <p style={{ color: '#c0392b', fontSize: 13 }}>官网平面缺失</p>}
        </figure>
        <div style={{ flex: '1 1 420px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <figure style={{ ...figureStyle, flex: 'unset' }}>
            <figcaption style={capStyle}>我们的产品 · 2D（与左幅同口径，官网轮廓取景）</figcaption>
            <img src={row.url2d} alt={`${row.replica.title} 我们 2D`} style={imgStyle} width={REPORT_W} height={REPORT_H}/>
          </figure>
          <figure style={{ ...figureStyle, flex: 'unset' }}>
            <figcaption style={capStyle}>我们的产品 · 3D（与左幅同口径，官网轮廓取景）</figcaption>
            <img src={row.url3d} alt={`${row.replica.title} 我们 3D`} style={imgStyle} width={REPORT_W} height={REPORT_H}/>
          </figure>
        </div>
      </div>
      <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
        <a href={row.replica.refLink}>案例出处</a>{row.replica.locationNote ? ` · ${row.replica.locationNote}` : ''}
      </p>
    </section>)}
  </div>;
}

const figureStyle: CSSProperties = { margin: 0, flex: '1 1 420px', background: '#fff', padding: 8, border: '1px solid #d9dde2', borderRadius: 8 };
const capStyle: CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 6 };
const imgStyle: CSSProperties = { width: '100%', display: 'block', borderRadius: 4 };
