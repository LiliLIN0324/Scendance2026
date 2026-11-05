'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { MaterialSymbol } from '@/components/room-organizer/panels/material-symbol';
import { ArrowRight, Box, Check, Download, FileImage, Info, Loader2, Upload, X } from '@/components/solid-icons';
import type { AnalyzedImage } from '@/lib/capture-guide/image-analysis';
import { consume, release, PayError } from '@/lib/pay/client';
import {
  SCENE_JOB_REQUIREMENTS,
  buildSceneJob,
  sceneJobFileName,
  sceneJobJson,
} from '@/lib/capture-guide/scene-job';
import type { CaptureMode, CaptureScore } from '@/lib/capture-guide/scoring';

/**
 * 出 3D：网页端唯一的重建出口。
 *
 * 照片 → 3D 必须经过后端重建，本页不假装能算。它把出口拆成两半：
 * 1. 交出去：生成 scene-job 任务包（素材清单 + 验收要求 + 接口合同）；
 * 2. 接回来：把重建产物归一化导出成可直接用的 GLB，原始 PLY/SPZ 原样另存。
 */

export interface SceneExportProps {
  frames: AnalyzedImage[];
  mode: CaptureMode;
  score: CaptureScore | null;
  scaleMeters: number | null;
  gateReady: boolean;
}

type ExportResult =
  | { kind: 'glb'; fileName: string; width: number; depth: number; height: number; unit: string; upAxis: string }
  | { kind: 'raw'; fileName: string; extension: string };

const RAW_EXTENSIONS = ['ply', 'spz', 'splat', 'glb', 'gltf', 'obj'];

