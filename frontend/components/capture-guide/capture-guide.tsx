'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { MaterialSymbol } from '@/components/room-organizer/panels/material-symbol';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Camera,
  Check,
  ClipboardCheck,
  Compass,
  Copy,
  Download,
  FileImage,
  Globe,
  Info,
  Layers,
  Loader2,
  Lock,
  MapPin,
  RotateCcw,
  Ruler,
  Scan,
  ShieldCheck,
  Upload,
  Users,
  Video,
  X,
} from '@/components/solid-icons';
import {
  analyseImageFile,
  analyseVideoFile,
  duplicateIdsFor,
  type AnalyzedImage,
} from '@/lib/capture-guide/image-analysis';
import {
  CAPTURE_LAYERS,
  LAYER_LABELS,
  MIN_DELIVERABLE_STATIONS,
  STABLE_STATIONS,
  TARGET_PER_LAYER,
  THRESHOLD_SOURCES,
  countDistinctFrames,
  formatMeters,
  headingCoverage,
  isValidScale,
  normaliseHeading,
  parseScaleMeters,
  scoreCapture,
  scoreScanImport,
  type CaptureLayer,
  type CaptureMode,
  type CaptureScore,
  type CaptureVerdict,
  type GpsFix,
} from '@/lib/capture-guide/scoring';

type StepId = 'mode' | 'rules' | 'orbit' | 'scale' | 'verify' | 'scan' | 'score' | 'examples' | 'receipt';
type GpsStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'unavailable';
type CompassStatus = 'idle' | 'requesting' | 'active' | 'unsupported' | 'denied';
type BusyState = { done: number; total: number; label: string } | null;
type ScanCompleteness = 'complete' | 'partial' | 'unknown';

const CAPTURE_STEPS: StepId[] = ['mode', 'rules', 'orbit', 'scale', 'verify', 'score', 'examples', 'receipt'];
const SCAN_STEPS: StepId[] = ['mode', 'scan', 'score', 'examples', 'receipt'];

const STEP_LABELS: Record<StepId, string> = {
  mode: '选择路径',
  rules: '硬性前提',
  orbit: '环绕拍摄',
  scale: '尺度基准',
  verify: '现场校验',
  scan: '导入自检',
  score: '评分结果',
  examples: '失败案例',
  receipt: '采集凭证',
};

const VERDICT_META: Record<CaptureVerdict, { label: string; detail: string; tone: string; hex: string }> = {
  ready: {
    label: '可直接跑',
    detail: '材料够重建。可以带进 Scendance 上传了。',
    tone: 'ready',
    hex: '#4A7C59',
  },
  supplement: {
    label: '建议补拍',
    detail: '主体可用，但扣分项会让重建打折。先在现场补掉。',
    tone: 'supplement',
    hex: '#96651F',
  },
  redo: {
    label: '重采',
    detail: '这批素材大概率在重建阶段失败，不要上传浪费时间。',
    tone: 'redo',
    hex: '#B4443C',
  },
};

function InfoNote({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <details className="cg-info">
      <summary aria-label={label}>
        <Info size={14} aria-hidden="true" />
      </summary>
      <div className="cg-info-pop">{children}</div>
    </details>
  );
}

