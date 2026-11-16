import { reconstructionJobSchema, type ReconstructionRequest } from '../supabase/functions/_shared/reconstruction-contract';
import { canonical, sceneHash, sha256, uuid, type SourceImage, type Scene } from '../supabase/functions/_shared/domain';
import { activityTaskRunRequestSchema, activityTaskRunSchema, type ActivityTaskRunRequest, type ActivityTaskRun } from '../supabase/functions/_shared/activity-task-contract';

export class SceneApiError extends Error {
  constructor(public code:string,public status:number,public details:unknown) {super(code);}
}
export interface EditorState {
  projectId:string;sessionId:string;generation:number;expectedRevision:number;localRevision:number;scene:Scene;
}
export interface Proposal {
  id:string;project_id:string;session_id:string;generation:number;base_revision:number;local_revision:number;
  base_hash:string;candidate:Scene;expires_at:string;applied_at:string|null;
}
export async function assertFreshProposal(proposal:Proposal,current:EditorState) {
  const expiresAt=Date.parse(proposal.expires_at);
  if(proposal.project_id!==current.projectId || proposal.session_id!==current.sessionId || proposal.generation!==current.generation || proposal.base_revision!==current.expectedRevision || proposal.local_revision!==current.localRevision || proposal.applied_at || !Number.isFinite(expiresAt) || expiresAt<=Date.now() || proposal.base_hash!==await sceneHash(current.scene)) throw new SceneApiError('STALE_PROPOSAL',409,null);
}
export function createSceneClient(baseUrl:string,getAccessToken:()=>Promise<string|null>) {
  const endpoint=(path:string)=>`${baseUrl.replace(/\/$/,'')}${path}`;
  /**
   * Minimal `text/event-stream` reader. Frames are delivered in order; a
   * malformed frame is the caller's problem to classify, not silently dropped.
   */
  async function readSse(response:Response,onFrame:(event:string,data:string)=>void):Promise<void> {
    const reader=response.body?.getReader();
    if(!reader)throw new SceneApiError('EMPTY_BODY',502,null);
    const decoder=new TextDecoder();let buffer='';
    try {
      while(true) {
        const {value,done}=await reader.read();if(done)break;
        buffer+=decoder.decode(value,{stream:true});
        let index:number;
        while((index=buffer.indexOf('\n\n'))>=0) {
          const chunk=buffer.slice(0,index);buffer=buffer.slice(index+2);
          let event='message';const data:string[]=[];
          for(const raw of chunk.split('\n')) {
            const line=raw.replace(/\r$/,'');
            if(line.startsWith('event:'))event=line.slice(6).trim();
            else if(line.startsWith('data:'))data.push(line.slice(5).trim());
          }
          if(data.length)onFrame(event,data.join('\n'));
        }
      }
    } finally { await reader.cancel().catch(()=>{}); }
  }
  /** Open a streaming response with the same auth/CORS shape as `request`. */
  async function openStream(path:string,init:Omit<RequestInit,'headers'>,signal?:AbortSignal):Promise<Response> {
    const token=await getAccessToken();
    if(!token)throw new SceneApiError('UNAUTHENTICATED',401,null);
    let response:Response;
    try { response=await fetch(endpoint(path),{...init,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(signal?{signal}:{}),cache:'no-store'}); }
    catch(error) {
      if(error instanceof Error&&error.name==='AbortError')throw error;
      throw new SceneApiError('NETWORK_ERROR',0,{category:'network'});
    }
    const streaming=response.headers.get('content-type')?.includes('text/event-stream')??false;
    if(!response.ok||!streaming) {
      await response.body?.cancel().catch(()=>{});
      // 404/405/non-SSE means an older deployment: callers fall back to polling/JSON.
      throw new SceneApiError(streaming?'HTTP_ERROR':'STREAM_UNAVAILABLE',response.status,{category:'stream'});
    }
    return response;
  }
  async function request<T>(path:string,method='GET',body?:unknown,isPublic=false,signal?:AbortSignal,beforeDispatch?:()=>void,classifyTransport=false):Promise<T> {
    const headers:Record<string,string>={};
    if(!isPublic) {const token=await getAccessToken();if(!token)throw new SceneApiError('UNAUTHENTICATED',401,null);headers.Authorization=`Bearer ${token}`;}
    const multipart=body instanceof FormData;
    if(body!==undefined&&!multipart) headers['Content-Type']='application/json';
    const payload=body===undefined?undefined:multipart?body as FormData:JSON.stringify(body);
    beforeDispatch?.();
    let response:Response;
    try {
      response=await fetch(`${baseUrl.replace(/\/$/,'')}${path}`,{method,headers,...(payload===undefined?{}:{body:payload}),...(signal?{signal}:{}),cache:'no-store'});
    } catch (error) {
      // Scene writes keep the original transport error so an uncertain POST can be recovered by GET.
      // Only the read-only conversation call classifies a network failure, and it does not keep the message.
      if(!classifyTransport||(error instanceof Error&&error.name==='AbortError'))throw error;
      throw new SceneApiError('NETWORK_ERROR',0,{category:'network'});
    }
    // Keep the HTTP status when the body is empty or not JSON. A parse failure
    // must not become an untyped exception that drops 401/502/503.
    let data:unknown;
    try { data=await response.json(); }
    catch(error) {
      if(typeof error==='object'&&error!==null&&'name' in error&&(error as {name?:string}).name==='AbortError') throw error;
      throw new SceneApiError(response.ok?'INVALID_RESPONSE':classifyTransport?'NON_JSON_RESPONSE':'HTTP_ERROR',response.status,classifyTransport?{category:'non_json'}:null);
    }
    if(!response.ok) {
      const error=data&&typeof data==='object'&&'error' in data?(data as {error?:{code?:unknown;details?:unknown}}).error:undefined;
      const code=error&&typeof error==='object'&&typeof error.code==='string'?error.code:'HTTP_ERROR';
      throw new SceneApiError(code,response.status,error&&typeof error==='object'?error.details??null:null);
    }
    return data as T;
  }
  function activityResponse(data:unknown,expected:{projectId:string;id?:string;requestId?:string;activityId?:string;contextHash?:string;cancelled?:boolean}):ActivityTaskRun {
    const parsed=activityTaskRunSchema.safeParse(data),same=(left:string,right:string)=>left.toLowerCase()===right.toLowerCase();
    if(!parsed.success)throw new SceneApiError('INVALID_RESPONSE',502,null);
    const run=parsed.data;
    if(!same(run.projectId,expected.projectId)||(expected.id!==undefined&&!same(run.id,expected.id))
      ||(expected.requestId!==undefined&&!same(run.requestId,expected.requestId))
      ||(expected.activityId!==undefined&&run.activityId!==expected.activityId)
      ||(expected.contextHash!==undefined&&run.contextHash!==expected.contextHash)
      ||(expected.cancelled&&run.state!=='cancelled'))throw new SceneApiError('INVALID_RESPONSE',502,null);
    return run;
  }
  return {
    request,
    /** The caller records this request ID before dispatch; an uncertain POST is recovered only by GET. */
    async startActivityTaskRun(projectId:string,input:ActivityTaskRunRequest,beforeDispatch?:()=>void):Promise<ActivityTaskRun> {
      const remoteId=uuid.parse(projectId),body=activityTaskRunRequestSchema.parse(input);
      const contextHash=await sha256(canonical(body.activityContext));
      return activityResponse(await request(`/projects/${remoteId}/agent-runs`,'POST',body,false,undefined,beforeDispatch),{
        projectId:remoteId,requestId:body.requestId,activityId:body.activityContext.projectId,contextHash,
      });
    },
    async getActivityTaskRun(projectId:string,id:string,beforeDispatch?:()=>void):Promise<ActivityTaskRun> {
      const remoteId=uuid.parse(projectId),runId=uuid.parse(id);
      return activityResponse(await request(`/projects/${remoteId}/agent-runs/${runId}`,'GET',undefined,false,undefined,beforeDispatch),{projectId:remoteId,id:runId});
    },
    async getActivityTaskRunByRequest(projectId:string,requestId:string,beforeDispatch?:()=>void):Promise<ActivityTaskRun> {
      const remoteId=uuid.parse(projectId),requestKey=uuid.parse(requestId);
      return activityResponse(await request(`/projects/${remoteId}/agent-runs/by-request/${requestKey}`,'GET',undefined,false,undefined,beforeDispatch),{projectId:remoteId,requestId:requestKey});
    },
    async cancelActivityTaskRun(projectId:string,id:string,beforeDispatch?:()=>void):Promise<ActivityTaskRun> {
      const remoteId=uuid.parse(projectId),runId=uuid.parse(id);
      return activityResponse(await request(`/projects/${remoteId}/agent-runs/${runId}/cancel`,'POST',undefined,false,undefined,beforeDispatch),{projectId:remoteId,id:runId,cancelled:true});
    },
    listSources(projectId:string){return request<SourceImage[]>(`/projects/${projectId}/sources`);},
    uploadSource(projectId:string,file:File,kind:SourceImage['kind']){const body=new FormData();body.set('projectId',projectId);body.set('file',file);body.set('kind',kind);return request<SourceImage>('/assets/sources','POST',body);},
    removeSource(projectId:string,assetId:string){return request<{removed:true}>(`/projects/${projectId}/sources/${assetId}`,'DELETE');},
    async createReconstruction(projectId:string,input:ReconstructionRequest){return reconstructionJobSchema.parse(await request(`/projects/${projectId}/reconstructions`,'POST',input));},
    async getReconstruction(projectId:string,id:string){return reconstructionJobSchema.parse(await request(`/projects/${projectId}/reconstructions/${id}`));},
    async applyProposal(proposal:Proposal,current:EditorState) {
      await assertFreshProposal(proposal,current);
      return request<{id:string;revision:number;scene:Scene;previousScene:Scene;undoGroup:string}>(`/projects/${current.projectId}/proposals/apply`,'POST',{
        proposalId:proposal.id,sessionId:current.sessionId,generation:current.generation,expectedRevision:current.expectedRevision,
        localRevision:current.localRevision,currentScene:current.scene,
      });
    },
    restoreProposal(proposal:Proposal,current:EditorState){return request<{id:string;revision:number;scene:Scene;previousScene:Scene;undoGroup:string}>(`/projects/${current.projectId}/history/restore`,'POST',{sessionId:current.sessionId,generation:current.generation,expectedRevision:current.expectedRevision,proposalId:proposal.id,currentScene:current.scene});},
    readShare(token:string) {return request('/share/read','POST',{token},true);},
    /**
     * Streamed read-only answer. `onDelta` receives visible content only; a
     * done frame carries the final status and the full answer text.
     */
    async streamAssistantChat(body:unknown,onDelta:(text:string)=>void,signal?:AbortSignal,eventType:'delta'|'thought'='delta'):Promise<{status:string;answer:string|null}> {
      const response=await openStream('/assistant/chat/stream',{method:'POST',body:JSON.stringify(body)},signal);
      let answer='',status='provider_error';
      await readSse(response,(event,data)=>{
        let parsed:unknown;
        try { parsed=JSON.parse(data); } catch { throw new SceneApiError('INVALID_RESPONSE',502,null); }
        const frame=parsed&&typeof parsed==='object'?parsed as Record<string,unknown>:{};
        if(event===eventType) {
          const text=typeof frame.text==='string'?frame.text:'';
          if(text){
            if(eventType==='delta')answer+=text;
            onDelta(text);
          }
        } else if(event==='done') {
          status=typeof frame.status==='string'?frame.status:'provider_error';
          if(typeof frame.answer==='string')answer=frame.answer;
        } else if(event==='error') {
          status='provider_error';
        }
      });
      return {status,answer:answer||null};
    },
    /** Streamed run frames (tool receipts + visible self-reports), paginated by cursor. */
    async streamAgentRunEvents(projectId:string,runId:string,after:number,onPage:(page:unknown)=>void,signal?:AbortSignal):Promise<'done'|'ended'> {
      const response=await openStream(`/projects/${uuid.parse(projectId)}/agent-runs/${uuid.parse(runId)}/events/stream?after=${after}`,{method:'GET'},signal);
      let ending:'done'|'ended'='ended';
      await readSse(response,(event,data)=>{
        let parsed:unknown;
        try { parsed=JSON.parse(data); } catch { throw new SceneApiError('INVALID_RESPONSE',502,null); }
        if(event==='page')onPage(parsed);
        else if(event==='done') {
          const state=parsed&&typeof parsed==='object'&&typeof (parsed as {state?:unknown}).state==='string'?(parsed as {state:string}).state:'';
          if(state&&state!=='stream-ended')ending='done';
        } else if(event==='error') throw new SceneApiError('STREAM_FAILED',502,null);
      });
      return ending;
    },
  };
}
