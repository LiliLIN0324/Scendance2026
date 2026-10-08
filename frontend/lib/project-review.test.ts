// @vitest-environment jsdom
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { eventOperationsSchema } from '../../supabase/functions/_shared/event-operations-contract';
import { sceneSchema } from '../../supabase/functions/_shared/domain';
import { backendSceneToLayout } from '../components/room-organizer/lib/backend-adapter';
import { makeFloor, makeItem, makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { deliveryScene } from '../components/room-organizer/lib/scene-delivery';
import type { CreativeBrief } from '../components/room-organizer/lib/creative-brief';
import type { RoomLayout } from '../components/room-organizer/lib/types';
import { parseLocalProjectBackupJson } from './local-project-backup';
import {
  attachProjectReviewImages, createProjectReviewSnapshot, projectReviewHtml, projectReviewIsStale,
  type ProjectReviewImage, type ProjectReviewInput, type ProjectReviewNote,
} from './project-review';

const scope = 'review-project';
const generatedAt = '2026-10-07T09:30:00.000Z';
const objectId = '80000000-0000-4000-8000-000000000001';
const assetId = '80000000-0000-4000-8000-000000000002';
const brief = (): CreativeBrief => ({ event: '工作坊', guests: 30,
  description: '  假设演练：日期、场地与预算待确认。\n保留原话  ', mustHave: '入口待现场核对',
  allowIdeas: false, hasFloorplan: false, venueConditions: '假设10×8米；未实测',
  style: '简洁', palette: '绿色', atmosphere: '交流' });
const layout = (): RoomLayout => makeLayout({ id: scope, name: '假设演练', roof: { style: 'none' },
  eventOperations: eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [] }),
  floors: [makeFloor({ items: [makeItem({ id: objectId, name: '同名椅' }), makeItem({ id: 'other-chair', name: '同名椅' })] })],
});
function input(overrides: Partial<ProjectReviewInput> = {}): ProjectReviewInput {
  return { layout: layout(), briefSnapshot: { state: 'ready', scope, brief: { status: 'present', value: brief() } },
    snapshot: { id: 'review-001', generatedAt }, source: { scope, revision: 'editor-17:brief-4:scope-2' },
    dataState: 'saved', dataKind: 'rehearsal', disclosure: { brief: true, design: true }, ...overrides };
}
function note(overrides: Partial<ProjectReviewNote> = {}): ProjectReviewNote {
  return { kind: 'pending', text: '出入口、尺寸和报价待确认', sourceLabel: '演练策划者手工清单',
    recordedAt: '2026-10-07T09:20:00Z', dataKind: 'rehearsal', target: 'current', objectIds: [], ...overrides };
}
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3ioAAAAASUVORK5CYII=';
function picture(overrides: Partial<ProjectReviewImage> = {}): ProjectReviewImage {
  return { snapshotId: 'review-001', source: input().source, capturedAt: '2026-10-07T09:31:00Z',
    kind: 'editor-capture', sourceLabel: '测试画面；不是实际三维捕获证据', caption: '静态评审画面',
    approvedForCustomer: true, target: 'current', dataUrl: png, ...overrides };
}

