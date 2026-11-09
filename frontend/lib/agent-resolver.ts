/**
 * 对话 resolver：真模型优先、规则版兜底。
 *
 * NEXT_PUBLIC_AGENT_ENABLED=1 且后端可用时，槽位由 scene-api /brief/extract 提取
 * （模型 key 在 Supabase secrets，浏览器不接触）；失败或未配置一律原路回退
 * brief-agent 规则版——对话永不因模型抖动中断。决策（记忆/防复读/出方案）始终在前端状态机。
 */
import { hasNonPersonQuantity, isActivityNeedsAnswer, isUnresolvedNeedsAnswer, parseBriefTurn, type BriefMemory, type BriefTurn, type BriefTurnContext, type LayoutMode, type PendingBasicFact } from '@/components/room-organizer/lib/brief-agent';
import { HEADCOUNT_MAX, isLayoutOnlyUtterance, layoutGenerateCommand, omitHandledLayoutActions, parseBriefSentence } from '@/components/room-organizer/lib/workbench-agent';
import { BRIEF_CLIENT_TIMEOUT_MS, type BriefSlots, type BriefConversationResponse } from '../../supabase/functions/_shared/brief-extract-contract';
import { SceneApiError } from '../../client/scene-client';
import { isGeneralActivityQuestion } from '@/components/room-organizer/lib/general-activity-question';
import { supportedMaterialQueries } from '@/components/room-organizer/lib/material-query-evidence';
import { withoutNonTotalHeadcounts } from '@/components/room-organizer/lib/attendance-evidence';
import type { BriefExtraction } from '@/components/room-organizer/lib/workbench-agent';

export function modelEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AGENT_ENABLED === '1';
}

export interface BriefExtractTransport {
  briefExtract(message: string, signal?:AbortSignal): Promise<{ enabled: boolean; extraction: BriefSlots | null; reason?: string | undefined }>;
  briefConversation?(message:string,history:Array<{role:'user'|'assistant';text:string}>,signal?:AbortSignal):Promise<BriefConversationResponse>;
}

export type BriefResolution = 'model' | 'confirmation' | 'local_command' | 'disabled' | 'not_connected' | 'unavailable' | 'failed';
/** Stable category for logs and tests. Production chat copy stays in modelNotice. */
export interface ModelCallDiagnostic { category: 'unauthenticated' | 'route' | 'config' | 'timeout' | 'session' | 'network' | 'non_json' | 'contract' | 'http' | 'provider' | 'unknown'; status?: number; code?: string }
export type ResolvedBriefTurn = BriefTurn & { resolution: BriefResolution; modelNotice?: string; modelDiagnostic?: ModelCallDiagnostic; modelReply?:string; unhandled?:BriefConversationResponse['unhandled']; materialQueries?:string[]; readOnlyReply?:boolean; usesModelText?:boolean; resumeInstruction?:string };

/** Only recognise these explicit, non-executing instructions; preserve them
 * in unhandled for review, and reject any accompanying unrecognised action. */
