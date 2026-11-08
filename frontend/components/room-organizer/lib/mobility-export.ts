/** A user-stated requirement, never a site measurement or compliance verdict. */
export interface MobilityWidth {
  value:number;
  unit:'m'|'cm'|'mm';
  meters:number;
  bound:'stated'|'at_least';
  explicitClearWidth:boolean;
  source:'user_statement';
}

/** Parse only complete, unambiguous user wording; never pull unrelated numbers from a sentence. */
export function extractMobilityWidth(requirement:{decision:'needed'|'not_needed'|'unknown';evidence:string}|null|undefined,needsClarification:boolean):MobilityWidth|null {
  if(!requirement||requirement.decision!=='needed'||needsClarification||typeof requirement.evidence!=='string')return null;
  const text=requirement.evidence.replace(/\s+/g,'');
  // Bounded, complete patterns deliberately refuse ranges, prior events,
  // questions, estimates and mixed statements rather than inferring intent.
  const number='(\\d+(?:\\.\\d+)?)',unit='(毫米|厘米|公分|米|mm|cm|m)';
  const prefix='(?:需要|必须|请保留|保留|设置|安排)?';
  const first=new RegExp(`^${prefix}轮椅(?:通道|通行通道)(净宽|通行净宽|宽度|宽)(?:为|是)?(至少|不小于)?${number}${unit}$`,'i').exec(text);
  const second=new RegExp(`^${prefix}(至少|不小于)?${number}${unit}(?:宽(?:的)?)?轮椅(?:通道|通行通道)$`,'i').exec(text);
  if(!first&&!second)return null;
  const raw=Number(first?first[3]:second![2]),rawUnit=(first?first[4]:second![3])!.toLowerCase();
  const normalizedUnit:MobilityWidth['unit']=rawUnit==='米'||rawUnit==='m'?'m':rawUnit==='毫米'||rawUnit==='mm'?'mm':'cm';
  const meters=Number((raw/(normalizedUnit==='m'?1:normalizedUnit==='cm'?100:1000)).toPrecision(12));
  if(!Number.isFinite(raw)||raw<=0||!Number.isFinite(meters)||meters<=0)return null;
  return {value:raw,unit:normalizedUnit,meters,bound:(first?first[2]:second![1])?'at_least':'stated',explicitClearWidth:!!first&&/净宽/.test(first[1]!),source:'user_statement'};
}

export function validMobilityWidth(value:unknown):value is MobilityWidth {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as MobilityWidth;
  if(Object.keys(v).sort().join(',')!=='bound,explicitClearWidth,meters,source,unit,value'||v.source!=='user_statement'||!['m','cm','mm'].includes(v.unit)||!['stated','at_least'].includes(v.bound)||typeof v.explicitClearWidth!=='boolean'||typeof v.value!=='number'||!Number.isFinite(v.value)||v.value<=0||typeof v.meters!=='number'||!Number.isFinite(v.meters)||v.meters<=0)return false;
  return v.meters===Number((v.value/(v.unit==='m'?1:v.unit==='cm'?100:1000)).toPrecision(12));
}
