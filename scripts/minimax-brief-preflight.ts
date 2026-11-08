/** Offline-only review of the shape of one synthetic brief request. Never reads secrets or calls a provider. */
import {BRIEF_EXTRACT_PROMPT, BRIEF_PROVIDER_TIMEOUT_MS, BRIEF_CLIENT_TIMEOUT_MS} from '../supabase/functions/_shared/brief-extract-contract.ts';
import {chatRequest} from '../supabase/functions/_shared/providers.ts';
import {sha256} from '../supabase/functions/_shared/domain.ts';

const SYNTHETIC_MESSAGE='为长者办一场讲座，预计 30 人，室内，签到和舞台尚未决定。';
/** Uses fixture-only endpoint/model/key; hashes identify this fixture, not a configured provider request. */
export async function minimaxBriefPreflight() {
  const fixtures:Record<string,string>={AGENT_CHAT_BASE_URL:'https://fixture.invalid/v1',AGENT_CHAT_KEY:'fixture-only-not-a-secret',AGENT_CHAT_MODEL:'fixture-model',AGENT_CHAT_PROFILE:'minimax'};
  const built=chatRequest(key=>fixtures[key],{messages:[{role:'system',content:BRIEF_EXTRACT_PROMPT},{role:'user',content:SYNTHETIC_MESSAGE}],temperature:0,max_tokens:2048,response_format:{type:'json_object'}},{purpose:'brief'});
  const body=String(built.init.body),parsed=JSON.parse(body) as Record<string,unknown>;
  return {mode:'offline-only',requestsSent:0,sampleCount:1,sampleKind:'synthetic',messagesSent:['system prompt','one synthetic user message'],
    excludes:['real customer content','images','floorplans','scene data','conversation history'],
    profile:'minimax',fixtureModel:true,bodyFields:Object.keys(parsed).sort(),outputTokenParameter:parsed.max_tokens,
    providerTimeoutMs:BRIEF_PROVIDER_TIMEOUT_MS,clientTimeoutMs:BRIEF_CLIENT_TIMEOUT_MS,
    syntheticMessageSha256:await sha256(SYNTHETIC_MESSAGE),systemPromptSha256:await sha256(BRIEF_EXTRACT_PROMPT),fixtureBodySha256:await sha256(body),
    safeguards:'No provider-account cap, actual token bound, deployed idempotency or shared rate limit is verified by this dry run.'};
}
