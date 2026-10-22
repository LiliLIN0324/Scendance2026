import {describe,it,expect} from 'vitest';
import {detectPlanUnit,explainUnitFit,isPlausiblePlanScale,normalizeRecognizedUnits,parseLength,scaleRecognizedScene,unitFromText,METRE_BANDS,PLAN_UNITS,PLAUSIBLE_PLAN_SCALE,type ScaleSample} from '../supabase/functions/_shared/units.ts';
import {sceneV2Schema} from '../supabase/functions/_shared/domain.ts';

const p=(x:number,z:number)=>({x,z});
/** A closed 12 × 10 × 3 m single-storey venue with four exterior walls and one plan dimension. */
const metreScene=()=>sceneV2Schema.parse({
  schemaVersion:2,
  venue:{shape:'rectangle',width:12,depth:10,height:3,entrances:[]},
  objects:[],camera:'overview',lighting:'neutral',
  structure:{walls:[[p(0,0),p(12,0)],[p(12,0),p(12,10)],[p(12,10),p(0,10)],[p(0,10),p(0,0)]].map(([start,end])=>({id:crypto.randomUUID(),start,end,thickness:0.2,height:3,kind:'exterior' as const,status:'detected' as const})),openings:[],columns:[]},
  sources:[],dimensions:[],
});
const samples=(list:readonly [number,ScaleSample['kind']][]):ScaleSample[]=>list.map(([value,kind])=>({value,kind}));

describe('length parsing',()=>{
  it('converts a stated unit and leaves a bare number unconverted',()=>{
    expect(parseLength('7200mm')).toMatchObject({metres:7.2,unit:'mm'});
    expect(parseLength('7200 mm')).toMatchObject({metres:7.2,unit:'mm'});
    expect(parseLength('720 厘米')).toMatchObject({metres:7.2,unit:'cm'});
    expect(parseLength('7.2m')).toMatchObject({metres:7.2,unit:'m'});
    expect(parseLength('7.2 米')).toMatchObject({metres:7.2,unit:'m'});
    expect(parseLength('1,200 mm')).toMatchObject({metres:1.2,unit:'mm'});
    // A bare number keeps its magnitude; only the plan-unit decision may scale it.
    expect(parseLength('7200')).toMatchObject({metres:7200,unit:'unitless'});
  });
  it('reads full-width digits and imperial notation',()=>{
    expect(parseLength('８.５米')).toMatchObject({metres:8.5,unit:'m'});
    expect(parseLength('8\'6"')?.metres).toBeCloseTo(2.5908,4);
    expect(parseLength('3 英尺')?.metres).toBeCloseTo(0.9144,4);
    expect(parseLength('3 英尺')?.unit).toBe('ft');
    expect(parseLength('12英寸')?.metres).toBeCloseTo(0.3048,4);
  });
  it('refuses text that is not a length instead of guessing',()=>{
    for(const text of ['','宽 7200','7200 尺','约 7 米','7.2m²'])expect(parseLength(text)).toBeNull();
  });
  it('maps a declared unit token',()=>{
    expect(unitFromText('mm')).toBe('mm');expect(unitFromText('毫米')).toBe('mm');
    expect(unitFromText(' ft ')).toBe('ft');expect(unitFromText('厘米')).toBe('cm');
    expect(unitFromText('尺')).toBeNull();
  });
});

