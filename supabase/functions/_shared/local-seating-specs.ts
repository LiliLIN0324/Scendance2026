/** User-stated furniture dimensions are distinct from the venue and from inventory. */
export type SeatingAxis='width'|'depth'|'height';
export type SeatingSizeFact={status:'reported'|'unknown';valueM:number|null;evidence:string};
export type SeatingItemFacts={ [axis in SeatingAxis]?:SeatingSizeFact|undefined };
type SeatingTarget='desk'|'chair';
type SeatingSpecSource='requirement'|'inventory';
export type LocalSeatingSpecs={desk?:SeatingItemFacts|undefined;chair?:SeatingItemFacts|undefined;unselected?:{desk?:SeatingItemFacts|undefined;chair?:SeatingItemFacts|undefined}|undefined;defaults?:{desk?:string|undefined;chair?:string|undefined}|undefined;focus?:{targets:SeatingTarget[];axes:SeatingAxis[];source?:SeatingSpecSource|undefined}|undefined};
const axes:SeatingAxis[]=['width','depth','height'];

function axisOf(value:string):SeatingAxis {
  return /宽|长/.test(value)?'width':/深/.test(value)?'depth':'height';
}
function metres(value:string,unit:string):number|null {
  const number=Number(value),u=unit.toLowerCase();
  const result=number*(u==='毫米'||u==='mm'?.001:u==='厘米'||u==='公分'||u==='cm'?.01:1);
  return Number.isFinite(result)&&result>=.01&&result<=50?Math.round(result*1e6)/1e6:null;
}