function isReadOnlyAdviceBoundary(evidence: string, raw: string): boolean {
  if (!raw.includes(evidence)) return false;
  const parts = evidence.split(/[，,；;。]/u).map(part => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every(part => /^(?:请)?(?:先)?给(?:我)?(?:一些|一点)?建议$/u.test(part) ||
    /^(?:请)?(?:不要|别|不必|无需)(?:改|修改|调整)(?:场景|画布|布局)$/u.test(part));
}

const SAFE_DIAGNOSTIC_CODE=/^(?:[A-Z][A-Z0-9_]{0,64}|PROVIDER_HTTP_ERROR:[1-5]\d{2})$/;
function safeDiagnosticCode(value: string | undefined): string | undefined {
  return value && SAFE_DIAGNOSTIC_CODE.test(value) ? value : undefined;
}
function providerDiagnostic(reason: string | undefined, enabled: boolean): ModelCallDiagnostic {
  const code=safeDiagnosticCode(reason);
  return {category:enabled?'provider':'config',...(code?{code}:{})};
}
function thrownModelFailure(error: unknown, timedOut: boolean): { notice: string; diagnostic: ModelCallDiagnostic } {
  if(timedOut)return {notice:'智能理解响应超时，已尝试取消请求；服务商可能仍会计费，请先核对状态和用量。本次先使用本地规则理解，请核对结果。',diagnostic:{category:'timeout',code:'MODEL_TIMEOUT'}};
  if(error instanceof SceneApiError){
    const code=safeDiagnosticCode(error.code);
    const status=error.status;
    const diagnostic=(category: ModelCallDiagnostic['category']): ModelCallDiagnostic => ({category,...(code?{code}:{}),...(Number.isInteger(status)?{status}:{})});
    if(error.code==='UNAUTHENTICATED')return {notice:'请先登录以使用智能理解；本次先使用本地规则理解，请核对结果。',diagnostic:diagnostic('unauthenticated')};
    if(error.code==='ROUTE_NOT_FOUND')return {notice:'当前服务尚未提供智能理解，请联系管理员更新服务。本次使用本地规则理解，请核对结果。',diagnostic:diagnostic('route')};
    if(error.code==='BRIEF_GUARD_NOT_READY'||error.code==='CONVERSATION_API_NOT_CONFIGURED'||error.code==='CONVERSATION_API_DISABLED')return {notice:'智能理解暂未开放，请联系管理员完成配置。本次使用本地规则理解，请核对结果。',diagnostic:diagnostic('config')};
    if(error.code==='SESSION_CHANGED')return {notice:'登录状态已变化，本次先使用本地规则理解，请核对结果。',diagnostic:diagnostic('session')};
    if(error.code==='NETWORK_ERROR')return {notice:'智能理解网络请求没有完成，本次先使用本地规则理解，请核对结果。',diagnostic:diagnostic('network')};
    if(error.code==='NON_JSON_RESPONSE')return {notice:'智能理解服务返回了无法读取的内容，本次先使用本地规则理解，请核对结果。',diagnostic:diagnostic('non_json')};
    if(error.code==='INVALID_RESPONSE')return {notice:'智能理解结果未通过校验，未能完整理解本次要求，本次未生成方案。本次使用本地规则理解，请核对结果。',diagnostic:diagnostic('contract')};
    return {notice:'智能理解暂不可用，本次先使用本地规则理解；如请求已发出，请先核对服务状态和用量。',diagnostic:diagnostic('http')};
  }
  if(error instanceof Error && error.name==='ZodError')return {notice:'智能理解结果未通过校验，未能完整理解本次要求，本次未生成方案。本次使用本地规则理解，请核对结果。',diagnostic:{category:'contract',code:'INVALID_RESPONSE'}};
  return {notice:'智能理解暂不可用，本次先使用本地规则理解；如请求已发出，请先核对服务状态和用量。',diagnostic:{category:'unknown'}};
}
function modelFailureNotice(reason: string | undefined): string {
  if (reason === 'MODEL_PROVIDER_INCOMPLETE' || reason === 'MODEL_PROVIDER_URL_INVALID' || reason === 'MODEL_PROVIDER_PROFILE_INVALID' || reason === 'MODEL_PROVIDER_UNSUPPORTED_WORKFLOW' || reason === 'SERVICE_NOT_CONFIGURED') return '智能理解服务配置不完整或地址无效，请联系管理员检查。';
  if (reason === 'PROVIDER_HTTP_ERROR:401' || reason === 'PROVIDER_HTTP_ERROR:403') return '智能理解服务认证或权限未通过，请联系管理员检查。';
  if (reason === 'PROVIDER_HTTP_ERROR:402') return '智能理解服务余额或计费状态异常，请联系管理员检查。';
  if (reason === 'PROVIDER_HTTP_ERROR:429') return '智能理解服务请求过多；请先核对服务状态和用量。';
  if (reason === 'MODEL_TIMEOUT') return '智能理解服务响应超时，已尝试取消请求；服务商可能仍会计费，请先核对状态和用量。';
  if (reason === 'MODEL_EVIDENCE_MISMATCH' || reason === 'MODEL_INVALID_JSON' || reason === 'MODEL_INVALID_RESPONSE' || reason === 'MODEL_INCOMPLETE_OUTPUT' || reason === 'PROVIDER_INVALID_JSON') return '智能理解结果未通过校验，未能完整理解本次要求，本次未生成方案。';
  return '智能理解服务暂时不可用；如请求已发出，请先核对服务状态和用量。';
}

/** The model only extracts this turn; its prose may overlook earlier facts.
 * Do not present a contradictory attendance assertion as current state. */
function reconcileHeadcountReply(text:string|undefined,memory:BriefMemory,pending:PendingBasicFact[]):string|undefined {
  if(!text)return text;
  const hasPending=pending.some(fact=>fact.key==='headcount');
  const current=memory.headcount;
  const unknown=/(?:总人数|本场人数|人数|参会人数|参加人数)[^。！？!?]{0,40}(?:尚未|未明确|未确定|不确定|未知|待定|未定|没有提供|没有说明|没确定|不明)/u.test(text)
    ||/(?:尚未|未曾|没有|没|未)[^。！？!?]{0,16}(?:说明|提供|明确|确定)[^。！？!?]{0,12}(?:总人数|人数|参加人数)/u.test(text);
  const countText=withoutNonTotalHeadcounts(text);
  const asserted=[...countText.matchAll(/(?:总人数|本场人数|预计人数|参会人数|参加人数|人数|本场(?:活动)?|本次(?:活动)?)(?:\s|为|是|约|预计|共有|共|需要|有|：|:){0,12}(\d{1,6})\s*(?:人|位|名)/gu)].map(match=>Number(match[1]));
  const conflict=hasPending ? asserted.length>0 : current!==null&&(unknown||asserted.some(value=>value!==current));
  if(!conflict)return text;
  return hasPending||current===null?'本场人数还需核对；请以确认后的需求为准。':`本场已记录 ${current} 人；如人数有变化，请直接更正。`;
}

export async function resolveBriefTurn(raw: string, previous: BriefMemory, context: BriefTurnContext, controller?: BriefExtractTransport | null, signal?:AbortSignal, conversation?:{history:Array<{role:'user'|'assistant';text:string}>}): Promise<ResolvedBriefTurn> {
  if(signal?.aborted)throw new DOMException('已停止等待','AbortError');
  if (previous.pendingBasicFacts?.length) {
    if (/^(对|是|确认|没错|是的|好的|可以)$/.test(raw.trim())) {
      if (previous.pendingBasicFacts.some(fact => fact.requiresRestatement !== false)) {
        return { ...parseBriefTurn('', previous, { ...context, command: null }), kind: 'ask', text: basicQuestion(previous.pendingBasicFacts), resolution: 'confirmation' };
      }
      if (previous.pendingBasicFacts.some(fact => fact.key === 'headcount' && (typeof fact.value !== 'number' || !Number.isInteger(fact.value) || fact.value < 1 || fact.value > HEADCOUNT_MAX))) {
        return { ...parseBriefTurn('', previous, { ...context, command: null }), kind: 'ask', text: `人数需在 1 至 ${HEADCOUNT_MAX} 之间，请重新说明。`, resolution: 'confirmation' };
      }
      const pendingGeneration=previous.pendingGeneration;
      const memory = { ...previous, pendingBasicFacts: [], pendingGeneration:undefined };
      for (const fact of previous.pendingBasicFacts) {
        if (fact.key === 'event' && typeof fact.value === 'string') memory.event = fact.value;
        else if (fact.key === 'headcount' && typeof fact.value === 'number') { memory.headcount = fact.value; memory.headcountMode = null; }
        else if (fact.key === 'venueIO' && (fact.value === 'indoor' || fact.value === 'outdoor')) memory.venueIO = fact.value;
        else if (fact.key === 'lengthM' && typeof fact.value === 'number') memory.lengthM = fact.value;
        else if (fact.key === 'widthM' && typeof fact.value === 'number') memory.widthM = fact.value;
        else if (fact.key === 'areaM2' && typeof fact.value === 'number') memory.areaM2 = fact.value;
        else if (fact.key === 'layoutMode' && (fact.value === 'dining' || fact.value === 'desk-chair')) { memory.layoutMode = fact.value; memory.layoutModeUnresolved = false; memory.layoutModeConfirmed = true; }
      }
      const turn = parseBriefTurn('', memory, { ...context, command: pendingGeneration?.command??null });
      const time = previous.pendingBasicFacts.find(fact => fact.key === 'timeOfDay' && typeof fact.value === 'number');
      if (time && typeof time.value === 'number') turn.extraction.timeOfDay = time.value;
      if(previous.pendingBasicFacts.some(fact=>fact.key==='lengthM'||fact.key==='widthM'||fact.key==='areaM2')){
        turn.extraction.lengthM=memory.lengthM;turn.extraction.widthM=memory.widthM;turn.extraction.areaM2=memory.areaM2;
      }
      if(pendingGeneration)return {...turn,resolution:'confirmation',...(turn.kind==='generate'?{resumeInstruction:pendingGeneration.instruction}:{})};
      return { ...turn, kind: 'ack', text: '已记下你确认的信息；如有其他要求可以继续补充。', resolution: 'confirmation' };
    }
    if (/^(不对|不是|否)$/.test(raw.trim())) {
      const turn = parseBriefTurn('', { ...previous, pendingBasicFacts: [], pendingGeneration:undefined }, { ...context, command: null });
      return { ...turn, kind: 'ack', text: '这部分先不采用，请告诉我正确的信息。', resolution: 'confirmation' };
    }
    const layoutCommand = layoutGenerateCommand(raw);
    if (layoutCommand) {
      const absorbed = parseBriefTurn(raw, previous, { ...context, command: null });
      return { ...absorbed, kind: 'ask', text: basicQuestion(previous.pendingBasicFacts), memory: { ...absorbed.memory, pendingBasicFacts: previous.pendingBasicFacts, pendingGeneration: { command: layoutCommand, instruction: raw } }, resolution: 'confirmation' };
    }
    if (context.command) return { ...parseBriefTurn('', {...previous,pendingGeneration:undefined}, { ...context, command: null }), kind: 'ask', text: basicQuestion(previous.pendingBasicFacts), resolution: 'confirmation' };
  }
  if(previous.pendingGeneration)previous={...previous,pendingGeneration:undefined};
  if ((previous.mobilityNeedsClarification || previous.mobilityRequirement?.decision==='unknown') && !previous.pendingActivityNeeds.length && !previous.unresolvedActivityNeeds.length && isUnresolvedNeedsAnswer(raw)) return { ...parseBriefTurn(raw, previous, context), resolution: 'confirmation' };
  if ((previous.pendingActivityNeeds.length && isActivityNeedsAnswer(raw)) || (!previous.pendingActivityNeeds.length && previous.unresolvedActivityNeeds.length && isUnresolvedNeedsAnswer(raw))) {
    return { ...parseBriefTurn(raw, previous, context), resolution: 'confirmation' };
  }
  // Only a complete bare command may bypass the model: any additional wording
  // could carry new requirements and must still be interpreted normally.
  if (context.command && /^(?:请)?(?:出方案|生成方案|换一版|先探索|先用假设探索|(?:生成|制作|做|出)(?:一版)?(?:本地|本机)草案)[。！!]*$/.test(raw.trim())) {
    return { ...parseBriefTurn(raw, previous, context), resolution: 'local_command' };
  }
  let fallback: BriefResolution = modelEnabled() ? 'not_connected' : 'disabled';
  let modelNotice: string | undefined = modelEnabled() && !controller ? '智能理解服务未连接，本次使用本地规则理解；请核对结果。' : undefined;
  let modelDiagnostic: ModelCallDiagnostic | undefined = modelEnabled() && !controller ? {category:'config',code:'NOT_CONNECTED'} : undefined;
  if (modelEnabled() && controller) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const abort=new AbortController();let timedOut=false;
    let onCancel:(()=>void)|undefined;
    try {
      // 与服务端预算一致；超时取消本地请求，但供应商可能仍会计费。
      const cancelled=new Promise<never>((_resolve,reject)=>{onCancel=()=>{abort.abort();reject(new DOMException('已停止等待','AbortError'));};signal?.addEventListener('abort',onCancel,{once:true});if(signal?.aborted)onCancel();});
      const response = await Promise.race([
        conversation ? (controller.briefConversation ? controller.briefConversation(raw,conversation.history,abort.signal) : Promise.resolve({enabled:false,extraction:null})) : controller.briefExtract(raw,abort.signal),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => {timedOut=true;abort.abort();reject(new Error('brief extract timeout'));}, BRIEF_CLIENT_TIMEOUT_MS); }),
        cancelled,
      ]);
      if (response.enabled && response.extraction) {
        const { extraction, pending } = validateModelFacts(raw, sanitizeModelNeeds(raw,response.extraction));
        const turn = parseBriefTurn(raw, previous, context, toExtraction(extraction));
        const pendingFacts = [...(previous.pendingBasicFacts ?? []).filter(old => extraction[old.key] == null && !pending.some(fact => fact.key === old.key)), ...pending];
        const rawModelReply='reply' in response && typeof response.reply==='string'?response.reply:undefined;
        const modelReply=isGeneralActivityQuestion(raw)?rawModelReply:reconcileHeadcountReply(rawModelReply,turn.memory,pendingFacts);
        const beforeInventory=previous.reportedInventory??[],afterInventory=turn.memory.reportedInventory??[];
        const inventoryAdded=afterInventory.some(item=>!beforeInventory.some(old=>old.evidence===item.evidence));
        const inventoryChanged=JSON.stringify(beforeInventory)!==JSON.stringify(afterInventory);
        const inventoryUnrecorded=(extraction.inventoryMentions??[]).some(item=>!afterInventory.some(saved=>saved.evidence.includes(item.evidence)));
        const inventoryNotice=inventoryAdded?'已记下你提到的物料数量，规格和实际可用量尚未核验，暂未计入库存。'
          :inventoryChanged?'原物料口述有更正，需重新核对；暂未计入库存。'
          :inventoryUnrecorded?'这次物料数量尚未记入，请明确本场已有物料及数量；暂未计入库存。':undefined;
        const reply=[modelReply,inventoryNotice].filter(Boolean).join(' ')||undefined;
        const rawUnhandled='unhandled' in response && Array.isArray(response.unhandled) ? response.unhandled as BriefConversationResponse['unhandled'] : undefined;
        // The local command handler already owns this exact standalone action.
        // Never swallow a longer instruction, a question, or any other action.
        const localGeneration=context.command==='first'&&raw.split(/[，,；;。！!？?]/u).some(part=>part.trim()==='生成方案');
        const unhandled=omitHandledLayoutActions(raw, localGeneration?rawUnhandled?.filter(item=>!(item.kind==='action'&&item.evidence==='生成方案')):rawUnhandled);
        const materialQueries='materialQueries' in response && Array.isArray(response.materialQueries)?supportedMaterialQueries(raw,response.materialQueries as BriefConversationResponse['materialQueries']):[];
        const presentation={...(reply?{modelReply:reply}:{}),...(unhandled?{unhandled}:{}),...(materialQueries.length?{materialQueries}:{})};
        const hasNewFacts=Object.values(extraction).some(value=>value!==null&&value!==undefined&&(!Array.isArray(value)||value.length>0));
        if(reply&&!hasNewFacts&&isGeneralActivityQuestion(raw)&&!unhandled?.some(item=>item.kind==='action'))return {...turn,kind:'ack',text:reply,memory:previous,resolution:'model',readOnlyReply:true,...(unhandled?{unhandled}:{}),...(materialQueries.length?{materialQueries}:{})};
        // An explicit “not decided yet” is useful context. Keep pending facts
        // as unconfirmed, but don't immediately ask the user to decide them.
        const explicitlyDeferred=/(?:还没|尚未|暂未|未|没)(?:确定|决定|定下来|定)|待定|暂不清楚/.test(raw);
        const adviceOnlyRequested=raw.split(/[。！？!?]/u).some(part=>part.includes('建议')&&isReadOnlyAdviceBoundary(part.trim(),raw));
        if(conversation&&modelReply&&explicitlyDeferred&&pendingFacts.length>0&&pendingFacts.every(fact=>(fact.key==='headcount'&&fact.value==='待重新说明')||(fact.key==='event'&&fact.requiresRestatement===false))&&
          !turn.memory.pendingActivityNeeds.length&&!turn.memory.unresolvedActivityNeeds.length&&!turn.memory.mobilityNeedsClarification){
          return {...turn,kind:'ack',text:reply!,memory:{...turn.memory,askedScale:previous.askedScale,pendingBasicFacts:pendingFacts},resolution:'model',usesModelText:true,...(unhandled?{unhandled}:{}),...(materialQueries.length?{materialQueries}:{})};
        }
        if (pendingFacts.length) return { ...turn, kind: 'ask', text: basicQuestion(pendingFacts), memory: { ...turn.memory, pendingBasicFacts: pendingFacts,...(context.command&&!unhandled?.length?{pendingGeneration:{command:context.command,instruction:raw}}:{}) }, resolution: 'model', ...presentation };
        // A decision explicitly postponed by the user stays unknown; let the
        // model answer this discussion instead of repeating a generic prompt.
        // Advice can discuss additional unknowns without confirming them.
        // Pending confirmations and executable actions retain their review path.
        if(conversation&&modelReply&&explicitlyDeferred&&!context.command&&
          !unhandled?.some(item=>item.kind==='action'&&!isReadOnlyAdviceBoundary(item.evidence,raw))&&
          !turn.memory.pendingActivityNeeds.length&&turn.memory.unresolvedActivityNeeds.length>0&&
          (adviceOnlyRequested||turn.memory.unresolvedActivityNeeds.every(kind=>turn.memory.deferredActivityNeeds?.includes(kind)))&&
          !turn.memory.mobilityNeedsClarification&&!turn.memory.layoutModeUnresolved&&(turn.kind==='ack'||turn.kind==='ask')){
          return {...turn,kind:'ack',text:reply!,memory:{...turn.memory,askedScale:previous.askedScale,pendingBasicFacts:pendingFacts},resolution:'model',usesModelText:true,
            ...(unhandled?{unhandled}:{}),...(materialQueries.length?{materialQueries}:{})};
        }
        const changed=JSON.stringify({...turn.memory,askedScale:false})!==JSON.stringify({...previous,askedScale:false});
        if(reply&&!hasNewFacts&&!changed&&!pendingFacts.length&&!layoutGenerateCommand(raw))return {...turn,kind:'ack',text:reply,memory:previous,resolution:'model',readOnlyReply:true,...(unhandled?{unhandled}:{}),...(materialQueries.length?{materialQueries}:{})};
        // The model can discuss an early idea without forcing the user to supply
        // dimensions immediately. Preserve explicit unknowns and don't pretend the
        // model asked for a scale unless the deterministic prompt was actually shown.
        if(conversation&&modelReply&&turn.kind==='ask'&&turn.memory.askedScale&&!context.command&&
          !turn.memory.pendingActivityNeeds.length&&!turn.memory.unresolvedActivityNeeds.length&&!turn.memory.mobilityNeedsClarification&&!turn.memory.layoutModeUnresolved){
          return {...turn,text:reply!,memory:{...turn.memory,askedScale:previous.askedScale,pendingBasicFacts:pendingFacts},resolution:'model',usesModelText:true,...(unhandled?{unhandled}:{}),...(materialQueries.length?{materialQueries}:{})};
        }
        if(turn.kind==='none')return { ...turn, kind:'ask',text:'请先说明本场预计人数和场地尺寸；不确定的部分可以说明待定。',memory:{...turn.memory,pendingBasicFacts:pendingFacts},resolution:'model',...presentation };
        return { ...turn, memory: { ...turn.memory, pendingBasicFacts: pendingFacts }, resolution: 'model', ...presentation };
      }
      fallback = 'unavailable';
      const reason='reason' in response && typeof response.reason==='string'?response.reason:undefined;
      modelNotice = `${response.enabled ? modelFailureNotice(reason) : '智能理解服务尚未配置，请联系管理员。'} 本次使用本地规则理解，请核对结果。`;
      modelDiagnostic = providerDiagnostic(reason,response.enabled);
    } catch (error) {
      // 后端不可用/未登录/模型抖动/超时：落到规则版。保留分类，不把响应正文写进界面。
      if(signal?.aborted)throw new DOMException('已停止等待','AbortError');
      fallback = 'failed';
      const classified=thrownModelFailure(error,timedOut);
      modelNotice=classified.notice;
      modelDiagnostic=classified.diagnostic;
      if(process.env.NODE_ENV==='development')console.info('[brief]',classified.diagnostic.category,classified.diagnostic.code??'',classified.diagnostic.status??'');
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if(onCancel)signal?.removeEventListener('abort',onCancel);
    }
  }
  const local = parseBriefSentence(raw);
  // A prior event's attendance is not the current event's attendance. When
  // the user supplies a separate current clause, read the count from there.
  const history=/(?:上次|上一场|上届|去年|往年|以前|此前|之前|历史)/;
  if(history.test(raw)){
    const current=raw.split(/[，,；;。！!]/).filter(clause=>!history.test(clause));
    const counts=new Set(current.map(clause=>parseBriefSentence(clause).headcount).filter((value):value is number=>value!==null));
    if(counts.size===1)local.headcount=[...counts][0]!;
  }
  // Local event labels sometimes group different activities (e.g. lecture under salon).
  // Omit that inferred label rather than asking the user to confirm a false equivalence.
  if (local.event && !raw.includes(local.event)) local.event = null;
  const { extraction, pending } = validateModelFacts(raw, { event: local.event, headcount: local.headcount, venueIO: local.venueIO, lengthM: local.lengthM, widthM: local.widthM, areaM2: local.areaM2, timeOfDay: local.timeOfDay });
  // A failed live understanding request must not silently launch a second
  // provider call through the local command fallback.
  const allowAutomaticGeneration = fallback !== 'failed' && fallback !== 'unavailable';
  // A pure "please arrange it" follow-up has no new fact for a failed model to miss.
  // Keep drawing from the brief already on record instead of stopping at 没接住.
  const layoutOnly = isLayoutOnlyUtterance(raw);
  const fallbackContext = allowAutomaticGeneration || layoutOnly ? context : { ...context, command: null };
  const turn = parseBriefTurn(raw, previous, fallbackContext.command || !layoutOnly ? fallbackContext : { ...fallbackContext, command: layoutGenerateCommand(raw) }, toExtraction(extraction));
  const pendingFacts = [...(previous.pendingBasicFacts ?? []).filter(old => extraction[old.key] == null && !pending.some(fact => fact.key === old.key)), ...pending];
  if (pendingFacts.length) return { ...turn, kind: 'ask', text: basicQuestion(pendingFacts), memory: { ...turn.memory, pendingBasicFacts: pendingFacts,...((allowAutomaticGeneration||layoutOnly)&&(context.command||layoutGenerateCommand(raw))?{pendingGeneration:{command:(context.command??layoutGenerateCommand(raw))!,instruction:raw}}:{}) }, resolution: layoutOnly && !allowAutomaticGeneration ? 'local_command' : fallback, ...(modelNotice ? { modelNotice } : {}), ...(modelDiagnostic ? { modelDiagnostic } : {}) };
  if (!allowAutomaticGeneration && turn.kind === 'generate' && !layoutOnly) return { ...turn, kind:'ack', text:'已按本地规则记录可识别的信息；本次没有发起生成，请核对后重新提出。', memory:{...turn.memory,pendingGeneration:undefined}, resolution:fallback, ...(modelNotice ? { modelNotice } : {}), ...(modelDiagnostic ? { modelDiagnostic } : {}) };
  if (!allowAutomaticGeneration && layoutOnly && turn.kind === 'generate') return { ...turn, resolution: 'local_command', ...(modelNotice ? { modelNotice } : {}), ...(modelDiagnostic ? { modelDiagnostic } : {}) };
  return { ...turn, memory: { ...turn.memory, pendingBasicFacts: pendingFacts }, resolution: fallback, ...(modelNotice ? { modelNotice } : {}), ...(modelDiagnostic ? { modelDiagnostic } : {}) };
}