describe('project review snapshot', () => {
  it('detaches and freezes all chosen source fields without freezing or changing the original', () => {
    const source = input({ notes: [note({ objectIds: [objectId] })] });
    const before = JSON.stringify(source);
    const review = createProjectReviewSnapshot(source);
    const html = projectReviewHtml(review);
    expect(JSON.stringify(source)).toBe(before);
    (source.layout.floors[0].items[0].position! as { x: number; z: number }).x = 99;
    source.layout.floors[0].items[0].name = '后改';
    if (source.briefSnapshot.state === 'ready' && source.briefSnapshot.brief.status === 'present') source.briefSnapshot.brief.value.description = '后改需求';
    source.notes![0].objectIds.push('后加');
    source.snapshot.id = 'changed';
    expect(projectReviewHtml(review)).toBe(html);
    expect(Object.isFrozen(source.layout)).toBe(false);
    expect(Object.isFrozen(review.current.layout.floors[0].items[0].position)).toBe(true);
    expect(() => { review.current.layout.floors[0].items[0].name = '强改'; }).toThrow();
  });

  it.each(['loading', 'saving', 'error'] as const)('refuses %s requirements and cross-project snapshots', state => {
    expect(() => createProjectReviewSnapshot(input({ briefSnapshot: { state, scope } }))).toThrow('尚未完成');
    expect(() => createProjectReviewSnapshot(input({ source: { scope: 'other', revision: '1' } }))).toThrow('不一致');
    expect(() => createProjectReviewSnapshot(input({ briefSnapshot: { state: 'ready', scope: 'other', brief: { status: 'absent' } } }))).toThrow('不一致');
  });

  it('keeps rehearsal, pending text and unsaved status; never infers consent from execution acceptance', () => {
    const original = layout();
    original.floors[0].items[0].handoff = { ownerName: '内部执行人', dueDate: '2026-10-08', acceptance: '内部通过条件',
      status: 'accepted', evidenceNote: '内部已验收', evidenceUrls: [], reviewedBasis: '内部核对依据' };
    const review = createProjectReviewSnapshot(input({ layout: original, dataState: 'unsaved-draft',
      notes: [note({ kind: 'team-check', text: '团队自查：演练布局通过' }),
        note({ kind: 'client-feedback', text: '模拟意见，不是真实客户反馈' })] }));
    expect(review.adopted).toBeNull();
    expect(review.brief).toEqual({ status: 'present', value: brief() });
    const html = projectReviewHtml(review);
    expect(html).toContain('未保存草稿');
    expect(html).toContain('真实客户意见／确认：尚未记录，待补');
    expect(html).toContain('采用版本：未记录');
    expect(html).toContain('报价：未记录');
    expect(html).not.toContain('内部已验收');
    expect(() => createProjectReviewSnapshot(input({ dataKind: 'real' }))).toThrow('原活动标识不一致');
  });

  it('uses the top-level edited layout rather than the stale active variant; adoption keeps its own object IDs and model version', () => {
    const older = layout();
    older.floors[0].items = [makeItem({ id: 'older-object', name: '历史同名椅', assetId, type: 'glb-asset' })];
    const edited = layout();
    edited.designBook = { activeId: 'v2', variants: [{ id: 'v1', name: '方案一', layout: older },
      { id: 'v2', name: '方案二', layout: older }] };
    const review = createProjectReviewSnapshot(input({ layout: edited,
      adoption: { snapshotId: 'review-001', source: input().source,
        variantId: 'v1', basis: '演练团队选定历史版本', decision: 'team-selection',
        sourceLabel: '手工选定记录', dataKind: 'rehearsal', recordedAt: '2026-10-07T09:20:00Z' },
      notes: [note({ target: 'adopted', objectIds: ['older-object', objectId] }), note({ objectIds: [objectId] })],
    }));
    expect(review.current.variantId).toBe('v2');
    expect(review.current.layout.floors[0].items.map(i => i.id)).toEqual([objectId, 'other-chair']);
    expect(review.adopted!.layout.floors[0].items[0]).toMatchObject({ id: 'older-object', assetVersionId: assetId });
    expect(review.notes[0].missingObjectIds).toEqual([objectId]);
    expect(review.notes[1].missingObjectIds).toEqual([]);
    expect(projectReviewHtml(review)).toContain('团队选定，不等于客户确认');
    older.floors[0].items[0].assetId = objectId;
    expect(review.adopted!.layout.floors[0].items[0].assetVersionId).toBe(assetId);
    expect(() => createProjectReviewSnapshot(input({ layout: edited, adoption: { ...review.adopted!.record, variantId: 'missing' } }))).toThrow('采用版本不在');
    expect(() => createProjectReviewSnapshot(input({ layout: edited, adoption: { ...review.adopted!.record, decision: 'client-confirmation' } }))).toThrow('需要对应的客户意见');
    expect(() => createProjectReviewSnapshot(input({ layout: edited, adoption: { ...review.adopted!.record, snapshotId: 'old-review' } }))).toThrow('本次内容快照');
    expect(() => createProjectReviewSnapshot(input({ layout: edited, adoption: { ...review.adopted!.record,
      source: { scope, revision: 'older-edit' } } }))).toThrow('本次内容快照');
    const currentAdoption = createProjectReviewSnapshot(input({ layout: edited,
      adoption: { ...review.adopted!.record, variantId: 'v2' } }));
    expect(currentAdoption.adopted!.layout).toEqual(currentAdoption.current.layout);
  });

  it('records explicitly provided real client comments separately from team checks, not as an electronic signature', () => {
    const review = createProjectReviewSnapshot(input({ notes: [note({ kind: 'client-feedback', dataKind: 'real',
      sourceLabel: '调用方明确提供的客户沟通摘录', text: '请将签到移到入口附近', objectIds: [objectId] })] }));
    const html = projectReviewHtml(review);
    expect(html).toContain('调用方明确提供的客户沟通摘录');
    expect(html).not.toContain('真实客户意见／确认：尚未记录');
    expect(html).toContain('采用版本：未记录');
  });

  it('remains readable when the actual Scene JSON gate rejects a full venue or an unarchived model', () => {
    const full = layout(); full.scenePreset = 'gym';
    expect(() => deliveryScene(full)).toThrow('完整场景预设');
    const fullReview = createProjectReviewSnapshot(input({ layout: full }));
    expect(projectReviewHtml(fullReview)).toContain('完整场馆或模板模型节点');
    expect(projectReviewHtml(fullReview)).not.toContain('<svg');
    const model = layout(); model.floors[0].items[0] = makeItem({ id: objectId, type: 'glb-asset',
      glbUrl: '/assets/unarchived.glb', source: 'local_sample' });
    expect(() => deliveryScene(model)).toThrow('尚未归档');
    const modelReview = createProjectReviewSnapshot(input({ layout: model }));
    const file = projectReviewHtml(attachProjectReviewImages(modelReview, [picture()], modelReview.source));
    expect(file).toContain('没有稳定归档编号');
    expect(file).toContain('<img');
    expect(file).not.toContain('/assets/unarchived.glb');
  });

  it('excludes raw photos, signed URLs, internal notes, account fields, evidence and upstream prices', () => {
    const original = layout();
    original.floorPlanImage = png;
    original.floors[0].items[0] = makeItem({ id: objectId, assetId, type: 'glb-asset',
      glbUrl: 'https://storage.example.test/private.glb?token=DO_NOT_SHARE', notes: 'PRIVATE_ITEM_NOTE', price: 98765,
      handoff: { ownerName: 'PRIVATE_OWNER', dueDate: '2026-10-08', acceptance: 'PRIVATE_ACCEPTANCE', status: 'accepted',
        evidenceNote: 'PRIVATE_EVIDENCE', evidenceUrls: ['https://private.example.test/secret'], reviewedBasis: 'PRIVATE_BASIS' },
    });
    Object.assign(original, { account: 'PRIVATE_ACCOUNT', accessToken: 'PRIVATE_TOKEN' });
    const review = createProjectReviewSnapshot(input({ layout: original }));
    for (const value of [JSON.stringify(review), projectReviewHtml(review)]) {
      for (const secret of ['DO_NOT_SHARE', 'PRIVATE_', '98765', png, 'private.example.test']) expect(value).not.toContain(secret);
      expect(value).toContain(assetId);
    }
  });

  it('requires deliberate disclosure and preserves an absent brief without creating default requirements', () => {
    const hidden = createProjectReviewSnapshot(input({ disclosure: { brief: false, design: false } }));
    expect(hidden.brief.status).toBe('withheld');
    expect(projectReviewHtml(hidden)).not.toContain('保留原话');
    expect(projectReviewHtml(hidden)).toContain('需求原文未获准公开');
    const absent = createProjectReviewSnapshot(input({ briefSnapshot: { state: 'ready', scope, brief: { status: 'absent' } } }));
    expect(projectReviewHtml(absent)).toContain('原项目没有已记录的需求');
    expect(projectReviewHtml(absent)).not.toContain('工作坊 / 30');
  });

  it('retains V2 design links and original status but marks deleted objects as needing review', () => {
    const scene = sceneSchema.parse({ schemaVersion: 2, venue: { width: 10, depth: 8, height: 3, shape: 'rectangle', entrances: [] },
      camera: 'overview', lighting: 'neutral', structure: { walls: [], columns: [], openings: [] },
      objects: [{ id: objectId, materialId: 'chair', position: { x: 1, z: 1 }, rotation: 0,
        size: { width: 1, depth: 1, height: 1 }, color: '#ffffff', locked: false }],
      design: { concept: '概念待讨论', palette: ['#446644'], highlights: [{ title: '交流', description: '待讨论', objectIds: [objectId] }],
        requirements: [{ text: '保持入口', status: 'satisfied', reason: '原设计判断，非现场验收', objectIds: [objectId] }] },
    });
    const original = { ...backendSceneToLayout(scene), id: scope };
    original.floors[0].items = [];
    const review = createProjectReviewSnapshot(input({ layout: original }));
    expect(review.current.layout.design!.requirements[0].status).toBe('satisfied');
    expect(review.current.layout.design!.missingObjectIds).toEqual([objectId]);
    expect(projectReviewHtml(review)).toContain('需复核；原记录 satisfied');
    expect(projectReviewHtml(review)).toContain('不是客户意见');
    expect(JSON.stringify(review)).not.toContain('backendSceneV2');
  });

  it('rejects ambiguous duplicated instance IDs rather than associating by name', () => {
    const ambiguous = layout(); ambiguous.floors[0].items[1].id = objectId;
    expect(() => createProjectReviewSnapshot(input({ layout: ambiguous }))).toThrow('重复物件');
  });

  it('does not classify a movable preset chair node as fixed structure', () => {
    const preset = layout(); preset.scenePreset = 'gym';
    preset.floors[0].items[0].glbNode = 'Preset_Object_0';
    const review = createProjectReviewSnapshot(input({ layout: preset }));
    expect(review.current.layout.floors[0].items[0].role).toBe('material');
    expect(projectReviewHtml(review)).toContain('2 件示意物料');
    expect(review.current.layout.limitations[0].reason).toContain('节点不据此视为固定设施');
  });

  it('rejects custom serialization, getters and non-atomic wall kind/status without executing callbacks', () => {
    const callback = vi.fn(() => ({ privateValue: 'PRIVATE_SENTINEL' }));
    const bad = layout();
    bad.floors[0].interiorWalls = [{ id: 'wall-1', x1: 0, z1: 0, x2: 1, z2: 1,
      kind: { toJSON: callback } as never }];
    expect(() => createProjectReviewSnapshot(input({ layout: bad }))).toThrow('普通数据');
    expect(callback).not.toHaveBeenCalled();
    bad.floors[0].interiorWalls[0].kind = { privateValue: 'PRIVATE_SENTINEL' } as never;
    expect(() => createProjectReviewSnapshot(input({ layout: bad }))).toThrow();
    const getter = vi.fn(() => 'private');
    Object.defineProperty(bad, 'privateField', { enumerable: true, get: getter });
    expect(() => createProjectReviewSnapshot(input({ layout: bad }))).toThrow('取值器');
    expect(getter).not.toHaveBeenCalled();
  });

  it('escapes text injection and prevents external paint URLs in generated SVG; no scripts or remote resources', () => {
    const original = layout();
    original.name = '"><script>alert(1)</script>';
    original.floors[0].items[0].name = '<img src="https://evil.example/x" onerror="alert(2)">';
    original.floors[0].items[0].color = 'url(https://evil.example/color)';
    const review = createProjectReviewSnapshot(input({ layout: original, notes: [note({ text: '<iframe src="https://evil.example/">&' })] }));
    const document = new DOMParser().parseFromString(projectReviewHtml(review), 'text/html');
    expect(document.querySelectorAll('script,iframe,object,link,[onerror],[onload]')).toHaveLength(0);
    expect(document.querySelectorAll('img')).toHaveLength(0);
    expect([...document.querySelectorAll('svg [fill],svg [stroke]')].some(e => `${e.getAttribute('fill')}${e.getAttribute('stroke')}`.includes('url('))).toBe(false);
    expect(document.body.textContent).toContain('<script>alert(1)</script>');
    expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute('content')).toContain("default-src 'none'");
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('does not load resources, read storage, call a model, or depend on browser APIs', () => {
    const fetch = vi.fn(() => { throw new Error('unexpected network'); });
    vi.stubGlobal('fetch', fetch);
    try {
      const snapshot = createProjectReviewSnapshot(input());
      expect(projectReviewHtml(snapshot)).toContain('方案评审');
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('same-snapshot images and caller freshness protocol', () => {
  it('returns a detached image snapshot and rejects changes to the caller revision or scope', () => {
    const snapshot = createProjectReviewSnapshot(input());
    expect(projectReviewIsStale(snapshot, { ...snapshot.source })).toBe(false);
    expect(projectReviewIsStale(snapshot, { ...snapshot.source, revision: 'edited' })).toBe(true);
    expect(projectReviewIsStale(snapshot, { ...snapshot.source, scope: 'other' })).toBe(true);
    const image = picture();
    const withImage = attachProjectReviewImages(snapshot, [image], snapshot.source);
    expect(snapshot.images).toHaveLength(0);
    image.caption = '后改画面';
    expect(withImage.images[0].caption).toBe('静态评审画面');
    expect(projectReviewHtml(withImage)).toContain(png);
    expect(() => attachProjectReviewImages(snapshot, [picture()], { ...snapshot.source, revision: 'edited' })).toThrow('已过期');
    // Offline files cannot observe later edits. The UI must perform the above check before every download.
    expect(projectReviewHtml(withImage)).toContain('重用前须由工作台检查');
  });

  it.each([
    { snapshotId: 'different' }, { source: { scope, revision: 'older' } },
    { capturedAt: '2026-10-07T09:29:00Z' }, { target: 'adopted' as const },
  ])('rejects wrong snapshot/revision/time/version: %j', patch => {
    const snapshot = createProjectReviewSnapshot(input());
    expect(() => attachProjectReviewImages(snapshot, [picture(patch)], snapshot.source)).toThrow();
    expect(() => projectReviewHtml({ ...snapshot, images: [picture(patch)] })).toThrow();
  });

  it.each([
    'https://private.example/image.png?token=SECRET', 'blob:https://example.test/abc',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/png;base64,PHNjcmlwdD4=', 'data:image/png;base64,not-base64',
  ])('rejects external or misleading image data: %s', dataUrl => {
    const snapshot = createProjectReviewSnapshot(input());
    expect(() => attachProjectReviewImages(snapshot, [picture({ dataUrl })], snapshot.source)).toThrow();
  });

  it('requires explicit customer-use approval and refuses excess picture count/size', () => {
    const snapshot = createProjectReviewSnapshot(input());
    expect(() => attachProjectReviewImages(snapshot, [picture({ approvedForCustomer: false as never })], snapshot.source)).toThrow();
    expect(() => attachProjectReviewImages(snapshot, Array.from({ length: 7 }, () => picture()), snapshot.source)).toThrow();
    expect(() => attachProjectReviewImages(snapshot, [picture({ dataUrl: `data:image/png;base64,${'A'.repeat(6 * 1024 * 1024)}` })], snapshot.source)).toThrow();
  });
});

describe('customer-readable review rendering', () => {
  it('keeps raw identities in a folded appendix and formats display geometry without changing the snapshot', () => {
    const original = layout();
    original.floors[0].items[0].position = { x: -1.7999999999999998, z: 0.30000000000000004 };
    original.floors[0].items[0].rotation = Math.PI / 2;
    const review = createProjectReviewSnapshot(input({ layout: original, notes: [note()] }));
    const before = JSON.stringify(review);
    const html = projectReviewHtml(review);
    const document = new DOMParser().parseFromString(html, 'text/html');
    const appendix = document.querySelector('details')!;
    expect(appendix.hasAttribute('open')).toBe(false);
    expect(appendix.textContent).toContain(objectId);
    expect(appendix.textContent).toContain('横向 -1.8 米 / 纵向 0.3 米');
    expect(appendix.textContent).toContain('旋转 90°');
    expect(document.querySelector('.appendix-help')!.textContent).toContain('请先展开附录并核对打印预览');
    appendix.remove();
    for (const internal of [objectId, '调用方', 'RoomLayout', 'CreativeBrief', 'builtin', 'table', 'Scene JSON', 'GLB', '弧度', '-1.7999999999999998']) {
      expect(document.body.textContent).not.toContain(internal);
    }
    const headings = [...document.querySelectorAll('h2')].map(h => h.textContent);
    expect(headings).toEqual(['活动目标与场地', '布局示意与设计说明', '采用与意见状态', '待确认项', '当前方案物料概览']);
    expect(document.body.textContent).toContain('非实测');
    expect(document.body.textContent).toContain('采用版本：未记录');
    expect(JSON.stringify(review)).toBe(before);
    expect(review.current.layout.floors[0].items[0].position!.x).toBe(-1.7999999999999998);
    expect(review.current.layout.floors[0].items[0].rotation).toBe(Math.PI / 2);
  });

  it('scopes crowded plan label hiding to review diagrams without changing shapes, titles or source names', () => {
    const original = layout();
    const longName = '演练座椅的超长名称保留在逐件附录中';
    original.floors[0].items[0].name = longName;
    original.floors[0].items[0].rotation = Math.PI;
    const review = createProjectReviewSnapshot(input({ layout: original }));
    const before = JSON.stringify(review);
    const document = new DOMParser().parseFromString(projectReviewHtml(review), 'text/html');
    expect(document.querySelector('.plan text.label')!.textContent).toBe(longName);
    expect(document.querySelector('style')!.textContent).toContain('.plan text.label{display:none}');
    expect(document.querySelector('.plan .plan-title')!.textContent).toContain(original.name);
    expect(document.querySelector('.plan .plan-title')!.textContent).toContain(original.floors[0].name);
    expect(document.querySelectorAll('.plan rect.furniture')).toHaveLength(2);
    expect(document.querySelector('details')!.textContent).toContain(longName);
    expect(document.querySelector('details')!.textContent).toContain(objectId);
    expect(JSON.stringify(review)).toBe(before);
    expect(original.floors[0].items[0].name).toBe(longName);
  });

  it('keeps the review identity in the printable footer when the appendix stays closed', () => {
    const review = createProjectReviewSnapshot(input());
    const before = JSON.stringify(review);
    const document = new DOMParser().parseFromString(projectReviewHtml(review), 'text/html');
    expect(document.querySelector('details')!.hasAttribute('open')).toBe(false);
    const identity = document.querySelector('footer .review-id')!;
    expect(identity.textContent).toBe(`评审编号：${review.snapshot.id}`);
    expect(identity.closest('details')).toBeNull();
    expect(identity.textContent).not.toContain(objectId);
    expect(identity.textContent).not.toContain(review.source.revision);
    document.querySelector('details')!.remove();
    expect(document.body.textContent).toContain(`评审编号：${review.snapshot.id}`);
    const printCss = document.querySelector('style')!.textContent!.split('@media print')[1];
    expect(printCss).not.toMatch(/(?:footer|\.review-id)[^{}]*\{[^}]*display\s*:\s*none/);
    expect(JSON.stringify(review)).toBe(before);
  });

  it('prints compact proportional figures without forcing a fresh layout page or hiding screen controls', () => {
    const document = new DOMParser().parseFromString(projectReviewHtml(createProjectReviewSnapshot(input())), 'text/html');
    const css = document.querySelector('style')!.textContent!;
    const printCss = css.slice(css.indexOf('@media print'));
    const screenCss = css.slice(0, css.indexOf('@media print'));
    expect(printCss).toContain('.appendix:not([open]){display:none}');
    expect(printCss).toContain('.appendix[open]{break-before:page}');
    expect(printCss).toContain('.layout{break-before:auto}');
    expect(printCss).toContain('.layout>.caption,.layout>.caption+p{break-after:avoid}');
    expect(printCss).toContain('svg{max-height:100mm;max-width:100%;width:auto;height:auto;margin:0 auto}');
    expect(printCss).toContain('img{display:block;max-height:95mm;max-width:100%;width:auto;height:auto;object-fit:contain;margin:0 auto}');
    expect(printCss).toContain('.appendix-help{display:none}');
    expect(screenCss).not.toContain('.appendix:not([open]){display:none}');
    expect(screenCss).not.toContain('.appendix-help{display:none}');
    expect(document.querySelector('details')!.hasAttribute('open')).toBe(false);
    document.querySelector('details')!.setAttribute('open', '');
    expect(document.querySelector('details')!.hasAttribute('open')).toBe(true);
  });

  it.each([
    { type: 'dining-chair' }, { materialId: 'display' as const }, { width: 1.001 }, { depth: 1.001 }, { height: 1.001 },
    { color: '#abcdef' }, { source: 'public_library' as const }, { assetId }, { mirrored: true },
    { sofaShape: 'L-shape' as const }, { stairsShape: 'winder' as const }, { stairsLeadIn: 2 }, { sillHeight: 0.5 },
  ])('does not merge materials with distinct raw specification, source or model: %j', patch => {
    const first = makeItem({ id: objectId, type: 'chair', source: 'builtin' });
    const second = makeItem({ ...first, id: 'other-chair', ...patch });
    const original = layout();
    original.floors[0].items = [first, second];
    const document = new DOMParser().parseFromString(projectReviewHtml(createProjectReviewSnapshot(input({ layout: original }))), 'text/html');
    const rows = document.querySelectorAll('.materials tbody tr');
    expect(rows).toHaveLength(2);
    expect([...rows].map(r => r.children[1].textContent)).toEqual(['1', '1']);
  });

  it('groups matching specifications across locations while retaining every position and model identity in the appendix', () => {
    const first = makeItem({ id: objectId, type: 'chair', source: 'builtin' });
    const second = makeItem({ ...first, id: 'other-chair', name: '另一把椅子', position: { x: 3, z: -2 }, rotation: Math.PI, elevation: 0.5 });
    const original = layout();
    original.floors = [makeFloor({ id: 'f1', name: '一层', items: [first] }), makeFloor({ id: 'f2', name: '二层', items: [second] })];
    const document = new DOMParser().parseFromString(projectReviewHtml(createProjectReviewSnapshot(input({ layout: original }))), 'text/html');
    expect(document.querySelectorAll('.materials tbody tr')).toHaveLength(1);
    expect(document.querySelector('.materials tbody tr')!.children[0].textContent).toBe('椅子');
    expect(document.querySelector('.materials tbody tr')!.children[1].textContent).toBe('2');
    expect(document.querySelector('details')!.textContent).toContain('横向 3 米 / 纵向 -2 米');
    expect(document.querySelector('details')!.textContent).toContain('旋转 180°');
    expect(document.querySelector('details')!.textContent).toContain('离地 0.5 米');
  });

  it('keeps unversioned models separate and preserves model version correspondence without showing raw IDs in the body', () => {
    const original = layout();
    original.floors[0].items = [makeItem({ id: objectId, type: 'glb-asset' }), makeItem({ id: 'other-chair', type: 'glb-asset' })];
    const unversioned = new DOMParser().parseFromString(projectReviewHtml(createProjectReviewSnapshot(input({ layout: original }))), 'text/html');
    expect(unversioned.querySelectorAll('.materials tbody tr')).toHaveLength(2);
    original.floors[0].items[0].assetId = assetId;
    original.floors[0].items[1].assetId = '80000000-0000-4000-8000-000000000003';
    const versioned = new DOMParser().parseFromString(projectReviewHtml(createProjectReviewSnapshot(input({ layout: original }))), 'text/html');
    expect(versioned.querySelector('.materials')!.textContent).toContain('模型版本 1');
    expect(versioned.querySelector('.materials')!.textContent).toContain('模型版本 2');
    expect(versioned.querySelector('details')!.textContent).toContain(`模型版本 1\n${assetId}`);
    versioned.querySelector('details')!.remove();
    expect(versioned.body.textContent).not.toContain(assetId);
    expect(versioned.body.textContent).not.toContain('80000000-0000-4000-8000-000000000003');
  });

  it.each(['local_sample' as const, undefined])('keeps unversioned models separate even when their declared furniture type is table and source is %s', source => {
    const original = layout();
    original.floors[0].items = [
      makeItem({ id: objectId, type: 'table', glbUrl: '/assets/a.glb', ...(source ? { source } : {}) }),
      makeItem({ id: 'another-model', type: 'table', glbUrl: '/assets/b.glb', ...(source ? { source } : {}) }),
    ];
    const review = createProjectReviewSnapshot(input({ layout: original }));
    const html = projectReviewHtml(review);
    const document = new DOMParser().parseFromString(html, 'text/html');
    const rows = document.querySelectorAll('.materials tbody tr');
    expect(rows).toHaveLength(2);
    expect([...rows].map(r => r.children[1].textContent)).toEqual(['1', '1']);
    expect([...rows].every(r => r.children[4].textContent!.includes('版本未记录'))).toBe(true);
    expect(html).not.toContain('/assets/a.glb');
    expect(html).not.toContain('/assets/b.glb');
  });

  it('does not present the project name as the name of an adopted historical variant', () => {
    const original = layout();
    original.name = '共同项目名称';
    original.designBook = { activeId: 'v2', variants: [
      { id: 'v1', name: '历史方案乙', layout: { ...layout(), name: original.name } },
      { id: 'v2', name: '讨论方案甲', layout: { ...layout(), name: original.name } },
    ] };
    const adoption = { snapshotId: 'review-001', source: input().source, variantId: 'v1', basis: '演练团队选定',
      decision: 'team-selection' as const, sourceLabel: '演练记录', dataKind: 'rehearsal' as const, recordedAt: generatedAt };
    const document = new DOMParser().parseFromString(projectReviewHtml(createProjectReviewSnapshot(input({ layout: original, adoption }))), 'text/html');
    expect(document.querySelector('details')!.textContent).toContain('v1');
    document.querySelector('details')!.remove();
    expect(document.body.textContent).toContain('当前讨论方案：讨论方案甲');
    expect(document.body.textContent).toContain('采用版本：已记录采用方案（编号见附录）');
    expect(document.body.textContent).not.toContain('采用版本：共同项目名称');
  });
});

describe('30-person rehearsal review example', () => {
  it('matches an actual offline HTML generated from the existing backup, without invented client comments or quote', () => {
    const sourcePath = resolve(process.cwd(), '../docs/examples/community-open-day.backup.json');
    const restored = parseLocalProjectBackupJson(readFileSync(sourcePath, 'utf8'));
    expect(restored.brief.status).toBe('present');
    const example = createProjectReviewSnapshot(input({ layout: restored.layout,
      briefSnapshot: { state: 'ready', scope: restored.layout.id!, brief: restored.brief as { status: 'present'; value: CreativeBrief } },
      source: { scope: restored.layout.id!, revision: 'rehearsal-backup-20261007-092531005' },
      snapshot: { id: 'review-community-open-day-20261007', generatedAt: '2026-10-07T17:30:00+08:00' },
      notes: [note({ kind: 'team-check', sourceLabel: '原30人假设演练说明的人工摘录（团队说明）', recordedAt: '2026-10-07T17:25:00+08:00',
        text: '演练设计说明：以5张共创桌组织5组，每组6人；30把椅子对应30名假设参与者。签到台用于签到，背景板、展架和装饰配合成果展示与交流。以上按原演练活动安排摘录，动线、现场容量与物料可获得性尚未核验。' }),
        note({ sourceLabel: '原30人假设演练说明的人工摘录', recordedAt: '2026-10-07T17:25:00+08:00',
        text: '日期、场地实测、出入口、固定设施、供电和容量均待确认。\n外包范围、39件示意物料的实际规格与可获得性、运输安装与报价待确认。\n5000元仅是演练假设上限，不是供应商报价或合同金额。\n真实客户意见、反馈收集和案例展示许可待补。' })],
    }));
    const html = projectReviewHtml(example);
    const examplePath = resolve(process.cwd(), '../docs/examples/community-open-day-review.html');
    // Opt-in reproduction only; ordinary tests never update the checked-in example.
    if (process.env.SCENDANCE_WRITE_REVIEW_EXAMPLE === '1') writeFileSync(examplePath, html, 'utf8');
    expect(readFileSync(examplePath, 'utf8')).toBe(html);
    const document = new DOMParser().parseFromString(html, 'text/html');
    expect(document.body.textContent).toContain('工作坊 / 30 人');
    expect(document.querySelectorAll('rect.furniture')).toHaveLength(39);
    const summaryRows = document.querySelectorAll('.materials tbody tr');
    expect([...summaryRows].map(row => row.children[0].textContent)).toEqual(['桌子', '椅子', '签到台', '背景板', '展架', '装饰道具']);
    expect([...summaryRows].map(row => Number(row.children[1].textContent))).toEqual([5, 30, 1, 1, 1, 1]);
    expect(document.querySelector('details')!.textContent).not.toContain('归档模型编号未记录');
    const appendix = document.querySelector('details')!;
    for (const item of restored.layout.floors.flatMap(f => f.items)) expect(appendix.textContent).toContain(item.id);
    appendix.remove();
    expect(document.body.textContent).toContain('5组，每组6人');
    expect(document.body.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(document.body.textContent).not.toContain('builtin');
    expect(document.body.textContent).not.toContain('table');
    expect(document.body.textContent).not.toContain('-1.7999999999999998');
    expect(document.body.textContent).toContain('5000元仅是演练假设上限');
    expect(document.body.textContent).toContain('真实客户意见／确认：尚未记录，待补');
    expect(document.body.textContent).toContain('采用版本：未记录');
    expect(document.querySelectorAll('script,img,link')).toHaveLength(0);
    expect(html).not.toContain('evidenceNote');
    expect(html).toContain('@media print');
  });
});