function StepHead({
  eyebrow,
  title,
  lead,
  aside,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  aside?: ReactNode;
}): JSX.Element {
  return (
    <div className="cg-stephead">
      <div className="cg-eyebrow">{eyebrow}</div>
      <h1 className="cg-title">{title}</h1>
      <p className="cg-lead">{lead}</p>
      {aside}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function scaleStatusText(value: string, meters: number | null): string {
  if (!value.trim()) return '还没有录入尺度。至少写一个已知长度，否则下一步不能继续。';
  if (!isValidScale(meters)) return '范围需要在 0.1–100m 之间。例如 20cm、1.2m、两米。';
  return `已记录 ${formatMeters(meters)}，会写进采集凭证。`;
}

function scoreStatItems(score: CaptureScore, scanMode: boolean, scaleMeters: number | null): Array<{ label: string; value: string }> {
  if (scanMode) {
    return [
      { label: '扫描文件', value: `${score.metrics.frames}` },
      { label: '尺度', value: isValidScale(scaleMeters) ? formatMeters(scaleMeters) : '缺失' },
      { label: '完整性', value: score.items.find(item => item.key === 'completeness')?.detail.replace('扫描完整性：', '') ?? '未确认' },
    ];
  }
  return [
    { label: '机位', value: `${score.metrics.frames}` },
    { label: '层数', value: `${score.metrics.layers} / 3` },
    { label: '覆盖角', value: `${Math.round(score.metrics.coverageDeg)}°` },
    { label: 'GPS 覆盖', value: `${Math.round(score.metrics.gpsGoodCoverage * 100)}%` },
    { label: '尺度', value: isValidScale(scaleMeters) ? formatMeters(scaleMeters) : '缺失' },
    { label: '时长', value: score.metrics.durationMinutes === null ? '—' : `${Math.round(score.metrics.durationMinutes)} 分` },
  ];
}

export function CaptureGuide(): JSX.Element {
  const [selectedMode, setSelectedMode] = useState<CaptureMode | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [rulesConfirmed, setRulesConfirmed] = useState(false);
  const [orbitConfirmed, setOrbitConfirmed] = useState(false);
  const [scaleInput, setScaleInput] = useState('');
  const [frames, setFrames] = useState<AnalyzedImage[]>([]);
  const [layer, setLayer] = useState<CaptureLayer>('eye');
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('idle');
  const [gpsError, setGpsError] = useState('');
  const [gpsFixes, setGpsFixes] = useState<GpsFix[]>([]);
  const [compassStatus, setCompassStatus] = useState<CompassStatus>('idle');
  const [heading, setHeading] = useState<number | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);
  const [notice, setNotice] = useState('');
  const [scanFiles, setScanFiles] = useState<File[]>([]);
  const [scanCompleteness, setScanCompleteness] = useState<ScanCompleteness>('unknown');
  const [score, setScore] = useState<CaptureScore | null>(null);
  const [scoreAt, setScoreAt] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const latestFixRef = useRef<GpsFix | null>(null);
  const headingRef = useRef<number | null>(null);
  const watchRef = useRef<number | null>(null);
  const captureStartRef = useRef<number | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const steps = selectedMode === 'scan' ? SCAN_STEPS : CAPTURE_STEPS;
  const safeIndex = Math.min(stepIndex, steps.length - 1);
  const currentStep: StepId = steps[safeIndex] ?? 'mode';
  const scanMode = selectedMode === 'scan';
  const scaleMeters = useMemo(() => parseScaleMeters(scaleInput), [scaleInput]);
  const scaleOk = isValidScale(scaleMeters);

  const onOrientation = useCallback((event: DeviceOrientationEvent) => {
    const compassEvent = event as DeviceOrientationEvent & { webkitCompassHeading?: number };
    const raw = compassEvent.webkitCompassHeading ?? (typeof event.alpha === 'number' ? 360 - event.alpha : null);
    if (raw === null || !Number.isFinite(raw)) return;
    const next = normaliseHeading(raw);
    headingRef.current = next;
    setHeading(next);
    setCompassStatus('active');
  }, []);

  useEffect(() => {
    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
      window.removeEventListener('deviceorientation', onOrientation as EventListener);
    };
  }, [onOrientation]);

  const duplicateIds = useMemo(() => duplicateIdsFor(frames), [frames]);
  const distinctFrames = useMemo(() => countDistinctFrames(frames), [frames]);
  const layerCounts = useMemo(() => {
    const counts: Record<CaptureLayer, number> = { low: 0, eye: 0, high: 0 };
    for (const frame of frames) counts[frame.layer] += 1;
    return counts;
  }, [frames]);
  const darkCount = frames.filter(frame => frame.meanLuma < 45 || frame.darkRatio > 0.5).length;
  const brightCount = frames.filter(frame => frame.meanLuma > 210 || frame.brightRatio > 0.12).length;
  const lowResCount = frames.filter(frame => Math.min(frame.width, frame.height) < 1080).length;
  const missingGpsCount = frames.filter(frame => frame.gps === null || frame.gps.accuracy > 10).length;
  const headingStats = useMemo(() => headingCoverage(frames.map(frame => frame.heading)), [frames]);
  const liveCoverage = headingStats.samples >= Math.min(12, Math.max(1, frames.length))
    ? headingStats.coverageDeg
    : Math.min(360, distinctFrames * 5);

  function chooseMode(mode: CaptureMode): void {
    if (mode !== selectedMode) {
      setScore(null);
      setScoreAt(null);
    }
    setSelectedMode(mode);
  }

  function startGps(): void {
    if (!navigator.geolocation) {
      setGpsStatus('unavailable');
      setGpsError('这个浏览器没有定位能力，请换用手机浏览器。');
      return;
    }
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    setGpsStatus('requesting');
    setGpsError('');
    watchRef.current = navigator.geolocation.watchPosition(
      position => {
        const fix: GpsFix = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          at: position.timestamp,
        };
        latestFixRef.current = fix;
        setGpsStatus('active');
        setGpsError('');
        setGpsFixes(previous => {
          const last = previous[previous.length - 1];
          if (
            last &&
            Math.abs(last.latitude - fix.latitude) < 0.0000001 &&
            Math.abs(last.longitude - fix.longitude) < 0.0000001
          ) {
            return [...previous.slice(0, -1), fix];
          }
          return [...previous.slice(-29), fix];
        });
      },
      error => {
        setGpsStatus(error.code === 1 ? 'denied' : 'unavailable');
        setGpsError(
          error.code === 1
            ? '定位权限被拒绝。请在浏览器或系统设置里允许定位，再回来重试。'
            : '暂时拿不到定位。到空旷处重试，或检查手机是否开了 GPS。',
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }

  async function startCompass(): Promise<void> {
    if (typeof DeviceOrientationEvent === 'undefined') {
      setCompassStatus('unsupported');
      return;
    }
    setCompassStatus('requesting');
    const constructor = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<string>;
    };
    if (typeof constructor.requestPermission === 'function') {
      try {
        const permission = await constructor.requestPermission();
        if (permission !== 'granted') {
          setCompassStatus('denied');
          return;
        }
      } catch {
        setCompassStatus('denied');
        return;
      }
    }
    window.addEventListener('deviceorientation', onOrientation as EventListener);
    window.setTimeout(() => {
      if (headingRef.current === null) setCompassStatus('unsupported');
    }, 1600);
  }

  function markCaptureStart(at: number): void {
    if (captureStartRef.current === null) captureStartRef.current = at;
  }

  async function handleImageFiles(fileList: FileList | File[] | null): Promise<void> {
    if (!fileList) return;
    const files = Array.isArray(fileList) ? fileList : Array.from(fileList);
    if (files.length === 0) return;
    setNotice('');
    let failed = 0;
    setBusy({ done: 0, total: files.length, label: '正在快检图片' });
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (!file) continue;
      try {
        const analyzed = await analyseImageFile(file, {
          layer,
          gps: latestFixRef.current,
          heading: headingRef.current,
          at: Date.now() + index,
        });
        markCaptureStart(analyzed.at ?? Date.now());
        setFrames(previous => [...previous, analyzed]);
      } catch {
        failed += 1;
      }
      setBusy({ done: index + 1, total: files.length, label: `正在快检图片 ${index + 1}/${files.length}` });
    }
    setBusy(null);
    if (failed > 0) setNotice(`${failed} 张图片无法解码，已跳过。请确认是 JPG / PNG / HEIC 原片。`);
  }

  async function handleVideoFiles(fileList: FileList | File[] | null): Promise<void> {
    if (!fileList) return;
    const files = Array.isArray(fileList) ? fileList : Array.from(fileList);
    if (files.length === 0) return;
    setNotice('');
    let failed = 0;
    let added = 0;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (!file) continue;
      setBusy({ done: 0, total: 1, label: `正在抽帧 ${file.name}` });
      const extracted = await analyseVideoFile(
        file,
        {
          layer,
          gps: latestFixRef.current,
          heading: headingRef.current,
          at: Date.now() + index * 1000,
        },
        (done, total) => setBusy({ done, total, label: `正在抽帧 ${file.name} ${done}/${total}` }),
      );
      if (extracted.length === 0) {
        failed += 1;
      } else {
        added += extracted.length;
        markCaptureStart(extracted[0]?.at ?? Date.now());
        setFrames(previous => [...previous, ...extracted]);
      }
    }
    setBusy(null);
    if (failed > 0) setNotice(`${failed} 段视频无法解码。请改用「选照片」逐张补拍。`);
    else if (added > 0) setNotice(`已从视频抽出 ${added} 帧做曝光与重复快检。`);
  }

  function runScore(kind: 'capture' | 'scan'): void {
    const at = Date.now();
    const duration =
      captureStartRef.current === null ? null : Math.max(0, (at - captureStartRef.current) / 60000);
    const nextScore =
      kind === 'scan'
        ? scoreScanImport({
            fileCount: scanFiles.length,
            scaleMeters,
            completeness: scanCompleteness,
          })
        : scoreCapture({
            mode: selectedMode === 'video' ? 'video' : 'photo',
            frames,
            scaleMeters,
            durationMinutes: duration,
          });
    setScore(nextScore);
    setScoreAt(at);
    setStepIndex(steps.indexOf('score'));
  }

  const canAdvance =
    currentStep === 'mode'
      ? selectedMode !== null
      : currentStep === 'rules'
        ? rulesConfirmed
        : currentStep === 'orbit'
          ? orbitConfirmed
          : currentStep === 'scale'
            ? scaleOk
            : currentStep === 'scan'
              ? scanFiles.length > 0 && scaleOk
              : true;

  function advance(): void {
    if (!canAdvance) return;
    if (currentStep === 'verify') {
      runScore('capture');
      return;
    }
    if (currentStep === 'scan') {
      runScore('scan');
      return;
    }
    setStepIndex(index => Math.min(index + 1, steps.length - 1));
  }

  function goBack(): void {
    setStepIndex(index => Math.max(0, index - 1));
  }

  const receiptJson = useMemo(() => {
    if (!score) return '';
    const payload = {
      schema: 'scendance.capture/v1',
      generatedAt: scoreAt === null ? null : new Date(scoreAt).toISOString(),
      mode: selectedMode ?? 'photo',
      score: score.total,
      verdict: score.verdict,
      stations: score.metrics.frames,
      layers: score.metrics.layers,
      layerCounts: score.metrics.layerCounts,
      coverageDeg: Math.round(score.metrics.coverageDeg),
      coverageEstimated: score.metrics.coverageEstimated,
      gpsCoverage: Math.round(score.metrics.gpsGoodCoverage * 1000) / 1000,
      gpsMedianAccuracy: score.metrics.gpsMedianAccuracy,
      scaleMeters,
      durationMinutes: score.metrics.durationMinutes === null ? null : Math.round(score.metrics.durationMinutes),
      blockers: score.blockers,
      caps: score.caps,
      deductions: score.deductions
        .filter(deduction => deduction.points > 0)
        .map(deduction => ({ label: deduction.label, points: deduction.points, detail: deduction.detail })),
    };
    return JSON.stringify(payload, null, 2);
  }, [score, scoreAt, selectedMode, scaleMeters]);

  function downloadReceipt(): void {
    if (!receiptJson) return;
    const stamp = new Date(scoreAt ?? Date.now()).toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const blob = new Blob([receiptJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `scendance-capture-${stamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('采集凭证已下载。');
  }

  async function copyReceipt(): Promise<void> {
    if (!receiptJson) return;
    try {
      await navigator.clipboard.writeText(receiptJson);
      setCopied(true);
      setNotice('采集凭证已复制。');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setNotice('浏览器不允许自动复制。请长按下面的 JSON 手动复制。');
    }
  }

  function restart(): void {
    setSelectedMode(null);
    setStepIndex(0);
    setRulesConfirmed(false);
    setOrbitConfirmed(false);
    setScaleInput('');
    setFrames([]);
    setLayer('eye');
    setScanFiles([]);
    setScanCompleteness('unknown');
    setScore(null);
    setScoreAt(null);
    setGpsFixes([]);
    setGpsStatus('idle');
    setGpsError('');
    setHeading(null);
    setCompassStatus('idle');
    setBusy(null);
    setNotice('');
    latestFixRef.current = null;
    headingRef.current = null;
    captureStartRef.current = null;
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
  }

  const nextLabel =
    currentStep === 'mode'
      ? '开始自检'
      : currentStep === 'verify' || currentStep === 'scan'
        ? '生成可重建性评分'
        : currentStep === 'score'
          ? '生成采集凭证'
          : currentStep === 'examples'
            ? '生成采集凭证'
            : '下一步';

  const verdict = score ? VERDICT_META[score.verdict] : null;

  return (
    <div className="cg-page">
      <div className="cg-shell">
        <header className="cg-top">
          <Link className="cg-brand" href="/" aria-label="回到幕景工作台">
            <BrandMark size={24} />
            <span>幕景</span>
          </Link>
          <span className="cg-top-title">采集守门员</span>
          <Link className="cg-top-link" href="/">
            工作台
          </Link>
        </header>

        <div className="cg-progress" aria-hidden="true">
          {steps.map((step, index) => (
            <span key={step} className={index <= safeIndex ? 'is-done' : ''} />
          ))}
        </div>
        <div className="cg-stepmeta">
          <span>
            第 {safeIndex + 1} / {steps.length} 步
          </span>
          <span>{STEP_LABELS[currentStep]}</span>
        </div>

        {notice && (
          <div className="cg-notice" role="status">
            <Info size={15} aria-hidden="true" />
            <span>{notice}</span>
            <button type="button" aria-label="关闭提示" onClick={() => setNotice('')}>
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        )}

        <main className="cg-main" data-step={currentStep}>
          {currentStep === 'mode' && (
            <>
              <StepHead
                eyebrow="现场采集 · 5 分钟自检"
                title="先选一条采集路径"
                lead="守门员只做一件事：在你离开场地前，判断这批素材能不能重建。不通过就不上传。"
              />
              <div className="cg-modes">
                <button
                  type="button"
                  className={`cg-mode ${selectedMode === 'photo' ? 'is-selected' : ''}`}
                  aria-pressed={selectedMode === 'photo'}
                  onClick={() => chooseMode('photo')}
                  data-testid="mode-photo"
                >
                  <span className="cg-mode-icon"><Camera size={24} aria-hidden="true" /></span>
                  <span className="cg-mode-body">
                    <span className="cg-mode-kicker">最稳 · 推荐</span>
                    <strong>拍照采集</strong>
                    <span className="cg-mode-desc">三层环绕走位，逐张控制曝光，最适合室内与单物体。</span>
                    <span className="cg-mode-fit"><Check size={13} aria-hidden="true" /> 室内小场地 / 活动布置 / 单物体</span>
                    <span className="cg-mode-unfit"><X size={13} aria-hidden="true" /> 大范围野外 / 光线快速变化</span>
                  </span>
                </button>
                <button
                  type="button"
                  className={`cg-mode ${selectedMode === 'video' ? 'is-selected' : ''}`}
                  aria-pressed={selectedMode === 'video'}
                  onClick={() => chooseMode('video')}
                  data-testid="mode-video"
                >
                  <span className="cg-mode-icon"><Video size={24} aria-hidden="true" /></span>
                  <span className="cg-mode-body">
                    <span className="cg-mode-kicker">走位连续</span>
                    <strong>视频采集</strong>
                    <span className="cg-mode-desc">沿闭环匀速走，转角放慢。浏览器会按秒抽帧做快检。</span>
                    <span className="cg-mode-fit"><Check size={13} aria-hidden="true" /> 大空间 / 快速覆盖 / 三脚架稳定</span>
                    <span className="cg-mode-unfit"><X size={13} aria-hidden="true" /> 快速转身 / 夜景手持 / 水面反光</span>
                  </span>
                </button>
                <button
                  type="button"
                  className={`cg-mode ${selectedMode === 'scan' ? 'is-selected' : ''}`}
                  aria-pressed={selectedMode === 'scan'}
                  onClick={() => chooseMode('scan')}
                  data-testid="mode-scan"
                >
                  <span className="cg-mode-icon"><Scan size={24} aria-hidden="true" /></span>
                  <span className="cg-mode-body">
                    <span className="cg-mode-kicker">跳过拍摄</span>
                    <strong>已有扫描结果</strong>
                    <span className="cg-mode-desc">只验文件、尺度与完整性，不再要求环绕机位。</span>
                    <span className="cg-mode-fit"><Check size={13} aria-hidden="true" /> 已用 360 / 专业设备完成扫描</span>
                    <span className="cg-mode-unfit"><X size={13} aria-hidden="true" /> 只有单张全景 / 没有真实尺度</span>
                  </span>
                </button>
              </div>
              <div className="cg-tip">
                <ShieldCheck size={16} aria-hidden="true" />
                <span>三种路径的口径不同：拍照 / 视频看机位、层数、GPS 与尺度；已有扫描只看文件、尺度与闭环。</span>
              </div>
            </>
          )}

          {currentStep === 'rules' && (
            <>
              <StepHead
                eyebrow="02 硬性前提"
                title="这五条不满足，后面补不回来"
                lead="先把相机锁死，再谈拍多少张。手机默认的自动曝光、自动白平衡，是重建失败的第一大来源。"
              />
              <div className="cg-card-list">
                <PrerequisiteCard
                  icon={<MaterialSymbol name="light_mode" size={22} aria-hidden="true" />}
                  title="白天拍摄，选柔光时段"
                  text="早上 9–11 点或下午 3–5 点；阴天最好。避开正午硬阴影。"
                  info="强光下总拍摄时长 ≤30 分钟；阴天 ≤2 小时。超过这个时间，太阳角度变化会让同一面墙的阴影对不上。"
                />
                <PrerequisiteCard
                  icon={<Lock size={22} aria-hidden="true" />}
                  title="锁定曝光与白平衡"
                  text="关自动曝光、自动白平衡、自动对焦；手动设快门 ≥1/240s，ISO 尽量低。"
                  info="每换一个区域可以重新测光，但同一区域里不要每张都变参数。分辨率建议 4K+，广角约 120°，超广角畸变会拖慢匹配。"
                />
                <PrerequisiteCard
                  icon={<Users size={22} aria-hidden="true" />}
                  title="清场，清掉会动的东西"
                  text="人、车、飘动的树叶都会在帧间换位置。室内先录 10 秒视频查灯光频闪。"
                  info="劣质 LED 的频闪会让同一场景的亮度一张一个样。玻璃、镜面、大面积反光目前没有稳定的拍摄解法，尽量避开。"
                />
                <PrerequisiteCard
                  icon={<Compass size={22} aria-hidden="true" />}
                  title="避免逆光"
                  text="太阳或强灯在镜头里，会把整张画面拉成剪影，暗部没有可匹配的纹理。"
                  info="逆光时即使人眼看着有细节，手机直方图也会把暗部压死。宁可绕到顺光侧，也不要靠后期拉回。"
                />
                <PrerequisiteCard
                  icon={<Globe size={22} aria-hidden="true" />}
                  title="别指望重建水面"
                  text="湖面会动、会反光。水面占比超过画面三分之一时，重建只能得到一层破碎的壳。"
                  info="我们的西湖素材就是反例：夜景 + 大面积水面 + 原地旋转，32 个文件没有一个带 GPS，最终无法使用。"
                />
              </div>
              <div className="cg-params">
                <div className="cg-params-title">
                  <span>相机里现在就改</span>
                  <InfoNote label="相机参数说明">
                    <p>这组参数来自《拍摄指南 2026》的通用要求；手机专业模式里能锁的项目都锁上。</p>
                    <p>没有专业模式的手机，至少长按屏幕锁定 AE/AF，再下滑曝光补偿。</p>
                  </InfoNote>
                </div>
                <div className="cg-param-chips">
                  <span>快门 ≥ 1/240s</span>
                  <span>ISO 最低可用</span>
                  <span>白平衡锁定</span>
                  <span>对焦锁定</span>
                  <span>4K 以上</span>
                  <span>约 120° 广角</span>
                </div>
              </div>
              <label className="cg-check">
                <input
                  type="checkbox"
                  checked={rulesConfirmed}
                  onChange={event => setRulesConfirmed(event.target.checked)}
                  data-testid="rules-confirm"
                />
                <span className="cg-check-box" aria-hidden="true">{rulesConfirmed && <Check size={14} />}</span>
                <span>以上参数已经在相机里锁定，现场不会改。</span>
              </label>
            </>
          )}

          {currentStep === 'orbit' && (
            <>
              <StepHead
                eyebrow="03 环绕拍摄"
                title="三层，每层 24–36 个机位"
                lead="不是站在原地转一圈。每拍一张，沿圆环向前走半步，让相邻两张有 70% 以上的重叠。"
              />
              <div className="cg-walk">
                <span className="cg-walk-icon"><Compass size={26} aria-hidden="true" /></span>
                <div>
                  <strong>你必须走起来</strong>
                  <p>原地转 102° 的 24 张全景，我们实测过：GPS 位移 0m，重建直接失败。相机轨迹本身就是重建的骨架。</p>
                </div>
              </div>
              <div className="cg-layers">
                {CAPTURE_LAYERS.map(item => (
                  <div className={`cg-layer cg-layer--${item}`} key={item}>
                    <span className="cg-layer-dot" aria-hidden="true" />
                    <span className="cg-layer-body">
                      <strong>{LAYER_LABELS[item]}</strong>
                      <span>
                        {item === 'low'
                          ? '仰角 35°，别拍到自己头'
                          : item === 'eye'
                            ? '平视，最接近人眼漫游'
                            : '俯角 35°，别拍到自己脚'}
                      </span>
                    </span>
                    <span className="cg-layer-count">24–36 张</span>
                  </div>
                ))}
              </div>
              <div className="cg-rule-grid">
                <RuleTile title="重叠 ≥ 70%" text="相邻两张保留大部分同一画面，匹配点才够。" />
                <RuleTile title="每 10–15° 一张" text="一圈 24–36 张；转角用 30° 小步过渡。" />
                <RuleTile title="步长 ≤ 0.5m" text="慢到画面不糊；移动过快会断层。" />
                <RuleTile title="路径闭环" text="回到起点，让每一面都被至少两圈看到。" />
                <RuleTile title="大空间补一圈" text="超过 3m 的空间，补一圈面向墙面的中间路径。" />
                <RuleTile title="不在同一点停留" text="同一位置堆很多张，只会得到重复帧。" />
              </div>
              <div className="cg-tip">
                <Info size={16} aria-hidden="true" />
                <span>
                  每层 24 张只是三层闭环的底线（共 72 张）；编辑级最低可交付 {MIN_DELIVERABLE_STATIONS}–180 张，
                  稳定目标 {STABLE_STATIONS}+ 张。
                </span>
              </div>
              <p className="cg-source">
                阈值来源：<code>docs/recon-2026-11/01-素材核查与采集缺口.md</code> §6 / §10 与
                <code>04-结论与路线图.md</code> §1。原视频实测 yaw 仅 102.6°、0/32 文件有坐标，故把「原地转圈」判成硬门槛。
              </p>
              <label className="cg-check">
                <input
                  type="checkbox"
                  checked={orbitConfirmed}
                  onChange={event => setOrbitConfirmed(event.target.checked)}
                  data-testid="orbit-confirm"
                />
                <span className="cg-check-box" aria-hidden="true">{orbitConfirmed && <Check size={14} />}</span>
                <span>我会沿圆环走动，不在原点转圈。</span>
              </label>
            </>
          )}

          {currentStep === 'scale' && (
            <>
              <StepHead
                eyebrow="04 尺度基准"
                title="放一把尺，或者量两点"
                lead="没有尺度，模型只是一个好看的壳：桌椅、舞台、通道全都量不了。"
              />
              <div className="cg-scale-card">
                <div className="cg-scale-label">
                  <Ruler size={18} aria-hidden="true" />
                  <span>录入一个已知长度</span>
                  <InfoNote label="为什么必须录尺度">
                    <p>《拍摄指南 2026》面向空间生成重建，本身不要求尺度；Scendance 要把场地放进真实尺寸的活动布置里，所以这一步必须做。</p>
                    <p>最稳的做法：第一张画面里放一把卷尺或 A4 纸，并在凭证里记录它的真实长度。也可以量场地里两点的实际距离。</p>
                  </InfoNote>
                </div>
                <div className="cg-scale-input">
                  <input
                    value={scaleInput}
                    onChange={event => setScaleInput(event.target.value)}
                    inputMode="decimal"
                    placeholder="例如 1.2m 或 120cm"
                    aria-label="已知长度"
                    data-testid="scale-input"
                  />
                  <span>{scaleOk ? '通过' : '必填'}</span>
                </div>
                <div className={`cg-scale-status ${scaleOk ? 'is-ok' : 'is-warn'}`}>
                  {scaleOk ? <Check size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
                  <span>{scaleStatusText(scaleInput, scaleMeters)}</span>
                </div>
                <div className="cg-presets">
                  <button type="button" onClick={() => setScaleInput('0.30m')}>A4 纸长边 0.30m</button>
                  <button type="button" onClick={() => setScaleInput('0.90m')}>门宽 0.90m</button>
                  <button type="button" onClick={() => setScaleInput('0.60m')}>地砖 0.60m</button>
                </div>
              </div>
              <div className="cg-tip">
                <Info size={16} aria-hidden="true" />
                <span>下一步是现场校验。没有通过这一步，评分按钮不会打开。</span>
              </div>
            </>
          )}

          {currentStep === 'verify' && (
            <>
              <StepHead
                eyebrow="05 现场校验"
                title="拍完先别走"
                lead="定位、层数、重复帧、曝光都在这屏过一遍。手机能做的快检，我们全做。"
              />

              <section className={`cg-card cg-gps cg-gps--${gpsStatus}`}>
                <div className="cg-card-head">
                  <div className="cg-card-title">
                    <span className="cg-icon"><MapPin size={20} aria-hidden="true" /></span>
                    <div>
                      <strong>定位记录</strong>
                      <span>每个新机位附上经纬度、精度与时间。</span>
                    </div>
                  </div>
                  <span className={`cg-status cg-status--${gpsStatus}`}>
                    {gpsStatus === 'active'
                      ? '记录中'
                      : gpsStatus === 'requesting'
                        ? '请求中'
                        : gpsStatus === 'denied'
                          ? '被拒绝'
                          : gpsStatus === 'unavailable'
                            ? '不可用'
                            : '未开启'}
                  </span>
                </div>
                {gpsStatus !== 'active' && gpsStatus !== 'requesting' && (
                  <button type="button" className="cg-btn cg-btn--soft" onClick={startGps} data-testid="gps-start">
                    <MapPin size={16} aria-hidden="true" />
                    开启定位记录
                  </button>
                )}
                {gpsStatus === 'requesting' && (
                  <div className="cg-inline-busy"><Loader2 size={15} aria-hidden="true" /> 正在向系统请求定位权限…</div>
                )}
                {gpsStatus === 'active' && gpsFixes.length > 0 && (
                  <div className="cg-gps-readout">
                    <span>
                      <b>{gpsFixes[gpsFixes.length - 1]?.latitude.toFixed(5)}</b>,{' '}
                      <b>{gpsFixes[gpsFixes.length - 1]?.longitude.toFixed(5)}</b>
                    </span>
                    <span className={(gpsFixes[gpsFixes.length - 1]?.accuracy ?? 0) > 10 ? 'is-warn' : 'is-ok'}>
                      精度 ±{Math.round(gpsFixes[gpsFixes.length - 1]?.accuracy ?? 0)}m
                    </span>
                  </div>
                )}
                {gpsError && <div className="cg-error">{gpsError}</div>}
                <div className="cg-mini-stats">
                  <span><b>{frames.length - missingGpsCount}</b> / {frames.length} 机位有有效定位</span>
                  <span className={missingGpsCount > 0 ? 'is-warn' : ''}>{missingGpsCount} 个缺失或精度 &gt;10m</span>
                </div>
              </section>

              <section className="cg-card">
                <div className="cg-card-head">
                  <div className="cg-card-title">
                    <span className="cg-icon"><Camera size={20} aria-hidden="true" /></span>
                    <div>
                      <strong>采集与快检</strong>
                      <span>先选当前层，再添加照片；可多选。</span>
                    </div>
                  </div>
                </div>
                <div className="cg-segs" role="group" aria-label="当前拍摄层">
                  {CAPTURE_LAYERS.map(item => (
                    <button
                      key={item}
                      type="button"
                      className={layer === item ? 'is-active' : ''}
                      aria-pressed={layer === item}
                      onClick={() => setLayer(item)}
                    >
                      <span>{item === 'low' ? '低层' : item === 'eye' ? '视线层' : '高层'}</span>
                      <b>{layerCounts[item]}</b>
                    </button>
                  ))}
                </div>
                <div className="cg-capture-actions">
                  <button type="button" className="cg-btn cg-btn--primary" onClick={() => photoInputRef.current?.click()}>
                    <Upload size={16} aria-hidden="true" />
                    选照片（可多选）
                  </button>
                  <button type="button" className="cg-btn cg-btn--ghost" onClick={() => cameraInputRef.current?.click()}>
                    <Camera size={16} aria-hidden="true" />
                    拍一张
                  </button>
                  <button type="button" className="cg-btn cg-btn--ghost" onClick={() => videoInputRef.current?.click()}>
                    <Video size={16} aria-hidden="true" />
                    选视频
                  </button>
                </div>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="cg-sr"
                  data-testid="photo-input"
                  onChange={event => {
                    const files = event.target.files ? Array.from(event.target.files) : [];
                    event.target.value = '';
                    void handleImageFiles(files);
                  }}
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="cg-sr"
                  data-testid="camera-input"
                  onChange={event => {
                    const files = event.target.files ? Array.from(event.target.files) : [];
                    event.target.value = '';
                    void handleImageFiles(files);
                  }}
                />
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*"
                  multiple
                  className="cg-sr"
                  data-testid="video-input"
                  onChange={event => {
                    const files = event.target.files ? Array.from(event.target.files) : [];
                    event.target.value = '';
                    void handleVideoFiles(files);
                  }}
                />
                {busy && (
                  <div className="cg-busy" role="status">
                    <div className="cg-busy-line">
                      <span>{busy.label}</span>
                      <span>{busy.done}/{busy.total}</span>
                    </div>
                    <div className="cg-bar"><span style={{ width: `${busy.total > 0 ? (busy.done / busy.total) * 100 : 0}%` }} /></div>
                  </div>
                )}
                <div className="cg-layer-progress">
                  {CAPTURE_LAYERS.map(item => (
                    <div key={item}>
                      <span>{item === 'low' ? '低' : item === 'eye' ? '视线' : '高'}</span>
                      <div className="cg-bar"><span style={{ width: `${Math.min(100, (layerCounts[item] / TARGET_PER_LAYER) * 100)}%` }} /></div>
                      <b className={layerCounts[item] >= TARGET_PER_LAYER ? 'is-ok' : ''}>{layerCounts[item]}/{TARGET_PER_LAYER}</b>
                    </div>
                  ))}
                </div>
                <div className="cg-check-strip">
                  <span className={darkCount > 0 ? 'is-warn' : 'is-ok'}>{darkCount} 过暗</span>
                  <span className={brightCount > 0 ? 'is-warn' : 'is-ok'}>{brightCount} 过曝</span>
                  <span className={duplicateIds.size > 0 ? 'is-warn' : 'is-ok'}>{duplicateIds.size} 重复</span>
                  <span className={lowResCount > 0 ? 'is-warn' : 'is-ok'}>{lowResCount} 低清</span>
                  <span className="is-ok">{frames.length} 已记录</span>
                </div>
                {frames.length === 0 ? (
                  <div className="cg-empty">
                    <FileImage size={24} aria-hidden="true" />
                    <span>还没有样本。选一张现场照片，快检会自动跑分辨率、亮度直方图和连续帧相似度。</span>
                  </div>
                ) : (
                  <div className="cg-thumbs" data-testid="thumbs">
                    {frames.slice(-36).reverse().map(frame => {
                      const badge = duplicateIds.has(frame.id)
                        ? '重复'
                        : frame.meanLuma < 45 || frame.darkRatio > 0.5
                          ? '过暗'
                          : frame.meanLuma > 210 || frame.brightRatio > 0.12
                            ? '过曝'
                            : Math.min(frame.width, frame.height) < 1080
                              ? '低清'
                              : '';
                      return (
                        <div className="cg-thumb" key={frame.id} title={`${frame.name} · ${frame.width}×${frame.height}`}>
                          {frame.thumb ? <img src={frame.thumb} alt={frame.name} /> : <span className="cg-thumb-missing" />}
                          {badge && <span className={`cg-thumb-badge ${badge === '重复' ? 'is-dup' : ''}`}>{badge}</span>}
                          <span className="cg-thumb-layer">{frame.layer === 'low' ? '低' : frame.layer === 'eye' ? '视' : '高'}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="cg-card">
                <div className="cg-card-head">
                  <div className="cg-card-title">
                    <span className="cg-icon"><Compass size={20} aria-hidden="true" /></span>
                    <div>
                      <strong>朝向记录 · 可选</strong>
                      <span>有罗盘才算真实覆盖角；没有就按机位数推算。</span>
                    </div>
                  </div>
                  <span className={`cg-status cg-status--${compassStatus}`}>
                    {compassStatus === 'active'
                      ? '记录中'
                      : compassStatus === 'requesting'
                        ? '请求中'
                        : compassStatus === 'denied'
                          ? '被拒绝'
                          : compassStatus === 'unsupported'
                            ? '不支持'
                            : '未开启'}
                  </span>
                </div>
                <div className="cg-compass-row">
                  <div className="cg-compass-value">{heading === null ? '—' : `${Math.round(heading)}°`}</div>
                  <div>
                    <span>当前覆盖</span>
                    <strong>{Math.round(liveCoverage)}°</strong>
                  </div>
                  <button type="button" className="cg-btn cg-btn--ghost cg-btn--small" onClick={() => void startCompass()} data-testid="compass-start">
                    <Compass size={14} aria-hidden="true" />
                    开启
                  </button>
                </div>
                <p className="cg-note">
                  {compassStatus === 'active'
                    ? '机身朝向会写进每个新机位。原地旋转时，朝向跨度会暴露你。'
                    : '没有罗盘也能评分，但角度项最多只给 5 分，并标注「推算」。'}
                </p>
              </section>

              <div className="cg-tip">
                <ShieldCheck size={16} aria-hidden="true" />
                <span>评分会把「定位缺失 / 精度差 / 重复 / 过暗」逐项列出来。硬门槛不通过会直接判重采。</span>
              </div>
            </>
          )}

          {currentStep === 'scan' && (
            <>
              <StepHead
                eyebrow="02 导入自检"
                title="扫描结果先验三件事"
                lead="这条路径不看环绕机位，只看文件是否到位、尺度是否真实、扫描是否闭环。"
              />
              <section className="cg-card">
                <div className="cg-card-head">
                  <div className="cg-card-title">
                    <span className="cg-icon"><Scan size={20} aria-hidden="true" /></span>
                    <div>
                      <strong>扫描文件</strong>
                      <span>支持 .ply / .spz / .glb / .gltf / .obj / .splat。</span>
                    </div>
                  </div>
                </div>
                <button type="button" className="cg-btn cg-btn--primary" onClick={() => scanInputRef.current?.click()}>
                  <Upload size={16} aria-hidden="true" />
                  选择扫描文件
                </button>
                <input
                  ref={scanInputRef}
                  type="file"
                  accept=".ply,.spz,.glb,.gltf,.obj,.splat,.las,.laz"
                  multiple
                  className="cg-sr"
                  data-testid="scan-input"
                  onChange={event => {
                    const files = event.target.files;
                    event.target.value = '';
                    if (files) setScanFiles(Array.from(files));
                  }}
                />
                {scanFiles.length > 0 ? (
                  <ul className="cg-filelist">
                    {scanFiles.map(file => (
                      <li key={`${file.name}-${file.size}`}>
                        <FileImage size={14} aria-hidden="true" />
                        <span>{file.name}</span>
                        <b>{formatBytes(file.size)}</b>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="cg-empty">
                    <Scan size={24} aria-hidden="true" />
                    <span>还没有扫描文件。单张全景图不算扫描结果，无法用于重建。</span>
                  </div>
                )}
              </section>
              <section className="cg-card">
                <div className="cg-card-head">
                  <div className="cg-card-title">
                    <span className="cg-icon"><Layers size={20} aria-hidden="true" /></span>
                    <div>
                      <strong>扫描是否闭环</strong>
                      <span>只拍了中间一段的扫描，漫游出界就会崩。</span>
                    </div>
                  </div>
                </div>
                <div className="cg-segs cg-segs--text" role="group" aria-label="扫描完整性">
                  <button type="button" className={scanCompleteness === 'complete' ? 'is-active' : ''} onClick={() => setScanCompleteness('complete')}>完整闭环</button>
                  <button type="button" className={scanCompleteness === 'partial' ? 'is-active' : ''} onClick={() => setScanCompleteness('partial')}>局部缺失</button>
                  <button type="button" className={scanCompleteness === 'unknown' ? 'is-active' : ''} onClick={() => setScanCompleteness('unknown')}>不确定</button>
                </div>
              </section>
              <section className="cg-card">
                <div className="cg-card-head">
                  <div className="cg-card-title">
                    <span className="cg-icon"><Ruler size={20} aria-hidden="true" /></span>
                    <div>
                      <strong>真实尺度</strong>
                      <span>扫描文件本身通常不带真实尺寸，必须补一个。</span>
                    </div>
                  </div>
                  <InfoNote label="扫描为什么也要尺度">
                    <p>空间生成 / 点云默认是无尺度的相对坐标。没有尺度，导进 Scendance 后桌椅和场地对不上。</p>
                  </InfoNote>
                </div>
                <div className="cg-scale-input">
                  <input
                    value={scaleInput}
                    onChange={event => setScaleInput(event.target.value)}
                    inputMode="decimal"
                    placeholder="例如 1.2m 或 120cm"
                    aria-label="已知长度"
                    data-testid="scan-scale-input"
                  />
                  <span>{scaleOk ? '通过' : '必填'}</span>
                </div>
                <div className={`cg-scale-status ${scaleOk ? 'is-ok' : 'is-warn'}`}>
                  {scaleOk ? <Check size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
                  <span>{scaleStatusText(scaleInput, scaleMeters)}</span>
                </div>
              </section>
              <div className="cg-tip">
                <Info size={16} aria-hidden="true" />
                <span>完整性「不确定」会把结论压到「建议补拍」；文件和尺度缺一项直接重采。</span>
              </div>
            </>
          )}

          {currentStep === 'score' && score && verdict && (
            <>
              <StepHead
                eyebrow="06 评分结果"
                title="这批素材能不能跑"
                lead="评分 0–100。≥75 可直接跑；50–74 建议补拍；低于 50 重采。"
              />
              <div className="cg-score-hero">
                <div
                  className="cg-ring"
                  style={{ background: `conic-gradient(${verdict.hex} ${score.total}%, var(--hair) 0)` }}
                  data-testid="score-value"
                >
                  <div className="cg-ring-inner">
                    <strong>{score.total}</strong>
                    <span>/ 100</span>
                  </div>
                </div>
                <div className="cg-score-copy">
                  <span className={`cg-verdict cg-verdict--${verdict.tone}`}>{verdict.label}</span>
                  <p>{verdict.detail}</p>
                  <span className="cg-score-sub">原始分 {score.rawTotal} · {score.metrics.frames} 个样本</span>
                </div>
              </div>
              <div className="cg-stats">
                {scoreStatItems(score, scanMode, scaleMeters).map(item => (
                  <div key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>

              {score.blockers.length > 0 && (
                <section className="cg-alert cg-alert--block">
                  <div className="cg-alert-title"><AlertTriangle size={17} aria-hidden="true" /> 硬门槛未通过</div>
                  <ul>
                    {score.blockers.map(item => <li key={item}>{item}</li>)}
                  </ul>
                  <p>这些项目不是「扣分」，是「不要上传」。先按下面的扣分清单重拍。</p>
                </section>
              )}

              {score.caps.length > 0 && (
                <section className="cg-alert cg-alert--cap">
                  <div className="cg-alert-title"><Info size={17} aria-hidden="true" /> 这些项目把上限压到 69</div>
                  <ul>
                    {score.caps.map(item => <li key={item}>{item}</li>)}
                  </ul>
                </section>
              )}

              <section className="cg-card">
                <div className="cg-card-head">
                  <div className="cg-card-title">
                    <span className="cg-icon"><ClipboardCheck size={20} aria-hidden="true" /></span>
                    <div>
                      <strong>评分明细</strong>
                      <span>每一项都能对回现场动作。</span>
                    </div>
                  </div>
                </div>
                <div className="cg-breakdown">
                  {score.items.map(item => (
                    <div className="cg-break-row" key={item.key}>
                      <div className="cg-break-head">
                        <span>{item.label}</span>
                        <b className={item.earned === item.max ? 'is-ok' : ''}>{item.earned} / {item.max}</b>
                      </div>
                      <div className="cg-bar"><span style={{ width: `${item.max > 0 ? (item.earned / item.max) * 100 : 0}%` }} /></div>
                      <p>{item.detail}</p>
                    </div>
                  ))}
                </div>
              </section>

              <details className="cg-fold" open>
                <summary>
                  <span>扣分清单</span>
                  <span>{score.deductions.length} 项</span>
                </summary>
                <ul className="cg-deductions">
                  {score.deductions.map((deduction, index) => (
                    <li key={`${deduction.label}-${index}`} className={`is-${deduction.severity}`}>
                      <span>{deduction.label}</span>
                      <b>{deduction.points > 0 ? `-${deduction.points}` : deduction.severity === 'warn' ? '提示' : '上限'}</b>
                      <p>{deduction.detail}</p>
                    </li>
                  ))}
                </ul>
              </details>

              <details className="cg-fold">
                <summary>
                  <span><ClipboardCheck size={15} aria-hidden="true" /> 阈值与来源</span>
                  <span>{THRESHOLD_SOURCES.length} 条</span>
                </summary>
                <dl className="cg-thresholds">
                  {THRESHOLD_SOURCES.map(item => (
                    <div key={item.label}>
                      <dt>{item.label}</dt>
                      <dd>
                        <strong>{item.value}</strong>
                        <span>{item.source}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>

              <div className="cg-caveat">
                <Info size={15} aria-hidden="true" />
                <span>手机快检只抽样亮度直方图与感知哈希，判断不了模糊、反光和动态物体。评分是现场拦截，不替代重建试跑。</span>
              </div>
            </>
          )}

          {currentStep === 'examples' && (
            <>
              <StepHead
                eyebrow="07 反例对比"
                title="这三种素材，为什么救不回来"
                lead="下面的缩略图来自我们 2026-11-04 西湖夜间采集：32 个文件，0 个带 GPS，原地转了 102°。"
              />
              <div className="cg-examples">
                <ExampleCard
                  src="/guide/capture/examples/spin.jpg"
                  badge="原地旋转"
                  title="站在原地，转了 102°"
                  items={[
                    '24 张全景来自同一点，GPS 位移 0m。',
                    '空间生成需要相机沿轨迹移动；单点全景只能得到一个薄壳。',
                    '《拍摄指南 2026》也明确：不要定点拍单张全景。',
                  ]}
                  fix="沿圆环走起来，每 10–15° 一张，三层各一圈。"
                />
                <ExampleCard
                  src="/guide/capture/examples/night.jpg"
                  badge="夜景"
                  title="天黑以后，噪点代替了细节"
                  items={[
                    '天空死黑、灯牌过曝，直方图两端同时爆掉。',
                    '手机高 ISO 的噪点被当成特征点，匹配大量错位。',
                    '湖面反光还在动，同一块水面每张都不一样。',
                  ]}
                  fix="白天或阴天拍；强光 30 分钟内，阴天 2 小时内收工。"
                />
                <ExampleCard
                  src="/guide/capture/examples/nogps.jpg"
                  badge="无 GPS / 无尺度"
                  title="32 个文件，没有一个定位"
                  items={[
                    '没有经纬度，就无法判断机位是不是真的在移动。',
                    '没有尺度，重建出来不能量桌椅、舞台和通道。',
                    '我们的评分把 GPS 覆盖和尺度各算 15 分，并压上限。',
                  ]}
                  fix="开定位；地上放一把尺，或在凭证里量两点实际距离。"
                />
              </div>

              <section className="cg-card cg-diff">
                <div className="cg-card-head">
                  <div className="cg-card-title">
                    <span className="cg-icon"><ShieldCheck size={20} aria-hidden="true" /></span>
                    <div>
                      <strong>我们比指南多要求了什么</strong>
                      <span>不是照搬，是把实测失败翻译成硬门槛。</span>
                    </div>
                  </div>
                </div>
                <ul className="cg-diff-list">
                  <li><b>三层 × 24–36 机位</b><span>指南要求多高度与 70% 重叠；我们把它量化成 120–180 张最低可交付（72 张只是三层闭环底线），少于 120 张直接封顶。</span></li>
                  <li><b>GPS 位移与朝向跨度</b><span>指南只提醒「不要定点拍全景」；我们用 GPS 位移 &lt;1.5m + 朝向跨度 ≥90° 自动判原地旋转，直接重采。</span></li>
                  <li><b>过暗 / 过曝硬拦</b><span>指南说低光噪点影响重建；我们把「过暗或过曝帧 ≥50%」判重采，夜景直接不放过。</span></li>
                  <li><b>真实尺度必须录入</b><span>指南面向空间生成重建，本身不要求尺度；Scendance 要量真实场地，所以缺尺度最高只能 69 分。</span></li>
                  <li><b>GPS 覆盖率进入评分</b><span>指南不要求 GPS；我们把「有效定位覆盖 &lt;50%」压上限，0 GPS 视为高风险。</span></li>
                  <li><b>拍摄时长上限</b><span>指南建议强光 ≤30 分钟、阴天 ≤2 小时；我们直接写进评分，超 2 小时时长项为 0。</span></li>
                </ul>
              </section>

              <details className="cg-fold">
                <summary>
                  <span><BookOpen size={15} aria-hidden="true" /> 延伸阅读 · 拍摄指南 2026</span>
                  <span>要点转述</span>
                </summary>
                <div className="cg-reading">
                  <p>这份指南面向生成式 3D 重建，原文由用户提供。这里只归纳要点，不收录原文，也不把 PDF 放进 public 目录。</p>
                  <ul>
                    <li>锁曝光、白平衡、对焦；快门 ≥1/240s，ISO 尽量低，分辨率 4K+。</li>
                    <li>每张与前一张至少 70% 重叠，移动不过快；推荐约 120° 广角，避免鱼眼低像素。</li>
                    <li>室内三层：600mm 仰拍 35° / 1700mm 平视 / 1900mm 俯拍 35°，转角 30° 过渡，路径闭环。</li>
                    <li>室外选阴天柔光，避开正午；强光 ≤30 分钟，阴天 ≤2 小时；避开行人、车辆、植物摆动。</li>
                    <li>玻璃、镜面、高反射、频闪灯是硬伤；水面与天空建议分区块或后期拼接。</li>
                    <li>360 相机效率高，但单面分辨率低；手持时靠身体转动，不要只手腕转。</li>
                  </ul>
                  <p className="cg-source">来源：《拍摄指南 2026》（生成式重建拍摄指南，用户提供）。仅作要点转述与对照，不替代原文。</p>
                </div>
              </details>

              <p className="cg-source">
                反例素材来源：本项目 <code>scene-3d/</code> 现场采集目录。仅取 3 张缩略图（长边 800px、单张 &lt;200KB）用于教学对比，原始素材不随产品分发。
              </p>
            </>
          )}

          {currentStep === 'receipt' && (
            <>
              <StepHead
                eyebrow="08 采集凭证"
                title="把证据带进 Scendance"
                lead="一份 JSON 摘要，记录这批素材是什么状态下拍出来的。它不包含照片，也不会上传服务器。"
              />
              {score && verdict ? (
                <>
                  <div className="cg-receipt-head">
                    <div>
                      <span>评分</span>
                      <strong>{score.total}<i>/100</i></strong>
                    </div>
                    <span className={`cg-verdict cg-verdict--${verdict.tone}`}>{verdict.label}</span>
                  </div>
                  <div className="cg-stats cg-stats--receipt">
                    {scoreStatItems(score, scanMode, scaleMeters).map(item => (
                      <div key={item.label}>
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                      </div>
                    ))}
                  </div>
                  <section className="cg-card">
                    <div className="cg-card-head">
                      <div className="cg-card-title">
                        <span className="cg-icon"><ClipboardCheck size={20} aria-hidden="true" /></span>
                        <div>
                          <strong>scendance.capture/v1</strong>
                          <span>{scoreAt ? new Date(scoreAt).toLocaleString('zh-CN', { hour12: false }) : '刚刚生成'}</span>
                        </div>
                      </div>
                    </div>
                    <pre className="cg-json" data-testid="receipt-json">{receiptJson}</pre>
                    <div className="cg-receipt-actions">
                      <button type="button" className="cg-btn cg-btn--primary" onClick={downloadReceipt} disabled={!receiptJson}>
                        <Download size={16} aria-hidden="true" />
                        下载 JSON
                      </button>
                      <button type="button" className="cg-btn cg-btn--ghost" onClick={() => void copyReceipt()} disabled={!receiptJson}>
                        {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                        {copied ? '已复制' : '复制摘要'}
                      </button>
                    </div>
                  </section>
                </>
              ) : (
                <div className="cg-empty">
                  <ClipboardCheck size={24} aria-hidden="true" />
                  <span>还没有评分。先回到现场校验，生成一次评分再回来。</span>
                </div>
              )}

              <section className="cg-card">
                <div className="cg-card-head">
                  <div className="cg-card-title">
                    <span className="cg-icon"><ArrowRight size={20} aria-hidden="true" /></span>
                    <div>
                      <strong>带进 Scendance</strong>
                      <span>三步，不用重新整理素材。</span>
                    </div>
                  </div>
                </div>
                <ol className="cg-steps">
                  <li><b>回到工作台</b><span>打开幕景，进入当前项目。</span></li>
                  <li><b>打开「场地重建」</b><span>选「生成引擎重建真实场地」，上传这次拍的原片。</span></li>
                  <li><b>把凭证放进项目备注</b><span>重建失败时，先对照扣分项，而不是盲猜。</span></li>
                </ol>
                <Link className="cg-btn cg-btn--primary" href="/">
                  进入工作台
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </section>

              <div className="cg-caveat">
                <Info size={15} aria-hidden="true" />
                <span>凭证是现场记录，不是重建保证。评分高只代表素材具备可重建条件，最终仍需云端重建试跑。</span>
              </div>
              <button type="button" className="cg-restart" onClick={restart}>
                <RotateCcw size={15} aria-hidden="true" />
                重新开始一次采集
              </button>
            </>
          )}
        </main>

        <footer className="cg-foot">
          {safeIndex > 0 && currentStep !== 'receipt' && (
            <button type="button" className="cg-btn cg-btn--ghost" onClick={goBack} data-testid="back">
              <ArrowLeft size={16} aria-hidden="true" />
              上一步
            </button>
          )}
          {currentStep === 'receipt' ? (
            <Link className="cg-btn cg-btn--primary" href="/">
              回到工作台
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          ) : (
            <button
              type="button"
              className="cg-btn cg-btn--primary"
              onClick={advance}
              disabled={!canAdvance}
              data-testid="next"
            >
              {busy ? <Loader2 size={16} aria-hidden="true" /> : currentStep === 'verify' || currentStep === 'scan' ? <ShieldCheck size={16} aria-hidden="true" /> : null}
              {nextLabel}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function PrerequisiteCard({
  icon,
  title,
  text,
  info,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  info: string;
}): JSX.Element {
  return (
    <div className="cg-prereq">
      <span className="cg-prereq-icon">{icon}</span>
      <div>
        <div className="cg-prereq-title">
          <strong>{title}</strong>
          <InfoNote label={`${title} 说明`}><p>{info}</p></InfoNote>
        </div>
        <p>{text}</p>
      </div>
    </div>
  );
}

function RuleTile({ title, text }: { title: string; text: string }): JSX.Element {
  return (
    <div className="cg-rule-tile">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function ExampleCard({
  src,
  badge,
  title,
  items,
  fix,
}: {
  src: string;
  badge: string;
  title: string;
  items: string[];
  fix: string;
}): JSX.Element {
  return (
    <article className="cg-example">
      <div className="cg-example-media">
        <img src={src} alt={title} loading="lazy" />
        <span className="cg-example-badge">{badge}</span>
      </div>
      <div className="cg-example-body">
        <strong>{title}</strong>
        <ul>
          {items.map(item => <li key={item}>{item}</li>)}
        </ul>
        <p className="cg-example-fix"><Check size={14} aria-hidden="true" /> {fix}</p>
      </div>
    </article>
  );
}
