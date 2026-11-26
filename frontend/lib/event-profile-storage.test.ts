import { describe, expect, it } from 'vitest';
import type { CreativeBrief } from '../components/room-organizer/lib/creative-brief';
import { makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { parseStoredLayout } from '../components/room-organizer/lib/schema';
import type { RoomLayout } from '../components/room-organizer/lib/types';
import { eventProfileSchema, type EventProfile } from './event-profile';
import { layoutForExport } from './layout-export';
import { prepareLocalRestoreLayout } from './local-project-restore';
import {
  LOCAL_PROJECT_BACKUP_V4_COVERAGE, createLocalProjectBackup, parseLocalProjectBackupJson,
  serializeLocalProjectBackupV4, serializeLocalProjectBackupV5, serializeLocalProjectBackupV6, validateLocalProjectRestoreCandidate,
  type BackupBriefSnapshot, type BackupMaterialCheckinSnapshot,
} from './local-project-backup';

const scope = 'event-profile-project';
const createdAt = '2026-10-07T09:30:00.000Z';
/** 未写入的事实：unknown + unavailable + 无值，与“没有档案”不是一回事。 */
const unknownFact = { value: null, status: 'unknown', source: 'unavailable' } as const;

const brief = (): CreativeBrief => ({
  event: '年度分享会', guests: 60, description: '客户原话', mustHave: '入口通畅',
  allowIdeas: false, hasFloorplan: true, venueConditions: '北侧入口',
  style: '素雅', palette: '米白', atmosphere: '安静',
});

const profile = (): EventProfile => eventProfileSchema.parse({
  schemaVersion: 1, revision: 1, updatedBy: '策划甲', updatedAt: '2026-10-01T00:00:00.000Z',
  date: { value: '2026-12-20', status: 'confirmed', source: 'user_statement',
    revision: 1, updatedBy: '策划甲', updatedAt: '2026-10-01T00:00:00.000Z' },
  timeWindow: unknownFact, venue: unknownFact, budget: unknownFact,
  expectedAttendance: unknownFact, goal: unknownFact, division: unknownFact,
});

const profileLayout = (): RoomLayout => makeLayout({ id: scope, eventProfile: profile() });
const ready = (): BackupBriefSnapshot => ({ state: 'ready', scope, brief: { status: 'present', value: brief() } });
const noCheckins = (): BackupMaterialCheckinSnapshot => ({
  state: 'ready', scope, materialCheckins: { status: 'absent' },
});
const noSources = { scope, sources: [], form: {} };

describe('RoomLayout.eventProfile 本地侧车', () => {
  it('旧布局没有档案时保持缺失，不补空档案', () => {
    const parsed = parseStoredLayout(makeLayout({ id: scope }));
    expect(parsed).not.toBeNull();
    expect(parsed?.eventProfile).toBeUndefined();
  });

  it('读取时保留合法档案，字段与值不变', () => {
    const parsed = parseStoredLayout(JSON.parse(JSON.stringify(profileLayout())));
    expect(parsed?.eventProfile).toEqual(profile());
  });

  it('档案字段无效时拒绝整份布局，而不是静默丢弃档案', () => {
    const invalid = { ...profileLayout(), eventProfile: {
      ...profile(), date: { ...profile().date, value: '2026-13-01' },
    } };
    expect(parseStoredLayout(invalid as unknown as RoomLayout)).toBeNull();
  });

  it('设计变体不能携带活动档案：属于整场活动，不随方案分裂', () => {
    const nested = makeLayout({ id: scope, designBook: { activeId: 'v1', variants: [
      { id: 'v1', name: '方案甲', layout: profileLayout() },
    ] } });
    expect(parseStoredLayout(nested)).toBeNull();
  });
});

describe('活动档案的发布边界', () => {
  it('本地导出副本保留档案', () => {
    expect(layoutForExport(profileLayout()).eventProfile).toEqual(profile());
  });

  it('分享/发布载荷不包含活动档案（T12）', () => {
    const exported = layoutForExport(profileLayout(), true);
    expect('eventProfile' in exported).toBe(false);
    expect(Object.keys(exported)).not.toContain('eventProfile');
  });

  it('变体导出同样剥掉本地执行资料', () => {
    const nested = makeLayout({ id: scope, productionPlan: undefined, designBook: {
      activeId: 'v1', variants: [{ id: 'v1', name: '方案甲', layout: makeLayout({ id: 'variant-1' }) }],
    } });
    const exported = layoutForExport(nested, true);
    expect('eventProfile' in (exported.designBook?.variants[0]!.layout ?? {})).toBe(false);
  });
});

describe('备份版本与活动档案', () => {
  it('V2 备份拒绝夹带活动档案并指向 V5', () => {
    expect(() => createLocalProjectBackup(profileLayout(), ready(), { projectId: scope }, createdAt)).toThrow(/V5/);
  });

  it('V4 备份同样不能冒充已覆盖活动档案', async () => {
    await expect(serializeLocalProjectBackupV4(profileLayout(), ready(), noCheckins(), noSources, { projectId: scope }, createdAt))
      .rejects.toThrow(/V5/);
  });

  it('V5 往返保留档案、点验状态与图片字段', async () => {
    const text = await serializeLocalProjectBackupV5(profileLayout(), ready(), noCheckins(), noSources, { projectId: scope }, createdAt);
    const parsed = parseLocalProjectBackupJson(text);
    expect(parsed.backupVersion).toBe(5);
    expect(parsed.layout.eventProfile).toEqual(profile());
    expect(parsed.materialCheckins).toEqual({ status: 'absent' });
    expect(parsed.sourceDocuments).toMatchObject({ status: 'present', sources: [] });
  });

  it('V5 文件缺少 eventProfile 覆盖声明时拒绝', async () => {
    const text = await serializeLocalProjectBackupV5(profileLayout(), ready(), noCheckins(), noSources, { projectId: scope }, createdAt);
    const document = JSON.parse(text);
    delete document.coverage.eventProfile;
    expect(() => parseLocalProjectBackupJson(JSON.stringify(document))).toThrow(/备份信息或活动需求字段无效/);
  });

  it('V4 文件里藏活动档案属于混版，一律拒绝', async () => {
    const text = await serializeLocalProjectBackupV5(profileLayout(), ready(), noCheckins(), noSources, { projectId: scope }, createdAt);
    const document = { ...JSON.parse(text), version: 4, coverage: LOCAL_PROJECT_BACKUP_V4_COVERAGE };
    expect(() => parseLocalProjectBackupJson(JSON.stringify(document))).toThrow(/V1–V4/);
  });

  it('V5 也不能把档案放进设计变体', async () => {
    const nested = makeLayout({ id: scope, eventProfile: profile(), designBook: {
      activeId: 'v1', variants: [{ id: 'v1', name: '方案甲', layout: profileLayout() }],
    } });
    await expect(serializeLocalProjectBackupV5(nested, ready(), noCheckins(), noSources, { projectId: scope }, createdAt))
      .rejects.toThrow(/设计变体/);
  });

  it('V5 写入前仍校验档案字段', async () => {
    const invalid = { ...profileLayout(), eventProfile: { ...profile(), updatedBy: '   ' } };
    await expect(serializeLocalProjectBackupV5(invalid as unknown as RoomLayout, ready(), noCheckins(), noSources, { projectId: scope }, createdAt))
      .rejects.toThrow(/活动档案字段无效/);
  });

  it('V5 候选回填后仍保留档案', async () => {
    const text = await serializeLocalProjectBackupV5(profileLayout(), ready(), noCheckins(), noSources, { projectId: scope }, createdAt);
    const candidate = validateLocalProjectRestoreCandidate(parseLocalProjectBackupJson(text));
    expect(candidate.backupVersion).toBe(5);
    expect(candidate.layout.eventProfile).toEqual(profile());
  });

  it('没有档案的项目也能生成 V5 备份', async () => {
    const text = await serializeLocalProjectBackupV5(makeLayout({ id: scope }), ready(), noCheckins(), noSources, { projectId: scope }, createdAt);
    expect(parseLocalProjectBackupJson(text).layout.eventProfile).toBeUndefined();
  });

  it('恢复准备阶段用旧版校验布局时不得丢掉档案', () => {
    expect(prepareLocalRestoreLayout(profileLayout(), scope).eventProfile).toEqual(profile());
  });
});

describe('本机归档 V6（含档案、不含图片）', () => {
  it('V6 往返保留档案与点验状态，并明确没有图片字段', () => {
    const parsed = parseLocalProjectBackupJson(serializeLocalProjectBackupV6(profileLayout(), ready(), noCheckins(), { projectId: scope }, createdAt));
    expect(parsed.backupVersion).toBe(6);
    expect(parsed.layout.eventProfile).toEqual(profile());
    expect(parsed.materialCheckins).toEqual({ status: 'absent' });
    expect(parsed.sourceDocuments).toEqual({ status: 'not-in-file' });
  });

  it('V6 缺档案覆盖声明时拒绝', () => {
    const document = { ...JSON.parse(serializeLocalProjectBackupV6(profileLayout(), ready(), noCheckins(), { projectId: scope }, createdAt)) };
    delete document.coverage.eventProfile;
    expect(() => parseLocalProjectBackupJson(JSON.stringify(document))).toThrow(/备份信息或活动需求字段无效/);
  });

  it('V6 候选没有真实点验状态时拒绝，而不是当成 V3', () => {
    const candidate = parseLocalProjectBackupJson(serializeLocalProjectBackupV6(profileLayout(), ready(), noCheckins(), { projectId: scope }, createdAt));
    expect(() => validateLocalProjectRestoreCandidate({ ...candidate, materialCheckins: { status: 'not-in-file' } })).toThrow(/V6 候选/);
  });

  it('V6 候选回填保留档案且图片仍为未携带', () => {
    const candidate = validateLocalProjectRestoreCandidate(
      parseLocalProjectBackupJson(serializeLocalProjectBackupV6(profileLayout(), ready(), noCheckins(), { projectId: scope }, createdAt)));
    expect(candidate.backupVersion).toBe(6);
    expect(candidate.layout.eventProfile).toEqual(profile());
    expect(candidate.sourceDocuments).toEqual({ status: 'not-in-file' });
  });
});
