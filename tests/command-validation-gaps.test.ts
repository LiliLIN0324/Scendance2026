import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { agentRunRequestSchema } from '../supabase/functions/_shared/agent-contract.ts';
import { agentExecutionMode } from '../supabase/functions/_shared/agent-runner.ts';
import { CLOSED_GAP_IDS, OPEN_GAP_IDS, auditValidationGaps } from '../supabase/functions/_shared/command-validation-gaps.ts';
import { scene } from './fixtures.ts';

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const report = auditValidationGaps({
  agentRunner: read('../supabase/functions/_shared/agent-runner.ts'),
  aiSource: read('../supabase/functions/_shared/ai.ts'),
  keyboard: read('../frontend/components/room-organizer/hooks/use-keyboard-shortcuts.ts'),
  roomOrganizer: read('../frontend/components/room-organizer/room-organizer.tsx'),
  buildCommand: read('../frontend/lib/build-command.ts'),
  catalogPlacement: read('../frontend/components/room-organizer/lib/catalog-placement-position.ts'),
  creativeStudio: read('../frontend/components/room-organizer/panels/creative-studio.tsx'),
  exploreCase: read('../supabase/functions/_shared/explore-vertical-case.ts'),
});

function mode(instruction: string, executionMode: 'preview' | 'direct' = 'direct') {
  return agentExecutionMode(agentRunRequestSchema.parse({
    requestId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    generation: 1,
    expectedRevision: 0,
    localRevision: 0,
    scene: scene(),
    selectedIds: [],
    instruction,
    executionMode,
  }));
}

describe('命令和撤销的校验缺口', () => {
  it('源码对照列出仍开着的缺口，以及不能退回去的已守住路径', () => {
    expect(report.gaps.filter(gap => gap.status === 'open').map(gap => gap.id)).toEqual([...OPEN_GAP_IDS]);
    expect(report.gaps.filter(gap => gap.status === 'closed').map(gap => gap.id)).toEqual([...CLOSED_GAP_IDS]);
    expect(report.gaps.every(gap => gap.guardIntact)).toBe(true);
    expect(report.commandOps).toEqual(['add', 'remove', 'move', 'rotate', 'recolor', 'replace', 'add_resource', 'replace_resource']);
    expect(report.declaredTools).not.toContain('undo');
    expect(new Set(report.gaps.map(gap => gap.id)).size).toBe(report.gaps.length);
  });

  it('建议、疑问和否定不会因为调用方写了 direct 就变成直接执行', () => {
    for (const instruction of [
      '建议直接摆好一人一桌',
      '请先给建议，不要改场景',
      '能否直接添加轮椅通道？',
      '长者来听讲座，要不要加轮椅？',
      '这只是建议，请不要确认',
      '80把椅子不是80人，请不要直接排',
    ]) {
      expect(mode(instruction, 'direct'), instruction).toBe('preview');
      expect(mode(instruction, 'preview'), instruction).toBe('preview');
    }
  });

  it('面板固定发 preview 时，明确祈使句也不会被标成 direct', () => {
    expect(mode('请立即添加一张桌子', 'preview')).toBe('preview');
    expect(mode('长者讲座请立即添加一张签到桌', 'preview')).toBe('preview');
    expect(mode('请立即添加一张桌子', 'direct')).toBe('direct');
  });
});
