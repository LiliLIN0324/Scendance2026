/**
 * Unit-gate preview. All numbers below come from the real `_shared/units.ts` — this server calls
 * `collectRecognizedSamples`, `detectPlanUnit`, `explainUnitFit`, `normalizeRecognizedUnits` and
 * `isPlausiblePlanScale` directly, so the page cannot drift from what the pipeline does.
 *
 *   npm run preview:units        # http://127.0.0.1:3031
 *
 * Stdlib only. No build step, no dependency, no external request.
 */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {
  collectRecognizedSamples,detectPlanUnit,explainUnitFit,isPlausiblePlanScale,normalizeRecognizedUnits,
  METRE_BANDS,METRES_PER_UNIT,PLAN_UNITS,PLAUSIBLE_PLAN_SCALE,
} from '../../supabase/functions/_shared/units.ts';
import type {LengthUnit,SampleKind} from '../../supabase/functions/_shared/units.ts';

type RawScene={schemaVersion:number;venue:Record<string,number|string|unknown[]>;structure:{walls:unknown[];openings:unknown[];columns:unknown[]};objects:unknown[];dimensions:unknown[]};

/** A closed rectangular venue with one door — enough kinds of measurement to decide a unit. */
const plan=(width:number,depth:number,thickness:number,height:number,door:number,walls=true):RawScene=>({
  schemaVersion:2,
  venue:{shape:'rectangle',width,depth,height,entrances:[]},
  structure:{walls:walls?[[[0,0],[width,0]],[[width,0],[width,depth]],[[width,depth],[0,depth]],[[0,depth],[0,0]]].map(([start,end],index)=>({id:`w${index}`,start:{x:start[0],z:start[1]},end:{x:end[0],z:end[1]},thickness,height,kind:'exterior',status:'detected'})):[],openings:walls?[{id:'o0',wallId:'w0',kind:'door',offset:2,width:door,height:height*0.7,sillHeight:0,status:'detected'}]:[],columns:[]},
  objects:[],dimensions:[],
});

interface Scenario{id:string;title:string;note:string;labels:{text:string;kind:SampleKind}[];scene:RawScene;hint:LengthUnit|null;confirmed?:number}

const scenarios:Scenario[]=[
  {id:'mm',title:'毫米图纸（最常见）',note:'中文施工图按毫米标注，模型照抄 12000。不换算就会被契约直接拒绝。',labels:[{text:'12000 × 8000（外框）',kind:'plan'},{text:'200（墙厚）',kind:'thickness'},{text:'3000（层高）',kind:'height'},{text:'1000（门洞）',kind:'opening'}],scene:plan(12000,8000,200,3000,1000),hint:'mm'},
  {id:'cm',title:'厘米图纸',note:'少数图纸用厘米。厘米不是"毫米的一半精度"，是另一个单位，必须能认出来。',labels:[{text:'1200 × 800',kind:'plan'},{text:'20（墙厚）',kind:'thickness'},{text:'300（层高）',kind:'height'},{text:'100（门洞）',kind:'opening'}],scene:plan(1200,800,20,300,100),hint:null},
  {id:'m',title:'米制图纸',note:'本来就对，闸门必须什么都不做（applied=false），不能画蛇添足。',labels:[{text:'12 × 8',kind:'plan'},{text:'0.2（墙厚）',kind:'thickness'},{text:'3（层高）',kind:'height'},{text:'1（门洞）',kind:'opening'}],scene:plan(12,8,0.2,3,1),hint:'m'},
  {id:'ambiguous',title:'只有外框尺寸 → 报歧义',note:'12000 当毫米是 12 m，当厘米是 120 m，两者都合理。这时必须问人，不能猜。',labels:[{text:'12000 × 8000（只有外框）',kind:'plan'}],scene:plan(12000,8000,0,3000,0,false),hint:null},
  {id:'implausible',title:'确认值与识别差 1000 倍 → 拒绝缩放',note:'场景已识别为 12 m，用户却确认 12000 m。旧逻辑会把整个场地缩放 1000 倍；现在报 SCALE_IMPLAUSIBLE。',labels:[{text:'12 × 8（已识别）',kind:'plan'},{text:'12000（用户确认）',kind:'plan'}],scene:plan(12,8,0.2,3,1),hint:'m',confirmed:12000},
];

const metres=1.7,football=105; // human height and a football pitch length, as everyday scale anchors

/** Four identical walls would print four identical rows; the sample count is reported separately. */
const dedupe=(rows:ReturnType<typeof explainUnitFit>)=>rows.filter((row,index)=>rows.findIndex(other=>other.kind===row.kind&&other.value===row.value)===index);

const payload=()=>({
  metresPerUnit:METRES_PER_UNIT,bands:METRE_BANDS,planUnits:PLAN_UNITS,plausible:PLAUSIBLE_PLAN_SCALE,human:metres,football,
  scenarios:scenarios.map(scenario=>{
    const samples=collectRecognizedSamples(scenario.scene as unknown as Record<string,unknown>);
    const detection=detectPlanUnit(samples,scenario.hint);
    const {value,report}=normalizeRecognizedUnits({scene:scenario.scene},scenario.hint);
    const afterScene=((report.applied?value:{scene:scenario.scene}) as {scene:RawScene}).scene;
    const recognised:number=Number(scenario.scene.venue.width);
    const factor=scenario.confirmed===undefined?detection.factor:scenario.confirmed/recognised;
    return {
      ...scenario,scene:undefined,
      fit:dedupe(explainUnitFit(samples)),samples:samples.length,detection,report,
      before:{width:Number(scenario.scene.venue.width),depth:Number(scenario.scene.venue.depth)},
      after:{width:Number(afterScene.venue.width),depth:Number(afterScene.venue.depth),height:Number(afterScene.venue.height)},
      openings:afterScene.structure.openings.map(opening=>Number((opening as {width:number}).width)),
      guard:scenario.confirmed===undefined?null:{confirmed:scenario.confirmed,recognised,factor,plausible:isPlausiblePlanScale(factor),code:'SCALE_IMPLAUSIBLE'},
    };
  }),
});

const port=Number(process.env.SCENDANCE_PREVIEW_PORT??3031);
createServer(async(request,response)=>{
  const url=new URL(request.url??'/',`http://127.0.0.1:${port}`);
  try{
    if(url.pathname==='/data.json')return void response.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}).end(JSON.stringify(payload()));
    if(url.pathname==='/'||url.pathname==='/index.html')return void response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}).end(await readFile(join(import.meta.dirname,'index.html')));
    response.writeHead(404).end('not found');
  }catch(error){response.writeHead(500).end(String(error));}
}).listen(port,'127.0.0.1',()=>console.log(`单位闸门预览：http://127.0.0.1:${port}\n数据来自 supabase/functions/_shared/units.ts（未复制逻辑）`));
