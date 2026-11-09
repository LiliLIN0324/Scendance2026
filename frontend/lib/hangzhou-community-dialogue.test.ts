import {afterEach,describe,expect,it,vi} from 'vitest';
import {parseBriefConversation,briefConversationResponseSchema} from '../../supabase/functions/_shared/brief-extract-contract';
import {initialBriefMemory} from '@/components/room-organizer/lib/brief-agent';
import {resolveBriefTurn} from './agent-resolver';

// Synthetic provider response for a user-supplied scenario. The institution,
// partnership, exact location and event are not independently verified.
const opening='我想和杭州西湖的养老社区商议一场创作体验，人数、具体场地、档期和物料都还没定，有什么方向？';
const followup='预计30人，现有80把椅子';
const context={venueUp:false,scaleTyped:false,hasBase:false,command:null} as const;
const responses=[
 {extraction:{event:'创作体验'},reply:'可以先讨论两个方向：纸艺绘画共创，或以故事为主题的手作分享。合作和具体条件都还要商议；如果暂时没有场地资料，也可以明确采用假设探索。',unhandled:[{kind:'other',evidence:'和杭州西湖的养老社区商议'}],factEvidence:[{key:'event',evidence:'创作体验'}]},
 {extraction:{headcount:30,inventoryMentions:[{evidence:'80把椅子'}]},reply:'先按约30位参与者讨论，椅子的规格和可用性还需核对。',unhandled:[],factEvidence:[{key:'headcount',evidence:'30人'}]},
];
afterEach(()=>vi.unstubAllEnvs());

describe('杭州社区创作体验：不完整资料的合成验收',()=>{
 it('offers two directions without promoting a proposed partnership or missing venue to facts; keeps people and materials separate',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');let n=0;
  const transport={briefExtract:vi.fn(async()=>({enabled:false,extraction:null})),briefConversation:vi.fn(async(message:string)=>{
   const parsed=parseBriefConversation(responses[n++]!,message);
   return briefConversationResponseSchema.parse({enabled:true,...parsed});
  })};
  const first=await resolveBriefTurn(opening,initialBriefMemory(),context,transport,undefined,{history:[]});
  expect(transport.briefConversation).toHaveBeenCalledOnce();expect(transport.briefExtract).not.toHaveBeenCalled();
  expect(first.text).toContain('纸艺绘画共创');expect(first.text).toContain('故事为主题的手作分享');expect(first.text).toContain('假设探索');
  expect(first.text).not.toMatch(/(?:已确定合作|场地已定|已预订|请先说明.*人数.*尺寸)/);
  expect(first.unhandled).toEqual([{kind:'other',evidence:'和杭州西湖的养老社区商议'}]);
  expect(first.memory.headcount).toBeNull();expect(first.memory.lengthM).toBeNull();expect(first.memory.widthM).toBeNull();expect(first.memory.areaM2).toBeNull();expect(first.memory.venueIO).toBeNull();
  expect(first.memory.reportedInventory).toBeUndefined();expect(first.kind).not.toBe('generate');
  const second=await resolveBriefTurn(followup,first.memory,context,transport,undefined,{history:[{role:'user',text:opening}]});
  expect(transport.briefConversation).toHaveBeenCalledTimes(2);expect(second.memory.headcount).toBe(30);
  expect(second.memory.reportedInventory).toEqual([{evidence:'现有80把椅子',status:'reported'}]);expect(second.text).toContain('暂未计入库存');
  expect(second.memory.lengthM).toBeNull();expect(second.kind).not.toBe('generate');
 });
 it('rejects a fabricated indoor venue as an unsupported model fact',()=>{
  const invented={...responses[0]!,extraction:{event:'创作体验',venueIO:'indoor'},factEvidence:[{key:'event',evidence:'创作体验'},{key:'venueIO',evidence:'室内'}]};
  expect(()=>parseBriefConversation(invented,opening)).toThrow('MODEL_EVIDENCE_MISMATCH');
 });
});