function basicQuestion(facts: PendingBasicFact[]): string {
  const labels: Record<PendingBasicFact['key'], string> = { event: '活动', headcount: '人数', venueIO: '室内外', lengthM: '场地长（米）', widthM: '场地宽（米）', areaM2: '面积（平方米）', timeOfDay: '时段（小时）', layoutMode: '布置方式' };
  const restate = facts.filter(fact => fact.requiresRestatement !== false);
  if (restate.length) {
    const names = [...new Set(restate.map(fact => fact.key === 'lengthM' || fact.key === 'widthM' ? '场地长宽（单位：米）' : fact.key === 'headcount' ? '本场人数' : labels[fact.key]))];
    return `刚才的${names.join('、')}无法确定，请重新说明；回复「确认」不能代替具体信息。`;
  }
  return `以下信息还需核对：${facts.map(fact => `${labels[fact.key]} ${fact.value === 'indoor' ? '室内' : fact.value === 'outdoor' ? '室外' : fact.value === 'desk-chair' ? '课桌椅' : fact.value === 'dining' ? '圆桌' : fact.value}`).join('、')}。这样对吗？回复「确认」或「不对」。`;
}

/** Quoted evidence is necessary but not sufficient: cropped negation and uncertainty stay unresolved. */
function sanitizeModelNeeds(raw:string,slots:BriefSlots):BriefSlots {
  if(!slots.activityNeeds)return slots;
  const clauses=raw.split(/[，,；;。！!]|但是|但|然而|不过/).map(value=>value.trim()).filter(Boolean);
  return {...slots,activityNeeds:slots.activityNeeds.map(need=>{
    const matched=clauses.filter(clause=>clause.includes(need.evidence));
    if(matched.length!==1)return {...need,decision:'unknown' as const};
    const clause=matched[0]!;
    const uncertain=/(不确定|不排除|并非|不是|没有说|没有表示|未提及|之前|此前|以前|历史|往年|上届|去年|上一场|上次|未必|不一定|可能|也许|或许|是否|要不要|需不需要|待定|没定|未定|尚未|还没|不知道|看情况|[吗么?？])/.test(clause);
    const negated=/(不需要|无需|不用|不要|不设|取消|没有)/.test(clause);
    if(uncertain || (need.decision==='needed'&&negated) || (need.decision==='not_needed'&&!negated))
      return {...need,decision:'unknown' as const,evidence:clause};
    return need;
  })};
}