function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function meters(value: number): string {
  return `${(Math.round(value * 100) / 100).toFixed(2)} m`;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SceneExport({ frames, mode, score, scaleMeters, gateReady }: SceneExportProps): JSX.Element {
  const [jobSaved, setJobSaved] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ExportResult | null>(null);
  const [credit, setCredit] = useState<{ remaining: number } | null>(null);
  const [jobId] = useState(() => `scan-${Math.random().toString(36).slice(2, 10)}`);
  const attemptRef = useRef(1);
  const glbInputRef = useRef<HTMLInputElement>(null);

  const job = useMemo(
    () =>
      buildSceneJob({
        mode,
        frames: frames.map(frame => ({
          name: frame.name,
          layer: frame.layer,
          width: frame.width,
          height: frame.height,
          meanLuma: frame.meanLuma,
          sharpness: frame.sharpness,
          heading: frame.heading,
          gps: frame.gps,
          at: frame.at,
        })),
        scaleMeters,
        score,
        createdAt: Date.now(),
      }),
    [frames, mode, score, scaleMeters],
  );

  const extension = file ? extensionOf(file.name) : '';
  const isGlb = extension === 'glb' || extension === 'gltf';
  const isRaw = RAW_EXTENSIONS.includes(extension);

  /** 交出去 = 提交一次重建任务：先预扣 1 次，任务包没生成成功就立刻返还。 */
  async function saveJob(): Promise<void> {
    if (busy) return;
    setError('');
    setJobSaved(false);
    setBusy('正在预扣 1 次重建额度…');
    try {
      const reserved = await consume({ jobId, attempt: attemptRef.current });
      setCredit({ remaining: reserved.remaining });
      try {
        downloadBlob(
          new Blob([sceneJobJson(job)], { type: 'application/json' }),
          sceneJobFileName(Date.now()),
        );
        setJobSaved(true);
      } catch (failure) {
        // 任务包没交出去：立刻返还，并推进 attempt，下次提交用新的幂等键。
        await release(reserved.idempotencyKey).catch(() => undefined);
        attemptRef.current += 1;
        setCredit(null);
        throw new Error(`任务包导出失败，本次额度已返还：${failure instanceof Error ? failure.message : '未知原因'}`);
      }
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '提交失败，请重试。';
      setError(failure instanceof PayError && failure.code === 'INSUFFICIENT_CREDITS'
        ? '没有可用次数：先购买一档，再回来提交。'
        : message);
    } finally {
      setBusy('');
    }
  }

  async function exportNormalizedGlb(target: File): Promise<void> {
    setBusy('正在载入 GLB…');
    setError('');
    setResult(null);
    try {
      const [{ GLTFLoader }, { GLTFExporter }, { normalizeGlbRoot }] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/exporters/GLTFExporter.js'),
        import('@/components/room-organizer/lib/glb-normalize'),
      ]);
      setBusy('正在按 Y-up / 米制 / 底面贴地归一化…');
      const buffer = await target.arrayBuffer();
      const gltf = await new GLTFLoader().parseAsync(buffer, '');
      const normalized = normalizeGlbRoot(gltf.scene);
      setBusy('正在重新打包 GLB…');
      const exported = await new GLTFExporter().parseAsync(normalized.root, { binary: true });
      if (!(exported instanceof ArrayBuffer)) throw new Error('导出器没有返回二进制 GLB。');
      const fileName = `${target.name.replace(/\.[^.]+$/, '')}-normalized.glb`;
      downloadBlob(new Blob([exported], { type: 'model/gltf-binary' }), fileName);
      setResult({
        kind: 'glb',
        fileName,
        width: normalized.size.width,
        depth: normalized.size.depth,
        height: normalized.size.height,
        unit: normalized.plan.unit,
        upAxis: normalized.plan.upAxis,
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '归一化失败，请检查文件是否为有效 GLB。');
    } finally {
      setBusy('');
    }
  }

  async function exportRaw(target: File): Promise<void> {
    setError('');
    setResult(null);
    try {
      const extensionLabel = extensionOf(target.name);
      const fileName = `${target.name.replace(/\.[^.]+$/, '')}-raw.${extensionLabel}`;
      downloadBlob(target, fileName);
      setResult({ kind: 'raw', fileName, extension: extensionLabel });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '原始件导出失败。');
    }
  }

  const ready = gateReady && job.status === 'ready';

  return (
    <>
      <section className="cg-alert cg-alert--cap" data-testid="exit-gap">
        <div className="cg-alert-title"><Info size={17} aria-hidden="true" /> 先说清楚：网页端还不能自己算出 3D</div>
        <p>
          照片变 3D 必须有重建服务。本页做的是出口的两端：把素材清单交出去，把重建产物归一化接回来。
          {' '}缺的是后端两跳（<code>/recon-upload</code> → <code>/world-recon</code>）与密钥；列表在下面的任务包里。
        </p>
      </section>

      <section className="cg-card">
        <div className="cg-card-head">
          <div className="cg-card-title">
            <span className="cg-icon"><Box size={20} aria-hidden="true" /></span>
            <div>
              <strong>交付三件套</strong>
              <span>现场照片不在这三件里；它们都从重建开始。</span>
            </div>
          </div>
        </div>
        <ul className="cg-exit-list">
          <li><b>可直接用的场景</b><span>GLB，米制、Y-up、底面中心在原点，进编辑器不用再修 transform。</span></li>
          <li><b>原始件</b><span>PLY / SPZ 原样导出，留给要自己处理点云与高斯的专业用户。</span></li>
          <li><b>拍摄任务包</b><span><code>scendance.scene-job/v1</code>，一帧一行元数据，桌面端与后端都按它对接。</span></li>
        </ul>
      </section>

      <section className="cg-card" data-testid="scene-job">
        <div className="cg-card-head">
          <div className="cg-card-title">
            <span className="cg-icon"><Upload size={20} aria-hidden="true" /></span>
            <div>
              <strong>第一步 · 把任务交出去</strong>
              <span>门槛是同一组数字，不在出口另立标准。</span>
            </div>
          </div>
          <span className={`cg-status ${ready ? 'cg-status--active' : 'cg-status--denied'}`}>
            {ready ? '可提交' : '未达标'}
          </span>
        </div>
        <div className="cg-exit-requirements">
          <span>{job.capture.stations} / {SCENE_JOB_REQUIREMENTS.minStations} 机位</span>
          <span>{job.capture.coverageDeg}° / {SCENE_JOB_REQUIREMENTS.minCoverageDeg}°</span>
          <span>三层各 ≥ {SCENE_JOB_REQUIREMENTS.minPerLayer}</span>
          <span>{scaleMeters === null ? '缺尺度' : `${meters(scaleMeters)} 基准`}</span>
        </div>
        {job.blockers.length > 0 && (
          <ul className="cg-exit-blockers">
            {job.blockers.slice(0, 4).map(item => <li key={item}><X size={13} aria-hidden="true" />{item}</li>)}
          </ul>
        )}
        <button type="button" className="cg-btn cg-btn--primary" onClick={() => void saveJob()} disabled={frames.length === 0 || Boolean(busy)}>
          {busy ? <Loader2 size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
          {busy || '生成重建任务包'}
        </button>
        {credit && (
          <p className="cg-note" role="status">
            <Check size={14} aria-hidden="true" /> 已预扣 1 次，剩余 <b>{credit.remaining}</b> 次。重建失败或超时未出结果会自动返还。
          </p>
        )}
        {jobSaved && (
          <p className="cg-note" role="status">
            <Check size={14} aria-hidden="true" /> 任务包已保存。状态：<b>本地已排队</b>，等后端接上
            <code> /recon-upload</code> 与 <code>/world-recon</code> 后可直接投递。
          </p>
        )}
        <details className="cg-fold">
          <summary>
            <span>任务包里有什么</span>
            <span>{job.frames.length} 帧</span>
          </summary>
          <ul className="cg-exit-gaps">
            <li>每帧：文件名、层、分辨率、平均亮度、清晰度、朝向、GPS、时间。</li>
            {job.gaps.map(item => <li key={item}>{item}</li>)}
          </ul>
        </details>
      </section>

      <section className="cg-card" data-testid="scene-import">
        <div className="cg-card-head">
          <div className="cg-card-title">
            <span className="cg-icon"><FileImage size={20} aria-hidden="true" /></span>
            <div>
              <strong>第二步 · 把产物接回来并导出</strong>
              <span>重建完成后，把 .glb / .ply / .spz 选进来。</span>
            </div>
          </div>
        </div>
        <button type="button" className="cg-btn cg-btn--ghost" onClick={() => glbInputRef.current?.click()} disabled={Boolean(busy)}>
          <Upload size={16} aria-hidden="true" />
          选择重建产物
        </button>
        <input
          ref={glbInputRef}
          type="file"
          accept=".glb,.gltf,.ply,.spz,.splat,.obj"
          className="cg-sr"
          data-testid="glb-input"
          onChange={event => {
            const next = event.target.files?.[0] ?? null;
            event.target.value = '';
            setFile(next);
            setResult(null);
            setError('');
          }}
        />
        {file && (
          <p className="cg-note"><FileImage size={14} aria-hidden="true" /> {file.name} · {isRaw ? '识别为重建产物' : '扩展名不在支持列表'}</p>
        )}
        {file && isGlb && (
          <button
            type="button"
            className="cg-btn cg-btn--primary"
            disabled={Boolean(busy)}
            onClick={() => void exportNormalizedGlb(file)}
            data-testid="normalize-glb"
          >
            {busy ? <Loader2 size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
            {busy || '归一化并导出 GLB'}
          </button>
        )}
        {file && isRaw && !isGlb && (
          <button type="button" className="cg-btn cg-btn--primary" onClick={() => void exportRaw(file)}>
            <Download size={16} aria-hidden="true" />
            原样导出 {extension.toUpperCase()}
          </button>
        )}
        {file && isGlb && (
          <button type="button" className="cg-btn cg-btn--ghost" onClick={() => void exportRaw(file)} disabled={Boolean(busy)}>
            原样导出 {extension.toUpperCase()}（不归一化）
          </button>
        )}
        {error && <p className="cg-error" role="alert">{error}</p>}
        {result?.kind === 'glb' && (
          <div className="cg-exit-result" role="status">
            <strong>{result.fileName}</strong>
            <p>
              已归一化：宽 {meters(result.width)} × 深 {meters(result.depth)} × 高 {meters(result.height)} ·
              Y-up（+Y 向上）· 底面中心在原点 · 读取时按{result.unit === 'cm' ? '厘米' : '米'}换算 ·
              {result.upAxis === 'z' ? '源文件按 Z-up 旋转过' : '源文件本来就是 Y-up'}
            </p>
          </div>
        )}
        {result?.kind === 'raw' && (
          <div className="cg-exit-result" role="status">
            <strong>{result.fileName}</strong>
            <p>原样导出：未做坐标轴与单位转换，尺度与坐标系以源 {result.extension.toUpperCase()} 文件为准，交给专业工具处理。</p>
          </div>
        )}
      </section>

      <section className="cg-card">
        <div className="cg-card-head">
          <div className="cg-card-title">
            <span className="cg-icon"><MaterialSymbol name="fact_check" size={20} aria-hidden="true" /></span>
            <div>
              <strong>出口验收 · 五项</strong>
              <span>逐项对，不靠感觉。</span>
            </div>
          </div>
        </div>
        <ul className="cg-exit-table">
          <li className={result?.kind === 'glb' ? 'is-ok' : ''}>
            <b>打开就在地上</b><span>{result?.kind === 'glb' ? '已满足：底面中心移到 y=0' : '导出时执行，尚未导出'}</span>
          </li>
          <li className={result?.kind === 'glb' ? 'is-ok' : ''}>
            <b>比例是对的</b><span>{result?.kind === 'glb' ? '已满足：米制，最长边 0.005–50 m 内' : '导出时执行，超范围会直接报错'}</span>
          </li>
          <li className="is-warn">
            <b>能继续编辑</b><span>未接：工作台还没有本机 GLB 导入入口，选中/移动/旋转目前只对线上资产生效。</span>
          </li>
          <li className={result ? 'is-ok' : ''}>
            <b>两种产物</b><span>{result ? '已导出一种；另一种随时可再导' : '归一化 GLB + 原始 PLY / SPZ'}</span>
          </li>
          <li className={result ? 'is-ok' : ''}>
            <b>一行说明</b><span>{result ? '已在结果卡里给出尺寸、坐标系与是否归一化' : '导出后显示尺寸、坐标系与归一化状态'}</span>
          </li>
        </ul>
        <Link className="cg-btn cg-btn--ghost" href="/">
          去工作台看场地
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>
    </>
  );
}
