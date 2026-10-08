import type { RoomLayout } from '../components/room-organizer/lib/types';
import type { BackupBriefSnapshot } from './local-project-backup';
import {
  createProjectReviewSnapshot, projectReviewIsStale, validateProjectReviewCapture,
  type ProjectReviewCapture, type ProjectReviewInput, type ProjectReviewNote,
  type ProjectReviewSnapshot, type ProjectReviewSource,
} from './project-review';

export interface ProjectReviewBase {
  layout: RoomLayout;
  briefSnapshot: BackupBriefSnapshot;
  source: ProjectReviewSource;
  dataState: ProjectReviewInput['dataState'];
  dataKind: ProjectReviewInput['dataKind'];
}
export interface ProjectReviewPanelActions {
  getSource(): ProjectReviewSource;
  prepare(): Promise<ProjectReviewBase>;
  capture?(snapshot: ProjectReviewSnapshot, options: ProjectReviewCaptureOptions): Promise<ProjectReviewCapture>;
}
export interface ProjectReviewCaptureOptions { includeReference: boolean }
export interface ProjectReviewSettings {
  disclosure: ProjectReviewInput['disclosure'];
  summary: string;
  pending: string;
  includeImage: boolean;
  includeReference: boolean;
}
export interface PreparedProjectReview {
  snapshot: ProjectReviewSnapshot;
  capture: { state: 'omitted' } | { state: 'ready'; image: ProjectReviewCapture } | { state: 'failed'; message?:string };
}
/** Only deliberate, user-facing capture failures may be shown by the panel. */
export class ProjectReviewCaptureError extends Error {}
export class ProjectReviewChangedError extends Error {
  constructor() { super('内容已变化，请按当前内容重新生成评审包。'); }
}
const sameSource = (a: ProjectReviewSource, b: ProjectReviewSource) => a.scope === b.scope && a.revision === b.revision;

/** Caller supplies the existing stable read boundary; no storage or provider is accessed here. */
export async function prepareProjectReview(
  actions: ProjectReviewPanelActions, settings: ProjectReviewSettings,
): Promise<PreparedProjectReview> {
  const chosen = { ...settings, disclosure: { ...settings.disclosure } };
  const source = { ...actions.getSource() };
  const base = await actions.prepare();
  const current = () => sameSource(source, actions.getSource()) && sameSource(source, base.source);
  if (!current()) throw new ProjectReviewChangedError();
  const generatedAt = new Date().toISOString();
  const notes: ProjectReviewNote[] = [];
  for (const [kind, text] of [['team-check', chosen.summary], ['pending', chosen.pending]] as const) {
    if (text.trim()) notes.push({ kind, text, sourceLabel: '本次评审的手工记录', recordedAt: generatedAt,
      dataKind: base.dataKind, target: 'current', objectIds: [] });
  }
  const snapshot = createProjectReviewSnapshot({ layout: base.layout, briefSnapshot: base.briefSnapshot,
    source, dataState: base.dataState, dataKind: base.dataKind,
    snapshot: { id: crypto.randomUUID(), generatedAt }, disclosure: chosen.disclosure, notes });
  if (!current()) throw new ProjectReviewChangedError();
  if (!chosen.includeImage) return { snapshot, capture: { state: 'omitted' } };
  try {
    if (!actions.capture) throw new Error('Capture unavailable');
    const image = validateProjectReviewCapture(snapshot, await actions.capture(snapshot, { includeReference: chosen.includeReference }));
    if (!current()) throw new ProjectReviewChangedError();
    return { snapshot, capture: { state: 'ready', image } };
  } catch (error) {
    if (!current() || error instanceof ProjectReviewChangedError) throw new ProjectReviewChangedError();
    // A valid text snapshot remains available, but the user must explicitly choose the no-image exit.
    return { snapshot, capture: { state: 'failed',...(error instanceof ProjectReviewCaptureError?{message:error.message}:{}) } };
  }
}