/** Structured model output is a proposal; only unambiguous values supported by this turn are used directly. */
function validateModelFacts(raw: string, slots: BriefSlots): { extraction: BriefSlots; pending: PendingBasicFact[] } {
  const extraction: BriefSlots = { ...slots };
  const pending: PendingBasicFact[] = [];
  const clauses = raw.split(/[，,；;。！!]/);
  const history=/(?:上次|上一场|上届|去年|往年|以前|此前|之前|历史)/;
  const currentClauses=clauses.filter(clause=>!history.test(clause));
  const attendanceClauses=withoutNonTotalHeadcounts(currentClauses.join('，')).split(/[，,；;。！!]/);
  const keys = ['event', 'headcount', 'venueIO', 'lengthM', 'widthM', 'areaM2', 'timeOfDay'] as const;
  for (const key of keys) {
    const value = slots[key];
    if (value === undefined || value === null) continue;
    const evidenceClauses=key==='headcount'?attendanceClauses:currentClauses;
    const observed = new Set(evidenceClauses.flatMap(clause => {
      const parsed = parseBriefSentence(clause)[key];
      const count = key === 'headcount' ? chineseHeadcount(clause) : null;
      // A clause can contain multiple attendance figures even without commas.
      // Taking only the first number would silently treat “30人加40人” as 30.
      const allCounts=key==='headcount' ? [...clause.matchAll(/(\d{1,6}|[零〇一二两三四五六七八九十百千]+)\s*(?:人|位|名)/g)]
        .map(match=>/^\d+$/.test(match[1]!)?Number(match[1]):chineseHeadcount(match[0])) : [];
      return [parsed, count, ...allCounts].filter(item => item !== null && item !== undefined);
    }));
    const supported = evidenceClauses.some(clause => {
      if (observed.size > 1 || (key === 'headcount' && /(?:^|[^\d])[-−－]\s*\d+\s*(?:人|位|名)/.test(clause)) || /\d\s*[-~～至到]\s*\d/.test(clause) || /(?:不|没|无|否|可能|也许|或许|是否|待定|不知道|看情况|或|还是|大于|小于|超过|不到|至少|至多|最多|上限|以内|去年|上次|上一场|往年|此前|之前|以前|过去|历史|[?？])/.test(clause)) return false;
      if (/(?:厘米|公分|毫米|cm|mm|英尺|英寸|\b(?:inch(?:es)?|feet|ft|in)\b|\d\s*(?:in|ft)\b)/i.test(clause) && ['lengthM', 'widthM', 'areaM2'].includes(key)) return false;
      if ((key === 'lengthM' || key === 'widthM') && /(?:[×xX]\s*\d+(?:\.\d+)?\s*(?:m²|m2|平方米|平米|㎡))/i.test(clause)) return false;
      if (key === 'areaM2' && /\d\s*[×xX]\s*\d/.test(clause)) return false;
      const parsed = parseBriefSentence(clause);
      const count = key === 'headcount' ? chineseHeadcount(clause) : null;
      return key === 'event' ? clause.includes(String(value)) : parsed[key] === value || (key === 'headcount' && count === value);
    });
    // A count of objects is not evidence of attendance. Require a fresh
    // attendance statement instead of promoting it with a bare “确认”.
    const inventoryQuantity = key === 'headcount' && hasNonPersonQuantity(raw);
    const nonTotalPeople = key === 'headcount' && withoutNonTotalHeadcounts(raw) !== raw;
    if (!supported) { pending.push({ key, value, requiresRestatement: observed.size > 0 || inventoryQuantity || nonTotalPeople || history.test(raw) }); (extraction as Record<string, unknown>)[key] = null; }
  }
  // Empty model output must not let a previously confirmed number silently survive
  // an explicit uncertainty or conflicting statement about this event.
  if(slots.headcount == null && /(?:人数|\d+\s*(?:人|位|名))/.test(raw)
      && /(?:待定|未定|未确定|没确定|还没定|还没确定|不知道|不确定|不明|还是|或者|不是|不要|去年|上次|[?？])/.test(raw)) {
    pending.push({key:'headcount',value:'待重新说明',requiresRestatement:true});
  }
  if(slots.lengthM == null && slots.widthM == null && /\d\s*[×xX]\s*\d/.test(raw)
      && /(?:厘米|公分|毫米|cm|mm|英尺|英寸|inch(?:es)?|feet|ft)/i.test(raw)) {
    pending.push({key:'lengthM',value:'待重新说明',requiresRestatement:true});
  }
  if (slots.layoutMode) {
    const supported = clauses.some(clause => !/(不|没|无|取消|可能|也许|或|是否|待定|看情况|还是|上次|上一场|上届|去年|往年|以前|此前|之前|历史|[?？])/.test(clause)
      && (slots.layoutMode === 'dining' ? /圆桌|餐桌/.test(clause) : /课桌|课椅|一人一套|每人一套|桌.{0,6}配.{0,6}椅/.test(clause)));
    if (!supported) {
      const explicitlyUncertain = clauses.some(clause => /(?:圆桌|餐桌|课桌|课椅|一人一套|每人一套)/.test(clause) && /(不|没|无|取消|可能|也许|或|是否|待定|看情况|还是|上次|上一场|上届|去年|往年|以前|此前|之前|历史|[?？])/.test(clause));
      if (!explicitlyUncertain) pending.push({ key: 'layoutMode', value: slots.layoutMode, requiresRestatement: false });
      extraction.layoutMode = null;
    }
  }
  if (extraction.headcount != null && slots.requirements) extraction.requirements = slots.requirements.filter(requirement => requirement.key !== 'headcount' || requirement.mode !== 'must' || clauses.some(clause => /必须|一定要|确保|保证|只能|务必|硬性/.test(clause) && !/左右|大概|约|尽量|建议|最好/.test(clause) && (parseBriefSentence(clause).headcount === extraction.headcount || chineseHeadcount(clause) === extraction.headcount)));
  return { extraction, pending };
}

