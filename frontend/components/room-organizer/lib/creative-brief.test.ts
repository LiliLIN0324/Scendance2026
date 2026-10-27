import { describe, expect, it } from 'vitest';
import { parseLocalProjectBackupJson, serializeLocalProjectBackup } from '@/lib/local-project-backup';
import { backendSceneToLayout, layoutToBackendScene } from './backend-adapter';
import { briefInstruction, buildBriefReference, composeBriefReference, CREATIVE_BRIEF_DESCRIPTION_LIMIT, INITIAL_BRIEF, isBlankBriefScaffold, migrateBriefDescription, mergeProposalPresentation } from './creative-brief';
import { HEADCOUNT_MAX } from './workbench-agent';
import type { Scene } from '@/lib/backend-session';

const scene: Scene = { schemaVersion: 1, venue: { width: 12, depth: 10, height: 3, shape: 'rectangle', entrances: [] }, camera: 'overview', lighting: 'neutral', objects: [{ id: '10000000-0000-4000-8000-000000000001', materialId: 'chair', position: { x: 2, z: 2 }, rotation: 0, size: { width: .5, depth: .5, height: .9 }, color: '#ffffff', locked: false, notes: '' }] };

describe('creative brief boundaries', () => {
  it('generates a filled reference from the current type and headcount, not blank labels', () => {
    const text = buildBriefReference({ ...INITIAL_BRIEF, event: '工作坊', guests: 16 });
    expect(text).toContain('【需求参考 · 工作坊 · 16 人】');
    expect(text).toContain('目标：让每位参与者坐下来动手');
    expect(text).toContain('观众：报名参加的来宾');
    expect(text).toContain('布置：每人有可操作的台面');
    expect(text).not.toMatch(/活动目标：\s*$/m);
    expect(text).not.toMatch(/参与观众：\s*$/m);
    expect(text).not.toMatch(/布置要求：\s*$/m);
    expect(text).not.toMatch(/30人|5000|2026|已确认完成/);
  });

  it('carries known must-haves, venue conditions, style and atmosphere into the reference', () => {
    const text = buildBriefReference({
      ...INITIAL_BRIEF, event: '展会', guests: 80,
      mustHave: '签到区、无障碍通道', venueConditions: '北侧入口不得遮挡',
      style: '自然露营', palette: '米白橄榄绿', atmosphere: '温暖夜场',
    });
    for (const part of ['必须保留：签到区、无障碍通道', '现场条件：北侧入口不得遮挡', '风格：自然露营', '配色：米白橄榄绿', '氛围：温暖夜场']) {
      expect(text).toContain(part);
    }
  });

  it('omits the headcount when the number is not valid', () => {
    const text = buildBriefReference({ ...INITIAL_BRIEF, event: '工作坊', guests: 0 });
    expect(text).toContain('【需求参考 · 工作坊】');
    expect(text).not.toContain(' 人】');
  });

  it('treats the old blank scaffold as empty and migrates it away', () => {
    const old = '【创意简报与观众体验】\n活动目标：\n参与观众：\n布置要求：';
    const bare = '活动目标：\n参与观众：\n布置要求：';
    expect(isBlankBriefScaffold(old)).toBe(true);
    expect(isBlankBriefScaffold(bare)).toBe(true);
    expect(migrateBriefDescription(old)).toBe('');
    expect(migrateBriefDescription(bare)).toBe('');
    expect(isBlankBriefScaffold('活动目标：让来宾愿意停留')).toBe(false);
    expect(migrateBriefDescription('客户原话：保留入口。\n\n活动目标：\n参与观众：')).toBe('客户原话：保留入口。');
  });

  it('preserves the complete original text and does not append a second copy', () => {
    const original = '  客户原话：保留入口。\n假设：两人执行。  ';
    const once = composeBriefReference(original, { ...INITIAL_BRIEF, event: '工作坊', guests: 16 });
    expect(once).toBe(`客户原话：保留入口。\n假设：两人执行。\n\n${buildBriefReference({ ...INITIAL_BRIEF, event: '工作坊', guests: 16 })}`);
    expect(composeBriefReference(once, { ...INITIAL_BRIEF, event: '工作坊', guests: 16 })).toBe(once);
  });

  it('refreshes the previous reference instead of stacking another one', () => {
    const first = composeBriefReference('客户原话。', { ...INITIAL_BRIEF, event: '工作坊', guests: 16 });
    const next = composeBriefReference(first, { ...INITIAL_BRIEF, event: '展览市集', guests: 80 });
    expect(next).toContain('客户原话。');
    expect(next).not.toContain('【需求参考 · 工作坊 · 16 人】');
    expect(next.match(/【需求参考 ·/g)).toHaveLength(1);
    expect(next).toContain('【需求参考 · 展览市集 · 80 人】');
  });

  it('replaces the old scaffold outright when the field has no other text', () => {
    const old = '【创意简报与观众体验】\n活动目标：\n参与观众：\n布置要求：';
    const next = composeBriefReference(old, { ...INITIAL_BRIEF, event: '工作坊', guests: 16 });
    expect(next).toBe(buildBriefReference({ ...INITIAL_BRIEF, event: '工作坊', guests: 16 }));
    expect(next).not.toContain('活动目标：');
  });

  it('accepts the exact editor limit and refuses overflow without truncation', () => {
    const reference = buildBriefReference({ ...INITIAL_BRIEF, event: '工作坊', guests: 16 });
    const original = '甲'.repeat(CREATIVE_BRIEF_DESCRIPTION_LIMIT - reference.length - 2);
    expect(composeBriefReference(original, { ...INITIAL_BRIEF, event: '工作坊', guests: 16 })).toHaveLength(CREATIVE_BRIEF_DESCRIPTION_LIMIT);
    expect(() => composeBriefReference(original + '乙', { ...INITIAL_BRIEF, event: '工作坊', guests: 16 })).toThrow('原文字保持不变');
    expect(original.endsWith('甲')).toBe(true);
  });

  it('keeps manual text in the same backup and generation source', () => {
    const brief = { ...INITIAL_BRIEF, description: composeBriefReference('假设演练：交流开放日', { ...INITIAL_BRIEF, event: '工作坊', guests: 16 }) };
    const layout = backendSceneToLayout(scene, { projectId: 'brief-template-rehearsal' });
    const restored = parseLocalProjectBackupJson(serializeLocalProjectBackup(layout, {
      state: 'ready', scope: layout.id!, brief: { status: 'present', value: brief },
    }));
    expect(restored.brief).toEqual({ status: 'present', value: brief });
    expect(briefInstruction(brief, 12, 10)).toContain(brief.description);
    expect(Object.keys(brief)).toEqual(Object.keys(INITIAL_BRIEF));
  });
  it('accepts a headcount the chat can also parse and rejects only out-of-range input', () => {
    const brief = { ...INITIAL_BRIEF, description: '交流活动' };
    for (const guests of [0, 1.5, HEADCOUNT_MAX + 1, 100000, NaN]) expect(() => briefInstruction({ ...brief, guests }, 12, 10)).toThrow(`1–${HEADCOUNT_MAX}`);
    expect(() => briefInstruction(INITIAL_BRIEF, 12, 10)).toThrow('描述');
    expect(briefInstruction({ ...brief, guests: 80 }, 12, 10)).toContain('80人');
    expect(briefInstruction({ ...brief, guests: HEADCOUNT_MAX }, 12, 10)).toContain(`${HEADCOUNT_MAX}人`);
  });

  it('does not imply image understanding and creates a complete preview for confirmation', () => {
    const instruction = briefInstruction({ ...INITIAL_BRIEF, description: '要帐篷和签到区' }, 12, 10);
    expect(instruction).toContain('完整候选后由客户整体确认');
    expect(instruction).toContain('现场照片尚未提交给模型');
    expect(instruction).toContain('不得用桌椅冒充');
    expect(instruction).toContain('依据当前资源库');
    expect(instruction).not.toContain('帐篷、拱门等当前不支持');
    expect(briefInstruction({ ...INITIAL_BRIEF, description: '交流会', allowIdeas: false }, 12, 10)).toContain('不自行扩展');
  });

  it('carries confirmed venue conditions, style, palette and atmosphere without pretending to read images', () => {
    const instruction=briefInstruction({...INITIAL_BRIEF,description:'品牌活动',venueConditions:'北侧入口不得遮挡',style:'自然露营',palette:'米白橄榄绿',atmosphere:'温暖夜场'},12,10);
    for(const text of ['北侧入口不得遮挡','自然露营','米白橄榄绿','温暖夜场','文字输入，非图片识别']) expect(instruction).toContain(text);
  });

  it('persists the default neutral atmosphere of a local draft', () => {
    const local = backendSceneToLayout(scene);
    delete local.backendLighting;
    expect(layoutToBackendScene(local).lighting).toBe('neutral');
  });

  it('keeps local presentation while applying only server-authorized scene changes', () => {
    const base = backendSceneToLayout(scene);
    base.floors[0]!.floorColor = '#ff0000';
    base.floors[0]!.items[0]!.name = '客户选定的座椅';
    base.floors[0]!.items[0]!.groupId = 'local-group';
    const changed = structuredClone(scene);
    changed.objects[0]!.position.x = 6;
    changed.lighting = 'cool';
    const next = mergeProposalPresentation(base, backendSceneToLayout(changed));
    expect(next.floors[0]!.floorColor).toBe('#ff0000');
    expect(next.floors[0]!.items[0]).toMatchObject({ name: '客户选定的座椅', groupId: 'local-group' });
    expect(layoutToBackendScene(next)).toEqual(changed);
    expect(layoutToBackendScene(base)).toEqual(scene);
  });
});


it('routes missing materials to supported parametric families and keeps the full structured brief',()=>{
  const instruction=briefInstruction({...INITIAL_BRIEF,description:'完整活动需求'.repeat(600)},12,10);
  expect(instruction.length).toBeGreaterThan(3000);
  expect(instruction).toContain('参数化工具建模');
  expect(instruction).not.toContain('HY3');
});
