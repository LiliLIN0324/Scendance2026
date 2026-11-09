import { describe, expect, it } from 'vitest';
import { hideUnverifiedSafetyClaim } from '../../../../supabase/functions/_shared/unverified-claims';
import { decideOnApply, snapshotPreviewContext } from '@/lib/preview-guard';
import { checkCandidateInventory } from './candidate-inventory';
import { deliverableInventory } from './deliverable-inventory';
import { cloudBriefMessage, initialBriefMemory, memoryExtraction, mergeZoneNeeds, parseBriefTurn, parseMobilityRequirement } from './brief-agent';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';

const bare = { venueUp: false, scaleTyped: false, hasBase: false, command: null as const };
const mention = (evidence: string) => ({ ...memoryExtraction(initialBriefMemory()), inventoryMentions: [{ evidence }] });

describe('生成不是已采购', () => {
  it('does not store a generated or ordered quantity as on-hand inventory', () => {
    for (const raw of ['生成了80把椅子的模型', '我们有80把生成的椅子', '已采购80把椅子', '下单80把椅子', '建议采购80把椅子']) {
      const turn = parseBriefTurn(raw, initialBriefMemory(), bare, mention('80把椅子'));
      expect(turn.memory.reportedInventory, raw).toBeUndefined();
      expect(turn.memory.headcount, raw).toBeNull();
      expect(turn.kind, raw).not.toBe('generate');
      expect(turn.text, raw).toContain('暂未保存为库存');
    }
  });

  it('labels a generated scene object as a concept, never as purchased stock', () => {
    const layout = makeLayout({ floors: [makeFloor({ items: [makeItem({ id: 'generated-chair', name: '椅子', type: 'chair', source: 'generated', width: 0.5, depth: 0.5, height: 0.8 })] })] });
    const before = structuredClone(layout);
    const rows = deliverableInventory(layout);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ quantity: 1, source: 'generated', procurement: '概念物料，采购待确认' });
    expect(JSON.stringify(rows)).not.toContain('已采购');
    const oralStock = { origin: 'user_reported' as const, entries: [{ name: '口述椅子', identity: { kind: 'type' as const, value: 'chair' }, dimensions: { width: 0.5, depth: 0.5, height: 0.8 }, available: 80 }] };
    expect(checkCandidateInventory(layout, oralStock).status).toBe('unknown');
    expect(layout).toEqual(before);
  });

  it('hides a generated model that claims a safety approval', () => {
    expect(hideUnverifiedSafetyClaim('生成模型已通过消防验收')).toBe('模型意见含未核验安全结论，已隐藏');
    expect(hideUnverifiedSafetyClaim('这是一个可讨论的椅子方向')).toBe('这是一个可讨论的椅子方向');
  });
});

describe('建议不是确认', () => {
  it.each(['建议采用课桌椅', '可以考虑圆桌', '推荐课桌式布置', '不妨用宴会式圆桌'])('does not confirm a layout from a suggestion: %s', raw => {
    const turn = parseBriefTurn(raw, initialBriefMemory(), bare);
    expect(turn.memory.layoutModeConfirmed).not.toBe(true);
    expect(turn.memory.layoutModeUnresolved).toBe(true);
    expect(turn.kind).not.toBe('generate');
    expect(cloudBriefMessage(raw, turn.memory)).not.toContain('布置：');
  });

  it('still confirms an explicit layout choice and an explicit zone need', () => {
    const layout = parseBriefTurn('采用课桌椅', initialBriefMemory(), bare);
    expect(layout.memory.layoutMode).toBe('desk-chair');
    expect(layout.memory.layoutModeConfirmed).toBe(true);
    const zone = parseBriefTurn('需要签到区', initialBriefMemory(), bare);
    expect(zone.memory.zoneNeeds.checkin).toBe(true);
    expect(parseMobilityRequirement('本场需要轮椅通道')?.decision).toBe('needed');
  });

  it('keeps suggested zones, seating and mobility unconfirmed until an explicit answer', () => {
    expect(mergeZoneNeeds('建议要签到区', initialBriefMemory().zoneNeeds).checkin).toBeNull();
    const seated = parseBriefTurn('建议人人都入座', initialBriefMemory(), bare);
    expect(seated.memory.allGuestsSeated).toBeNull();
    expect(parseMobilityRequirement('建议需要轮椅通道')?.decision).toBe('unknown');
    const pending = parseBriefTurn('安排休息', initialBriefMemory(), bare, {
      ...memoryExtraction(initialBriefMemory()),
      activityNeeds: [{ kind: 'rest', decision: 'needed', evidence: '安排休息' }],
    });
    expect(pending.memory.zoneNeeds.rest).toBeNull();
    expect(pending.text).toContain('这样对吗');
    expect(parseBriefTurn('不对', pending.memory, bare).memory.zoneNeeds.rest).toBeNull();
    expect(parseBriefTurn('确认', pending.memory, bare).memory.zoneNeeds.rest).toBe(true);
  });

  it('does not apply a candidate when the canvas no longer matches the suggestion baseline', () => {
    const base = makeLayout();
    const suggested = makeLayout({ floors: [makeFloor({ items: [makeItem({ id: 'suggested' })] })] });
    const ctx = snapshotPreviewContext(base, suggested);
    expect(decideOnApply(base, ctx).action).toBe('apply');
    expect(decideOnApply(suggested, ctx).action).toBe('prompt');
  });
});

describe('口述不是场景模型', () => {
  it('keeps an oral chair count out of the scene and out of verified stock', () => {
    const scene = makeLayout();
    const turn = parseBriefTurn('我们有80把椅子', initialBriefMemory(), bare, mention('80把椅子'));
    expect(turn.memory.headcount).toBeNull();
    expect(turn.memory.reportedInventory).toEqual([{ evidence: '我们有80把椅子', status: 'reported' }]);
    expect(deliverableInventory(scene)).toEqual([]);
    const prompt = cloudBriefMessage('继续', turn.memory);
    expect(prompt).toContain('用户口述，未核验、未选择');
    expect(prompt).toContain('不是已核实库存，也没有自动选用');
    expect(prompt).not.toContain('已采购');
    expect(JSON.stringify(turn.memory.reportedInventory)).not.toContain('glb');
  });
});