function chineseHeadcount(clause: string): number | null {
  const match = withoutNonTotalHeadcounts(clause).match(/([零〇一二两三四五六七八九十百千]+)(?:人|位|名)/);
  if (!match) return null;
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let result = 0, digit = 0;
  for (const char of match[1]!) {
    if (char in digits) digit = digits[char]!;
    else { const unit = char === '十' ? 10 : char === '百' ? 100 : 1000; result += (digit || 1) * unit; digit = 0; }
  }
  return result + digit;
}

/** 后端槽位 → 前端 BriefExtraction（layoutMode 走独立通道进记忆槽）。 */
function toExtraction(slot: BriefSlots): BriefExtraction & { layoutMode: LayoutMode | null; inventoryMentions?:Array<{evidence:string}> | null } {
  return {
    event: slot.event ?? null,
    headcount: slot.headcount ?? null,
    venueIO: slot.venueIO ?? null,
    lengthM: slot.lengthM ?? null,
    widthM: slot.widthM ?? null,
    areaM2: slot.areaM2 ?? null,
    timeOfDay: slot.timeOfDay ?? null,
    layoutMode: slot.layoutMode ?? null,
    // 推理层新字段原样透传：audienceTags 留空数组/缺省都不影响本地正则兜底；
    // mobilityAssistance 是布尔判定，前端 buildAudiencePrompt 据此走三档（轮椅硬建议/elderly 确认式问句/常规）；
    // proactiveReply 是一次性回话文案，前端 brief-agent 优先展示、null 时回退正则 buildAudiencePrompt。
    ...(slot.audienceTags && slot.audienceTags.length > 0 ? { audienceTags: slot.audienceTags } : {}),
    ...(slot.mobilityAssistance !== undefined && slot.mobilityAssistance !== null ? { mobilityAssistance: slot.mobilityAssistance } : {}),
    ...(slot.proactiveReply !== undefined ? { proactiveReply: slot.proactiveReply } : {}),
    ...(slot.requirements ? { requirements: slot.requirements } : {}),
    ...(slot.activityNeeds ? { activityNeeds: slot.activityNeeds } : {}),
    ...(slot.inventoryMentions ? { inventoryMentions: slot.inventoryMentions } : {}),
  };
}
