// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { attachProjectReviewImages, projectReviewHtml, validateProjectReviewCapture, validateProjectReviewCaptures,
  type ProjectReviewCapture, type ProjectReviewSnapshot } from './project-review';
import { captureProjectReviewCanvas, prepareProjectReview, ProjectReviewChangedError,
  type ProjectReviewBase, type ProjectReviewCaptureAdapter, type ProjectReviewCaptureState,
  type ProjectReviewPanelActions, type ProjectReviewSettings } from './project-review-workflow';

const source = { scope: 'review-workflow-a', revision: 'content-1' };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3ioAAAAASUVORK5CYII=';
const base = (): ProjectReviewBase => ({ layout: makeLayout({ id: source.scope, name: '演练场景', roof: { style: 'none' },
  floors: [makeFloor({ items: [makeItem({ notes: 'PRIVATE_CONTACT', handoff: { ownerName: 'PRIVATE_OWNER', dueDate: '',
    acceptance: '', status: 'todo', evidenceNote: '', evidenceUrls: [] } })] })] }),
  briefSnapshot: { state: 'ready', scope: source.scope, brief: { status: 'present', value: { event: '演练', guests: 30,
    description: '假设日期待定', mustHave: '', allowIdeas: false } } },
  source: { ...source }, dataState: 'unsaved-draft', dataKind: 'rehearsal' });
const settings = (): ProjectReviewSettings => ({ disclosure: { brief: true, design: false },
  summary: '演练设计理由', pending: '日期待确认', includeImage: false, includeReference: false });
function capture(snapshot: ProjectReviewSnapshot, view = '三维当前视角'): ProjectReviewCapture {
  return { snapshotId: snapshot.snapshot.id, source: { ...snapshot.source }, capturedAt: new Date().toISOString(),
    kind: 'editor-capture', sourceLabel: view, caption: view, dataUrl: png, target: 'current' };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void;
  const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; }
