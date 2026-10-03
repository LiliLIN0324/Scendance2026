import { reconstructionJobSchema, type ReconstructionRequest } from '../supabase/functions/_shared/reconstruction-contract.ts';
import { sceneHash, type SourceImage, type Scene } from '../supabase/functions/_shared/domain.ts';

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
  if(proposal.project_id!==current.projectId || proposal.session_id!==current.sessionId || proposal.generation!==current.generation || proposal.base_revision!==current.expectedRevision || proposal.local_revision!==current.localRevision || proposal.applied_at || Date.parse(proposal.expires_at)<=Date.now() || proposal.base_hash!==await sceneHash(current.scene)) throw new SceneApiError('STALE_PROPOSAL',409,null);
}
export function createSceneClient(baseUrl:string,getAccessToken:()=>Promise<string|null>) {
  async function request<T>(path:string,method='GET',body?:unknown,isPublic=false):Promise<T> {
    const headers:Record<string,string>={};
    if(!isPublic) {const token=await getAccessToken();if(!token)throw new SceneApiError('UNAUTHENTICATED',401,null);headers.Authorization=`Bearer ${token}`;}
    const multipart=body instanceof FormData;
    if(body!==undefined&&!multipart) headers['Content-Type']='application/json';
    const response=await fetch(`${baseUrl.replace(/\/$/,'')}${path}`,{method,headers,...(body===undefined?{}:{body:multipart?body as FormData:JSON.stringify(body)}),cache:'no-store'});
    const data=await response.json();
    if(!response.ok) throw new SceneApiError(data.error?.code??'HTTP_ERROR',response.status,data.error?.details);
    return data as T;
  }
  return {
    request,
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
  };
}
