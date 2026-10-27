/**
 * 对话 resolver：真模型优先、规则版兜底。
 *
 * NEXT_PUBLIC_AGENT_ENABLED=1 且后端可用时，槽位由 scene-api /brief/extract 提取
 * （模型 key 在 Supabase secrets，浏览器不接触）；失败或未配置一律原路回退
 * brief-agent 规则版——对话永不因模型抖动中断。决策（记忆/防复读/出方案）始终在前端状态机。
 */
import { parseBriefTurn, type BriefMemory, type BriefTurn, type BriefTurnContext, type LayoutMode } from '@/components/room-organizer/lib/brief-agent';
import type { BriefSlots } from '../../supabase/functions/_shared/brief-extract-contract';
import type { BriefExtraction } from '@/components/room-organizer/lib/workbench-agent';

export function modelEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AGENT_ENABLED === '1';
}

export interface BriefExtractTransport {
  briefExtract(message: string): Promise<{ enabled: boolean; extraction: BriefSlots | null }>;
}

export async function resolveBriefTurn(raw: string, previous: BriefMemory, context: BriefTurnContext, controller?: BriefExtractTransport | null): Promise<BriefTurn> {
  if (modelEnabled() && controller) {
    try {
      // 模型慢不让对话干等：12s 内没结果就用规则版先答，模型结果这次不用。
      const response = await Promise.race([
        controller.briefExtract(raw),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('brief extract timeout')), 12_000)),
      ]);
      if (response.enabled && response.extraction) {
        return parseBriefTurn(raw, previous, context, toExtraction(response.extraction));
      }
    } catch {
      // 后端不可用/未登录/模型抖动/超时：落到规则版。
    }
  }
  return parseBriefTurn(raw, previous, context);
}

/** 后端槽位 → 前端 BriefExtraction（layoutMode 走独立通道进记忆槽）。 */
function toExtraction(slot: BriefSlots): BriefExtraction & { layoutMode: LayoutMode | null } {
  return {
    event: slot.event ?? null,
    headcount: slot.headcount ?? null,
    venueIO: slot.venueIO ?? null,
    lengthM: slot.lengthM ?? null,
    widthM: slot.widthM ?? null,
    areaM2: slot.areaM2 ?? null,
    timeOfDay: slot.timeOfDay ?? null,
    layoutMode: slot.layoutMode ?? null,
  };
}