const actions = (): ProjectReviewPanelActions => ({ getSource: () => ({ ...source }), prepare: vi.fn(async () => base()),
  capture: vi.fn(async snapshot => capture(snapshot)) });
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('review preparation', () => {
  it('checks the whole unapproved image set before replacing an earlier file', async () => {
    const snapshot = (await prepareProjectReview(actions(), settings())).snapshot;
    const small = capture(snapshot);
    const original = attachProjectReviewImages(snapshot, [{ ...small, approvedForCustomer: true }], source);
    const originalHtml = projectReviewHtml(original);
    // Synthetic PNG-header bytes exercise only the encoded total limit, not real image decoding.
    const large = { ...small, dataUrl: `data:image/png;base64,iVBORw0KGgoA${'A'.repeat(4 * 1024 * 1024)}` };
    expect(validateProjectReviewCapture(snapshot, large)).not.toHaveProperty('approvedForCustomer');
    expect(validateProjectReviewCaptures(snapshot, [small, large])).toHaveLength(2);
    expect(() => validateProjectReviewCaptures(snapshot, [large, large, large])).toThrow('总量过大');
    expect(projectReviewHtml(original)).toBe(originalHtml);
    expect(original.images).toHaveLength(1);
  });

  it('keeps draft, assumptions and explicit manual notes; never adopts a version or exports internal contacts', async () => {
    const adapter = actions();
    const prepared = await prepareProjectReview(adapter, settings());
    expect(prepared.capture.state).toBe('omitted');
    expect(adapter.capture).not.toHaveBeenCalled();
    expect(prepared.snapshot.dataState).toBe('unsaved-draft');
    expect(prepared.snapshot.adopted).toBeNull();
    expect(prepared.snapshot.notes.map(n => n.kind)).toEqual(['team-check', 'pending']);
    expect(projectReviewHtml(prepared.snapshot)).toContain('假设日期待定');
    expect(projectReviewHtml(prepared.snapshot)).not.toContain('PRIVATE_');
    expect(projectReviewHtml(prepared.snapshot)).toContain('真实客户意见／确认：尚未记录');
  });

  it('preserves absent requirements and withholding rather than filling the initial form', async () => {
    const adapter = actions(); adapter.prepare = async () => ({ ...base(), briefSnapshot: { state: 'ready', scope: source.scope, brief: { status: 'absent' } } });
    expect((await prepareProjectReview(adapter, settings())).snapshot.brief.status).toBe('absent');
    const hidden = await prepareProjectReview(actions(), { ...settings(), disclosure: { brief: false, design: false } });
    expect(hidden.snapshot.brief.status).toBe('withheld');
  });

  it('does not turn a failed read/save into a review with default content', async () => {
    const adapter = actions(); adapter.prepare = vi.fn(async () => { throw new Error('storage failed'); });
    await expect(prepareProjectReview(adapter, settings())).rejects.toThrow('storage failed');
    expect(adapter.capture).not.toHaveBeenCalled();
  });

  it.each(['revision', 'scope'] as const)('rejects %s changes while preparing, including same-project restore epochs', async key => {
    const wait = deferred<ProjectReviewBase>(); const adapter = actions(); let current = { ...source };
    adapter.getSource = () => current; adapter.prepare = () => wait.promise;
    const result = prepareProjectReview(adapter, settings());
    current = { ...source, [key]: 'restored-or-switched' }; wait.resolve(base());
    await expect(result).rejects.toBeInstanceOf(ProjectReviewChangedError);
  });

  it('freezes the chosen text/options before an asynchronous preparation', async () => {
    const wait = deferred<ProjectReviewBase>(); const adapter = actions(); adapter.prepare = () => wait.promise;
    const chosen = settings(); const result = prepareProjectReview(adapter, chosen);
    chosen.summary = 'later'; chosen.disclosure.brief = false; chosen.includeImage = true;
    wait.resolve(base()); const prepared = await result;
    expect(prepared.snapshot.notes[0].text).toBe('演练设计理由');
    expect(prepared.snapshot.brief.status).toBe('present');
    expect(prepared.capture.state).toBe('omitted');
  });

  it('validates but does not approve/attach the first capture; reference permission is explicitly passed', async () => {
    const adapter = actions(); const prepared = await prepareProjectReview(adapter, { ...settings(), includeImage: true, includeReference: true });
    expect(adapter.capture).toHaveBeenCalledWith(prepared.snapshot, { includeReference: true });
    expect(prepared.capture.state).toBe('ready');
    expect(prepared.snapshot.images).toHaveLength(0);
    if (prepared.capture.state !== 'ready') throw new Error('capture not ready');
    expect(prepared.capture.image).not.toHaveProperty('approvedForCustomer');
    expect(projectReviewHtml(prepared.snapshot)).not.toContain('<img');
    const approved = attachProjectReviewImages(prepared.snapshot, [{ ...prepared.capture.image, approvedForCustomer: true }], source);
    expect(projectReviewHtml(approved)).toContain('<img');
  });

  it.each(['failure', 'missing', 'mismatch', 'invalid-image'] as const)('offers only an explicit no-image fallback after %s', async reason => {
    const adapter = actions();
    if (reason === 'missing') delete adapter.capture;
    else adapter.capture = async snapshot => {
      if (reason === 'failure') throw new Error('PRIVATE_SIGNED_URL');
      return { ...capture(snapshot), ...(reason === 'mismatch' ? { snapshotId: 'old-id' } : { dataUrl: 'https://private.example/image' }) };
    };
    const prepared = await prepareProjectReview(adapter, { ...settings(), includeImage: true });
    expect(prepared.capture.state).toBe('failed');
    expect(prepared.snapshot.images).toHaveLength(0);
    expect(projectReviewHtml(prepared.snapshot)).not.toContain('PRIVATE_SIGNED_URL');
  });

  it('rejects a stale text snapshot when content changes during capture failure', async () => {
    const adapter = actions(); let current = { ...source };
    adapter.getSource = () => current;
    adapter.capture = async () => { current = { ...source, revision: 'new-edit' }; throw new Error('encode'); };
    await expect(prepareProjectReview(adapter, { ...settings(), includeImage: true })).rejects.toBeInstanceOf(ProjectReviewChangedError);
  });

  it('can attach 2D and 3D captures to the same unchanged content snapshot', async () => {
    const prepared = await prepareProjectReview(actions(), settings());
    const images = [capture(prepared.snapshot, '二维 · 含参考底图'), capture(prepared.snapshot, '三维 · 整体视角')];
    const verified = images.map(image => ({ ...validateProjectReviewCapture(prepared.snapshot, image), approvedForCustomer: true as const }));
    const approved = attachProjectReviewImages(prepared.snapshot, verified, source);
    expect(approved.snapshot.id).toBe(prepared.snapshot.snapshot.id);
    expect(approved.images.map(i => i.sourceLabel)).toEqual(['二维 · 含参考底图', '三维 · 整体视角']);
  });
});