describe('plan unit detection',()=>{
  it('picks the only unit that keeps every structural length inside its metre band',()=>{
    const mm=samples([[12000,'plan'],[8000,'plan'],[12000,'wall'],[200,'thickness'],[3000,'height'],[1000,'opening']]);
    expect(detectPlanUnit(mm)).toMatchObject({unit:'mm',factor:0.001,confidence:'unique'});
    const metres=samples([[12,'plan'],[8,'plan'],[12,'wall'],[0.2,'thickness'],[3,'height'],[1,'opening']]);
    expect(detectPlanUnit(metres)).toMatchObject({unit:'m',factor:1,confidence:'unique'});
  });
  it('recognises a centimetre drawing as well, not only millimetres',()=>{
    const cm=samples([[1200,'plan'],[800,'plan'],[1200,'wall'],[20,'thickness'],[300,'height'],[100,'opening']]);
    expect(detectPlanUnit(cm)).toMatchObject({unit:'cm',factor:0.01,confidence:'unique'});
  });
  it('reports ambiguity rather than guessing between millimetres and centimetres',()=>{
    // A 12 000 unit venue is 12 m as millimetres and 120 m as centimetres; both fit the plan band.
    expect(detectPlanUnit(samples([[12000,'plan']]))).toMatchObject({unit:null,confidence:'ambiguous',candidates:['mm','cm']});
  });
  it('lets an explicit unit break a tie but never override the numbers',()=>{
    expect(detectPlanUnit(samples([[12000,'plan']]),'mm')).toMatchObject({unit:'mm',factor:0.001,confidence:'unique'});
    expect(detectPlanUnit(samples([[12000,'plan']]),'m')).toMatchObject({unit:null,confidence:'ambiguous'});
  });
  it('treats a value that fits no unit as a reason not to convert',()=>{
    const mixed=samples([[12000,'plan'],[0.2,'thickness']]);
    expect(detectPlanUnit(mixed).confidence).toBe('inconsistent');
    expect(detectPlanUnit([]).confidence).toBe('inconsistent');
  });
  it('explains each sample per unit and agrees with the verdict it explains',()=>{
    const set=samples([[12000,'plan'],[200,'thickness'],[3000,'height']]);
    const rows=explainUnitFit(set);
    expect(rows).toHaveLength(3);
    // 200 cm = 2 m is not a real wall, and 3000 cm = 30 m is not a storey: that is what rules out cm.
    expect(rows[1].byUnit.cm).toMatchObject({metres:2,fits:false});
    expect(rows[1].byUnit.mm).toMatchObject({metres:0.2,fits:true});
    expect(rows[2].byUnit.cm).toMatchObject({metres:30,fits:false});
    const unanimous=PLAN_UNITS.filter(unit=>rows.every(row=>row.byUnit[unit].fits));
    expect(unanimous).toEqual([detectPlanUnit(set).unit]);
  });
  it('keeps the guard tight enough to catch 10× unit mistakes',()=>{
    expect(isPlausiblePlanScale(1)).toBe(true);
    expect(isPlausiblePlanScale(PLAUSIBLE_PLAN_SCALE.min)).toBe(true);
    expect(isPlausiblePlanScale(PLAUSIBLE_PLAN_SCALE.max)).toBe(true);
    for(const factor of [0,0.001,0.01,10,100,1000,Number.NaN,Infinity])expect(isPlausiblePlanScale(factor)).toBe(false);
    // Bands stay tighter than the contract limits, otherwise mm and cm both fit and nothing resolves.
    expect(METRE_BANDS.thickness).toEqual([0.05,1]);
    expect(METRE_BANDS.opening[1]).toBeLessThan(20);
  });
});

describe('recognised payload normalisation',()=>{
  it('returns a millimetre payload to metres so the metre-only contract accepts it',()=>{
    const metres=metreScene();
    // Build the payload a model produces when it echoes the drawing's millimetre labels verbatim.
    const millimetres=scaleRecognizedScene(metres as unknown as Record<string,unknown>,1000);
    expect((millimetres.venue as Record<string,unknown>).width).toBe(12000);
    expect(()=>sceneV2Schema.parse(millimetres)).toThrow();

    const {value,report}=normalizeRecognizedUnits({scene:millimetres,issues:[]});
    expect(report).toMatchObject({unit:'mm',factor:0.001,confidence:'unique',applied:true});
    expect(sceneV2Schema.parse((value as {scene:unknown}).scene)).toEqual(metres);
  });
  it('leaves an already-metric payload untouched',()=>{
    const metres=metreScene(),input={scene:metres,issues:[]};
    const {value,report}=normalizeRecognizedUnits(input);
    expect(report).toMatchObject({unit:'unscaled',applied:false,confidence:'unique'});
    expect(value).toBe(input);
  });
  it('scales object sizes and dimensions but never normalised image coordinates',()=>{
    const payload={scene:{schemaVersion:2,venue:{width:12000,depth:8000,height:3000,shape:'rectangle',entrances:[]},objects:[{id:'a',materialId:'chair',position:p(6000,4000),size:{width:500,depth:500,height:850},color:'#ffffff',locked:false}],structure:{walls:[{id:'b',start:p(0,0),end:p(12000,0),thickness:200,height:3000,kind:'exterior',status:'detected',evidence:[{sourceAssetId:'c',start:{x:0,z:0},end:{x:1,z:0}}]}],openings:[],columns:[]},dimensions:[{id:'d',kind:'width',valueMeters:12000,status:'detected',label:'12000'}],sources:[{assetId:'c',kind:'floorplan',name:'plan.png',width:1000,height:800}]}};
    const {value,report}=normalizeRecognizedUnits(payload,'mm');
    expect(report.applied).toBe(true);
    const scene=(value as {scene:{venue:{width:number};objects:{position:{x:number};size:{width:number}}[];structure:{walls:{start:{x:number};end:{x:number};thickness:number;evidence:{end:{x:number}}[]}[]};dimensions:{valueMeters:number}[]}}).scene;
    expect(scene.venue.width).toBe(12);
    expect(scene.objects[0].position.x).toBe(6);
    expect(scene.objects[0].size.width).toBe(0.5);
    expect(scene.structure.walls[0].thickness).toBe(0.2);
    expect(scene.structure.walls[0].end.x).toBe(12);
    // Wall evidence is 0..1 image coordinates, not metres: scaling it would move the overlay.
    expect(scene.structure.walls[0].evidence[0].end.x).toBe(1);
    expect(scene.dimensions[0].valueMeters).toBe(12);
  });
  it('passes through anything it cannot prove',()=>{
    for(const input of [null,{},{scene:null},{scene:{schemaVersion:1}},{scene:{schemaVersion:2,venue:{width:12000,shape:'rectangle',entrances:[]}}}])
      expect(normalizeRecognizedUnits(input).report.applied).toBe(false);
  });
});