/** Only records explicit furniture dimension statements; never assigns venue or inventory quantities. */
export function mergeLocalSeatingSpecs(previous:LocalSeatingSpecs|undefined,raw:string):LocalSeatingSpecs|undefined {
  let result=previous?structuredClone(previous):undefined;
  const valuesThisTurn=new Map<string,number|null>();
  let lastTargets:SeatingTarget[]=[],lastSource:SeatingSpecSource='requirement';
  for(const original of raw.split(/[，,；;。！？!?\n]/)){
    const clause=original.trim().normalize('NFKC').replace(/\s+/g,'');
    if(!clause||/(?:去年|上次|上一场|以前|之前|历史)/.test(clause))continue;
    const desk=/(?:课桌|桌子|桌面|桌)/.test(clause),chair=/(?:座椅|椅子|椅)/.test(clause);
    if(!desk&&!chair&&!/(?:场地|场馆|房间|空间|面积|人数)/.test(clause)){
      const bareAxis=clause.match(/^(宽度|长度|深度|高度|宽|长|深|高)/),bareCorrection=/^(?:改成|改为|更正为|调整为|换成)\d/.test(clause);
      const focus=lastTargets.length?{targets:lastTargets,axes:bareAxis?[axisOf(bareAxis[1]!)]:axes,source:lastSource}:previous?.focus;
      if(focus&&(bareAxis||bareCorrection)&&result){
        const affected=bareAxis?[axisOf(bareAxis[1]!)]:focus.axes,evidence=original.trim().slice(0,200);
        for(const target of focus.targets){const item:SeatingItemFacts={...(focus.source==='inventory'?result.unselected?.[target]:result[target])};for(const axis of affected)item[axis]={status:'unknown',valueM:null,evidence};if(focus.source==='inventory')result.unselected={...result.unselected,[target]:item};else result[target]=item;}
        result.focus={targets:[...focus.targets],axes:[...affected],source:focus.source??'requirement'};
      }
      if(!bareAxis&&!bareCorrection)lastTargets=[];
      continue;
    }
    if(!desk&&!chair){lastTargets=[];continue;}
    if((!desk&&!chair)||!/(?:尺寸|规格|大小|默认|宽|长|深|高|直径|\d(?:\.\d+)?[×xX*]\d)/.test(clause))continue;
    // A room's width near a furniture mention is not a furniture measurement.
    if(/(?:圆桌|餐桌)/.test(clause)&&!/课桌/.test(clause)&&!chair)continue;
    const direct=/(?:课桌|桌子|桌面|桌椅|桌|座椅|椅子|椅)(?:的|要|需要|要求|预计|按|应|改成|改为|更正为){0,3}(?:尺寸|规格|大小|默认|宽|长|深|高|直径|\d)/.test(clause)||/\d(?:\.\d+)?(?:毫米|厘米|公分|米|mm|cm|m)(?:宽|长|深|高)(?:的)?(?:课桌|桌子|桌|座椅|椅子|椅)/i.test(clause);
    if(!direct)continue;
    const evidence=original.trim().slice(0,200);if(!evidence)continue;
    const targets:SeatingTarget[]=[...(desk?['desk' as const]:[]),...(chair?['chair' as const]:[])];
    const source:SeatingSpecSource=/(?:现有|已有|库存|仓库|仓储|场地有|我们有)/.test(clause)&&!/(?:使用|采用|选用|用这批|用现有|用已有|用库存|按现有|按库存)/.test(clause)?'inventory':'requirement';
    result??={};
    if(/(?:按|使用|采用|恢复|换回)(?:系统)?默认(?:尺寸|规格)?/.test(clause)){
      for(const target of targets){delete result[target];result.defaults={...result.defaults,[target]:evidence};}delete result.focus;lastTargets=[];continue;
    }
    const uncertain=/(?:不确定|不清楚|不知道|待定|未定|没定|可能|也许|或许|是否|还是|或|约|左右|大概|不是|不要|不使用|[?？])/.test(clause)||/\d(?:\.\d+)?(?:(?:毫米|厘米|公分|米|mm|cm|m))?(?:到|至|[-~～])\d/i.test(clause)||/\d(?:毫米|厘米|公分|米|mm|cm|m)\d/i.test(clause);
    const detected=[...clause.matchAll(/(宽度|长度|深度|高度|宽|长|深|高)/g)].map(match=>axisOf(match[1]!));
    let intended=[...new Set(detected.length?detected:axes)];
    const parsed=new Map<SeatingAxis,number>();
    if(targets.length===1&&!uncertain){
      const tuple=clause.match(/(?:课桌|桌子|桌面|桌|座椅|椅子|椅)(?:的)?(?:尺寸|规格|大小)?(?:为|是|:|=)?(\d+(?:\.\d+)?)[×xX*](\d+(?:\.\d+)?)(?:[×xX*](\d+(?:\.\d+)?))?(毫米|厘米|公分|米|mm|cm|m)(?![a-z])/i);
      if(tuple){const values=[tuple[1]!,tuple[2]!,tuple[3]].map(value=>value===undefined?null:metres(value,tuple[4]!));if(values[0]!==null&&values[1]!==null){parsed.set('width',values[0]!);parsed.set('depth',values[1]!);if(values[2]!==null)parsed.set('height',values[2]!);if(!detected.length)intended=values[2]===null?['width','depth']:axes;}}
      const pattern=/(宽度|长度|深度|高度|宽|长|深|高)(?:为|是|等于|设为|改为|改成|更正为|:|=)?(-?\d+(?:\.\d+)?)(毫米|厘米|公分|米|mm|cm|m)(?![a-z])/gi;
      const seen=new Set<SeatingAxis>(),conflicts=new Set<SeatingAxis>();
      for(const match of clause.matchAll(pattern)){const axis=axisOf(match[1]!),value=metres(match[2]!,match[3]!);if(seen.has(axis)){parsed.delete(axis);conflicts.add(axis);}else if(value!==null&&!conflicts.has(axis))parsed.set(axis,value);seen.add(axis);}
      const reverse=clause.match(/(\d+(?:\.\d+)?)(毫米|厘米|公分|米|mm|cm|m)(宽|长|深|高)(?:的)?(?:课桌|桌子|桌|座椅|椅子|椅)/i);
      if(reverse){const axis=axisOf(reverse[3]!),value=metres(reverse[1]!,reverse[2]!);if(value!==null&&!seen.has(axis))parsed.set(axis,value);}
    }
    for(const target of targets){
      const item:SeatingItemFacts={...(source==='inventory'?result.unselected?.[target]:result[target])};
      const affected=parsed.size?[...new Set([...intended,...parsed.keys()])]:intended;
      for(const axis of affected){
        const key=`${source}:${target}:${axis}`,value=parsed.get(axis),prior=valuesThisTurn.get(key);
        const explicitlyCorrected=/(?:改为|改成|更正|调整为|以.+为准)/.test(clause);
        const conflict=valuesThisTurn.has(key)&&!explicitlyCorrected&&(prior===null||value===undefined||prior!==value);
        item[axis]=value===undefined||conflict?{status:'unknown',valueM:null,evidence}:{status:'reported',valueM:value,evidence};
        valuesThisTurn.set(key,item[axis]!.valueM);
      }
      if(source==='inventory')result.unselected={...result.unselected,[target]:item};else result[target]=item;
    }
    result.focus={targets:[...targets],axes:[...intended],source};lastTargets=targets;lastSource=source;
  }
  return result&&Object.keys(result).length?result:undefined;
}