describe('real canvas capture protocol', () => {
  function adapter(snapshot: ProjectReviewSnapshot) {
    const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 80;
    const encode = vi.spyOn(canvas, 'toDataURL').mockReturnValue(png);
    let state: ProjectReviewCaptureState = { source: snapshot.source, canvas, frameRevision: 'committed-1', viewLabel: '三维 · 一层',
      ready: true, assetsReady: true, pendingPreview: false, interacting: false, privateReferenceVisible: false };
    const api: ProjectReviewCaptureAdapter = { getState: () => state, waitForReady: vi.fn(async () => {}), render: vi.fn() };
    return { api, canvas, encode, read: () => state, patch: (changes: Partial<ProjectReviewCaptureState>) => { state = { ...state, ...changes }; } };
  }

  it('waits, freshly renders, then encodes the same real canvas without triggering downloads', async () => {
    const snapshot = (await prepareProjectReview(actions(), settings())).snapshot;
    const { api, encode } = adapter(snapshot); const order: string[] = [];
    api.waitForReady = async () => { order.push('wait'); };
    api.render = () => { order.push('render'); };
    encode.mockImplementation(() => { order.push('encode'); return png; });
    const image = await captureProjectReviewCanvas(snapshot, api);
    expect(order).toEqual(['wait', 'render', 'encode']);
    expect(encode).toHaveBeenCalledWith('image/png');
    expect(image.snapshotId).toBe(snapshot.snapshot.id);
    expect(image).not.toHaveProperty('approvedForCustomer');
  });

  it.each(['pendingPreview', 'interacting', 'privateReferenceVisible'] as const)('blocks %s before waiting or encoding', async field => {
    const snapshot = (await prepareProjectReview(actions(), settings())).snapshot;
    const frame = adapter(snapshot); frame.patch({ [field]: true });
    await expect(captureProjectReviewCanvas(snapshot, frame.api)).rejects.toThrow();
    expect(frame.api.waitForReady).not.toHaveBeenCalled(); expect(frame.encode).not.toHaveBeenCalled();
  });

  it('permits an explicitly shared reference image, yet still leaves the captured pixels unapproved', async () => {
    const snapshot = (await prepareProjectReview(actions(), settings())).snapshot;
    const frame = adapter(snapshot); frame.patch({ privateReferenceVisible: true });
    const image = await captureProjectReviewCanvas(snapshot, frame.api, { includeReference: true });
    expect(image.caption).toContain('含已允许公开的参考底图');
    expect(image).not.toHaveProperty('approvedForCustomer');
  });

  it.each(['ready', 'assetsReady'] as const)('does not confuse engine readiness with %s', async field => {
    const snapshot = (await prepareProjectReview(actions(), settings())).snapshot;
    const frame = adapter(snapshot); frame.patch({ [field]: false });
    await expect(captureProjectReviewCanvas(snapshot, frame.api)).rejects.toThrow('尚未准备好');
    expect(frame.api.render).not.toHaveBeenCalled();
  });

  it('rejects source changes or a view switch while waiting', async () => {
    const snapshot = (await prepareProjectReview(actions(), settings())).snapshot;
    for (const change of [{ source: { ...source, revision: 'restored' } }, { viewLabel: '二维 · 一层' }, { canvas: document.createElement('canvas') }]) {
      const frame = adapter(snapshot); frame.api.waitForReady = async () => frame.patch(change);
      await expect(captureProjectReviewCanvas(snapshot, frame.api)).rejects.toThrow();
      expect(frame.encode).not.toHaveBeenCalled();
    }
  });

  it('rejects committed-frame changes during render or encoding instead of relabelling old pixels', async () => {
    const snapshot = (await prepareProjectReview(actions(), settings())).snapshot;
    const duringRender = adapter(snapshot); duringRender.api.render = () => duringRender.patch({ frameRevision: 'committed-2' });
    await expect(captureProjectReviewCanvas(snapshot, duringRender.api)).rejects.toThrow();
    expect(duringRender.encode).not.toHaveBeenCalled();
    const duringEncode = adapter(snapshot); duringEncode.encode.mockImplementation(() => { duringEncode.patch({ viewLabel: '二维' }); return png; });
    await expect(captureProjectReviewCanvas(snapshot, duringEncode.api)).rejects.toThrow();
  });

  it('fixes state/source baselines when getState returns the same mutable object', async () => {
    const snapshot = (await prepareProjectReview(actions(), settings())).snapshot;
    for (const change of [{ viewLabel: '二维' }, { canvas: document.createElement('canvas') }]) {
      const frame = adapter(snapshot);
      frame.api.waitForReady = async () => { Object.assign(frame.read(), change); };
      await expect(captureProjectReviewCanvas(snapshot, frame.api)).rejects.toThrow();
      expect(frame.encode).not.toHaveBeenCalled();
    }
    const duringRender = adapter(snapshot);
    duringRender.api.render = () => { Object.assign(duringRender.read(), { frameRevision: 'new-frame' }); };
    await expect(captureProjectReviewCanvas(snapshot, duringRender.api)).rejects.toThrow();
    expect(duringRender.encode).not.toHaveBeenCalled();
    const sourceChange = adapter(snapshot);
    sourceChange.patch({ source: { ...source } });
    sourceChange.api.waitForReady = async () => { sourceChange.read().source.revision = 'restored'; };
    await expect(captureProjectReviewCanvas(snapshot, sourceChange.api)).rejects.toBeInstanceOf(ProjectReviewChangedError);
  });

  it('fixes reference permission at invocation rather than accepting a later mutated options object', async () => {
    const snapshot = (await prepareProjectReview(actions(), settings())).snapshot;
    const frame = adapter(snapshot); const options = { includeReference: false };
    frame.api.waitForReady = async () => { options.includeReference = true; frame.patch({ privateReferenceVisible: true }); };
    await expect(captureProjectReviewCanvas(snapshot, frame.api, options)).rejects.toThrow();
    expect(frame.encode).not.toHaveBeenCalled();
  });

  it('rejects a canvas resize even if the adapter forgot to change its frame marker', async () => {
    const snapshot = (await prepareProjectReview(actions(), settings())).snapshot;
    const frame = adapter(snapshot); frame.api.render = () => { frame.canvas.width = 200; };
    await expect(captureProjectReviewCanvas(snapshot, frame.api)).rejects.toThrow();
    expect(frame.encode).not.toHaveBeenCalled();
  });

  it('surfaces a tainted/failed canvas and never claims pixels were made', async () => {
    const snapshot = (await prepareProjectReview(actions(), settings())).snapshot;
    const frame = adapter(snapshot); frame.encode.mockImplementation(() => { throw new DOMException('tainted', 'SecurityError'); });
    await expect(captureProjectReviewCanvas(snapshot, frame.api)).rejects.toThrow();
    frame.encode.mockReturnValue('data:,');
    await expect(captureProjectReviewCanvas(snapshot, frame.api)).rejects.toThrow();
  });
});
