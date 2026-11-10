/**
 * PDF 演示稿导出（H5-b）——本地下载、零外部依赖。
 *
 * 口径（评审稿 §11）：PDF 演示稿为「本地下载」交付（不依赖云端渲染服务）。
 * 实现取浏览器打印管线：把规划内容注入隐藏打印容器（标题页+总览页+
 * 画布快照图+图例+清单），调 `window.print()`，用户「另存为 PDF」即得文件。
 * 纯函数层负责演示稿数据（页面分块/统计/清单行）；DOM 层负责注入与打印。
 */

import { buildPlanInventory } from './site-plan-inventory';
import { buildPlanLegend } from './site-plan-legend';
import { formatAreaM2, formatLengthM, planOverviewStats } from './site-plan-measure';
import { snapshotCaption } from './site-plan-png';
import type { SitePlanData, SitePlanSnapshot } from '../../../../supabase/functions/_shared/site-plan';

/** 演示稿页面：数据驱动（不碰 DOM，可测）。 */
export interface DeckPage {
  title: string;
  lines: string[];
}

/** 生成演示稿全部页面：封面 → 总览 → 清单（分区/设施/动线/人员分组）。 */
export function buildDeckPages(snapshot: SitePlanSnapshot, snapshotPngDataUrl?: string): DeckPage[] {
  const plan = snapshot.data;
  const stats = planOverviewStats(plan);
  const pages: DeckPage[] = [];

  pages.push({
    title: '封面',
    lines: [
      '幕景 Scendance · 户外活动平面规划',
      `规划快照 r${snapshot.revision}`,
      `导出 ${new Date(snapshot.updatedAt).toLocaleString('zh-CN', { hour12: false })}`,
      snapshotPngDataUrl ? '（含规划快照图）' : '（快照图见画布页）',
    ],
  });

  pages.push({
    title: '总览',
    lines: [
      `场地面积：${formatAreaM2(stats.boundaryAreaM2)}`,
      `功能分区：${stats.zoneCount} 个`,
      `设施：${stats.facilityCount} 项`,
      `动线：${stats.routeCount} 条 · 全长 ${formatLengthM(stats.routeLengthTotalM)}`,
      `出入口：${plan.nodes.length} 个`,
      `人员：${stats.workerTotalCount} 人 / ${plan.workers.length} 点位`,
      `测量：${stats.measurementCount} 条`,
      `冲突/缺失：${stats.conflictCount} 项`,
    ],
  });

  const inventory = buildPlanInventory(plan);
  const groups: { kind: string; rows: typeof inventory }[] = [
    { kind: '分区', rows: inventory.filter(r => r.kind === 'zone') },
    { kind: '设施', rows: inventory.filter(r => r.kind === 'facility') },
    { kind: '动线', rows: inventory.filter(r => r.kind === 'route') },
    { kind: '出入口与人员', rows: inventory.filter(r => r.kind === 'node' || r.kind === 'worker') },
  ];
  for (const group of groups) {
    if (group.rows.length === 0) continue;
    pages.push({
      title: `清单 · ${group.kind}`,
      lines: group.rows.map(row => `${row.name}（${row.typeLabel}${row.zoneName ? ' · ' + row.zoneName : ''}）— ${row.metric}${row.hasIssue ? ' ⚠' : ''}`),
    });
  }
  return pages;
}

/** 图例文本行（打印版式用，复用 H3-c 图例生成器同一来源）。 */
export function deckLegendLines(plan: SitePlanData): string[] {
  return buildPlanLegend(plan)
    .flatMap(group => group.entries.map(entry => `${entry.label} ×${entry.count}${entry.detail ? `（${entry.detail}）` : ''}`));
}

/** 演示稿署名（复用 PNG 署名口径）。 */
export function deckCaption(revision: number, exportedAt = new Date()): string {
  return snapshotCaption(revision, 72, exportedAt);
}

/* ---------------- DOM 注入与打印 ---------------- */

const PRINT_CONTAINER_ID = 'plan-pdf-deck-root';

/**
 * 打开打印对话框生成 PDF：注入隐藏打印容器（仅打印可见），调 window.print()，
 * 完成后移除容器。「另存为 PDF」由用户在打印对话框选择。
 */
export function printPlanDeck(snapshot: SitePlanSnapshot, snapshotPngDataUrl?: string): void {
  document.getElementById(PRINT_CONTAINER_ID)?.remove();
  const root = document.createElement('div');
  root.id = PRINT_CONTAINER_ID;
  root.setAttribute('aria-hidden', 'true');
  root.style.cssText = 'position:fixed;inset:auto;left:-9999px;top:0;width:794px;'; // A4 96dpi 宽度。

  const pages = buildDeckPages(snapshot, snapshotPngDataUrl);
  const legend = deckLegendLines(snapshot.data);
  const caption = deckCaption(snapshot.revision);

  const style = document.createElement('style');
  style.textContent = `
    #${PRINT_CONTAINER_ID} { font: 13px/1.7 system-ui, 'Microsoft YaHei', sans-serif; color: #1f2937; background: #fff; padding: 32px; }
    #${PRINT_CONTAINER_ID} .deck-page { page-break-after: always; margin-bottom: 24px; }
    #${PRINT_CONTAINER_ID} .deck-page:last-child { page-break-after: auto; }
    #${PRINT_CONTAINER_ID} h2 { font-size: 17px; border-bottom: 2px solid #35624A; padding-bottom: 6px; color: #35624A; margin: 0 0 12px; }
    #${PRINT_CONTAINER_ID} li { margin: 3px 0; }
    #${PRINT_CONTAINER_ID} img.deck-snapshot { max-width: 100%; border: 1px solid #d8dee6; margin: 8px 0; }
    #${PRINT_CONTAINER_ID} .deck-caption { color: #6b7280; font-size: 11px; margin-top: 18px; border-top: 1px solid #e5e7eb; padding-top: 8px; }
    @media print {
      body > *:not(#${PRINT_CONTAINER_ID}) { display: none !important; }
      #${PRINT_CONTAINER_ID} { position: static !important; left: auto !important; width: auto !important; }
    }
  `;
  root.appendChild(style);

  for (const page of pages) {
    const section = document.createElement('div');
    section.className = 'deck-page';
    const heading = document.createElement('h2');
    heading.textContent = page.title;
    section.appendChild(heading);
    if (page.title === '封面' && snapshotPngDataUrl) {
      const img = document.createElement('img');
      img.className = 'deck-snapshot';
      img.src = snapshotPngDataUrl;
      section.appendChild(img);
    }
    const list = document.createElement('ul');
    for (const line of page.lines) {
      const li = document.createElement('li');
      li.textContent = line;
      list.appendChild(li);
    }
    section.appendChild(list);
    if (page.title === '总览') {
      const legendHeading = document.createElement('h2');
      legendHeading.textContent = '图例';
      legendHeading.style.marginTop = '16px';
      section.appendChild(legendHeading);
      const legendList = document.createElement('ul');
      for (const line of legend) {
        const li = document.createElement('li');
        li.textContent = line;
        legendList.appendChild(li);
      }
      section.appendChild(legendList);
    }
    root.appendChild(section);
  }
  const captionEl = document.createElement('p');
  captionEl.className = 'deck-caption';
  captionEl.textContent = caption;
  root.appendChild(captionEl);

  document.body.appendChild(root);
  window.print();
  // 打印对话框关闭后清理（部分浏览器同步返回）。
  setTimeout(() => root.remove(), 60_000);
}