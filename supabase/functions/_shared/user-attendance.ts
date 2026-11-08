/** A conservative reading of an attendance statement; never infers people from furniture. */
export type UserAttendance = {status:'reported';people:number} | {status:'unknown'};
const numberPattern='(?:\\d{1,5}|[零〇一二两三四五六七八九十百千]+)';
function chineseNumber(value:string):number|null {
  if(/^\d+$/.test(value)){const n=Number(value);return Number.isSafeInteger(n)&&n>0&&n<=100000?n:null;}
  const digit:Record<string,number>={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
  if([...value].every(c=>c in digit)){const n=Number([...value].map(c=>digit[c]).join(''));return Number.isSafeInteger(n)&&n>0&&n<=100000?n:null;}
  let total=0,current=0,lastUnit=10000;
  for(const c of value){if(c in digit){current=digit[c]!;continue;}const unit=c==='千'?1000:c==='百'?100:c==='十'?10:0;if(!unit||unit>=lastUnit)return null;total+=(current||1)*unit;current=0;lastUnit=unit;}
  const n=total+current;return n>0&&n<=100000?n:null;
}

/**
 * `undefined` means no attendance claim; `unknown` means an ambiguous one.
 * Only raw user text is suitable input. A summary or model output is not proof.
 */
export function readUserAttendance(raw:string):UserAttendance|undefined {
  const text=raw.normalize('NFKC').replace(/\s+/g,'');
  if(/(?:人数|参与人数|参会人数|参加人数).{0,4}(?:尚未|还没|未|没|不)(?:确定|决定|定|知道)|(?:人数|参与人数|参会人数|参加人数).{0,4}(?:待定|未知)/.test(text))return {status:'unknown'};
  const deskFirst=new RegExp(`(?:每桌|每张(?:课|长条|长|圆|方)?桌(?:子)?|(?:一|1)(?:张)?(?:课|长条|长|圆|方)?桌(?:子)?)(?:坐|供|配|安排|容纳)?${numberPattern}(?:个)?(?:人|位|名)`,'g');
  const peopleFirst=new RegExp(`(?:每)?${numberPattern}(?:个)?(?:人|位|名)(?:(?:共用|合用|共坐|共)(?:(?:一|1)(?:张)?)?|(?:一|1)(?:张)?)(?:课桌|长条桌|长桌|圆桌|方桌|桌子|桌|套)`,'g');
  const perDesk=new RegExp(`${numberPattern}(?:个)?(?:人|位|名)每(?:张)?(?:课|长条|长|圆|方)?桌(?:子)?`,'g');
  const roleCount=new RegExp(`${numberPattern}(?:个)?(?:人|位|名)(?:工作人员|服务人员|主持人|主讲人|讲师|供应商|志愿者)`,'g');
  const clean=text.replace(deskFirst,' ').replace(peopleFirst,' ').replace(perDesk,' ').replace(roleCount,' ');
  const matches=[...clean.matchAll(new RegExp(`(${numberPattern})(?:个)?(?:人|位|名)`,'g'))];
  if(!matches.length)return undefined;
  // Ranges, alternatives, explicit exclusions or conflicting totals need user clarification.
  if(/(?:不是|不要|不超过|至多|超过|少于|至少|最多|不少于|或|或者|大于|小于|不参加|不来|没来|缺席|[~～—–-])/.test(clean))return {status:'unknown'};
  const values=matches.map(match=>chineseNumber(match[1]!));
  if(values.some(value=>value===null)||new Set(values).size!==1)return {status:'unknown'};
  return {status:'reported',people:values[0]!};
}
