import type { CameraPreset } from './types';

/**
 * 机位册只复用相机模块里已经稳定的预设，不去推导入口/分区人视点：
 * 那些推导依赖场地几何，取景一旦偏了，客户看到的就是一张没有信息的图。
 * 四个机位覆盖「整体 → 平面 → 正面 → 对角」四种检查角度。
 */
export interface AlbumShot {
  id: CameraPreset;
  label: string;
  /** 文件名里的序号与机位名，例如 `01-整体`。 */
  filePart: string;
}

export const ALBUM_SHOTS: ReadonlyArray<AlbumShot> = [
  { id: 'iso', label: '整体', filePart: '01-整体' },
  { id: 'top', label: '俯视', filePart: '02-俯视' },
  { id: 'front', label: '正面', filePart: '03-正面' },
  { id: 'corner', label: '对角', filePart: '04-对角' },
];

/** 统一命名：`<项目>_v<版本>_效果图`；未发布项目按 v0。 */
export function albumBaseName(projectName: string, revision = 'v0'): string {
  const name = (projectName || '')
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${name || '未命名活动'}_${revision}_效果图`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

export interface AlbumShotImage {
  label: string;
  dataUrl: string;
}

/**
 * 离线图册：图片全部内联成 data URL，不发一个外部请求；
 * 无脚本、无内部字段，浏览器直接打开或打印成 PDF。
 */
export function renderAlbumHtml(input: {
  projectName: string;
  generatedAt: string;
  shots: readonly AlbumShotImage[];
}): string {
  const generated = new Date(input.generatedAt);
  const when = Number.isFinite(generated.getTime()) ? generated.toLocaleString('zh-CN') : input.generatedAt;
  const project = escapeHtml(input.projectName || '未命名活动');
  const figures = input.shots.map((shot, index) => `<figure class="shot">
      <img src="${shot.dataUrl}" alt="${escapeHtml(shot.label)}" />
      <figcaption><span>${String(index + 1).padStart(2, '0')}</span>${escapeHtml(shot.label)}</figcaption>
    </figure>`).join('\n    ');
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'" />
    <title>${project} · 效果图册</title>
    <style>
      :root { color-scheme: light; }
      @page { size: A4 portrait; margin: 12mm; }
      body { margin: 0; color: #141416; background: #fff; font-family: Inter, Arial, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif; }
      header { padding: 0 0 6mm; border-bottom: 0.4mm solid #141416; }
      .brand { margin: 0 0 2mm; font-size: 8pt; letter-spacing: 0.12em; color: #71767E; }
      .brand i { display: inline-block; width: 2mm; height: 2mm; margin-right: 1.6mm; border-radius: 50%; background: #4A7C59; vertical-align: -0.2mm; }
      h1 { margin: 0 0 1.6mm; font-size: 18pt; line-height: 1.25; }
      .meta { margin: 0; font-size: 9pt; color: #71767E; }
      .shots { display: grid; gap: 6mm; padding: 6mm 0 0; }
      .shot { margin: 0; break-inside: avoid; page-break-inside: avoid; }
      .shot img { display: block; width: 100%; height: auto; background: #F4F4F5; }
      figcaption { display: flex; gap: 3mm; align-items: baseline; margin-top: 2mm; font-size: 10pt; }
      figcaption span { font-variant-numeric: tabular-nums; color: #71767E; font-size: 8pt; letter-spacing: 0.08em; }
      footer { margin-top: 8mm; padding-top: 3mm; border-top: 0.25mm solid #E4E4E7; font-size: 8pt; color: #71767E; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    </style>
  </head>
  <body>
    <header>
      <p class="brand"><i></i>幕景 Scendance</p>
      <h1>${project}</h1>
      <p class="meta">效果图册 · ${escapeHtml(when)} · 共 ${input.shots.length} 个机位</p>
    </header>
    <main class="shots">
    ${figures}
    </main>
    <footer>效果图为布置示意，非实测；实物规格与颜色以最终确认为准。</footer>
  </body>
</html>
`;
}