export interface ProjectReviewCaptureState {
  source: ProjectReviewSource;
  canvas: HTMLCanvasElement | null;
  /** Committed scene/view input revision, not a counter incremented on every redraw. */
  frameRevision: string;
  viewLabel: string;
  ready: boolean;
  assetsReady: boolean;
  pendingPreview: boolean;
  interacting: boolean;
  privateReferenceVisible: boolean;
}
export interface ProjectReviewCaptureAdapter {
  getState(): ProjectReviewCaptureState;
  /** Wait for resources already requested by the editor and corresponding effects to finish. */
  waitForReady(source: ProjectReviewSource): Promise<void>;
  /** Draw the current committed 2D or 3D scene synchronously; do not launch resources or generation. */
  render(): void;
}
function checkCaptureState(snapshot: ProjectReviewSnapshot, state: ProjectReviewCaptureState, requireReady: boolean, options: ProjectReviewCaptureOptions): void {
  if (projectReviewIsStale(snapshot, state.source)) throw new ProjectReviewChangedError();
  if (state.pendingPreview !== false || state.interacting !== false || typeof state.privateReferenceVisible !== 'boolean' ||
      (state.privateReferenceVisible !== false && options.includeReference !== true)) {
    throw new ProjectReviewCaptureError('请先结束候选预览或拖动，并隐藏未允许公开的参考图，再捕获画面。');
  }
  if (requireReady && (state.ready !== true || state.assetsReady !== true || !state.canvas || !state.canvas.width ||
      !state.canvas.height || !state.frameRevision || !state.viewLabel)) {
    throw new ProjectReviewCaptureError('当前画面尚未准备好，请等待资源和场景绘制完成。');
  }
}

function readCaptureState(adapter: ProjectReviewCaptureAdapter) {
  const state = adapter.getState();
  return { ...state, source: { scope: state.source.scope, revision: state.source.revision },
    canvasWidth: state.canvas?.width, canvasHeight: state.canvas?.height };
}

/** Encode the real current canvas in the same task as a fresh render; no independent model-export gate. */
export async function captureProjectReviewCanvas(
  snapshot: ProjectReviewSnapshot, adapter: ProjectReviewCaptureAdapter,
  options: ProjectReviewCaptureOptions = { includeReference: false },
): Promise<ProjectReviewCapture> {
  const chosen = { includeReference: options.includeReference === true };
  const started = readCaptureState(adapter);
  checkCaptureState(snapshot, started, false, chosen);
  await adapter.waitForReady(snapshot.source);
  const frame = readCaptureState(adapter);
  checkCaptureState(snapshot, frame, true, chosen);
  if (started.canvas !== frame.canvas || started.viewLabel !== frame.viewLabel ||
      started.canvasWidth !== frame.canvasWidth || started.canvasHeight !== frame.canvasHeight) {
    throw new Error('当前视图已变化，请重新捕获画面。');
  }
  const assertFrame = () => {
    const current = readCaptureState(adapter);
    checkCaptureState(snapshot, current, true, chosen);
    if (current.canvas !== frame.canvas || current.frameRevision !== frame.frameRevision || current.viewLabel !== frame.viewLabel ||
        current.canvasWidth !== frame.canvasWidth || current.canvasHeight !== frame.canvasHeight) {
      throw new Error('当前画面已变化，请重新捕获画面。');
    }
  };
  adapter.render();
  assertFrame();
  let dataUrl:string;
  try{dataUrl=frame.canvas!.toDataURL('image/png');}
  catch{throw new ProjectReviewCaptureError('当前画面无法保存为图片，请核对图片资源后重试。');}
  assertFrame();
  return validateProjectReviewCapture(snapshot, { snapshotId: snapshot.snapshot.id, source: { ...snapshot.source },
    capturedAt: new Date().toISOString(), kind: 'editor-capture', sourceLabel: frame.viewLabel,
    caption: `${frame.viewLabel} · 当前场景画面${frame.privateReferenceVisible ? ' · 含已允许公开的参考底图' : ''}`,
    dataUrl, target: 'current' });
}
