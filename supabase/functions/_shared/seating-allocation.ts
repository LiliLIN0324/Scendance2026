/** User-stated seating arrangement; absence means a reversible exploration assumption. */
export type SeatingAllocation=
  | {status:'one_per_desk';peoplePerDesk:1;evidence:string}
  | {status:'shared_desk';peoplePerDesk:number;evidence:string}
  | {status:'unknown';peoplePerDesk:null;evidence:string};
const numerals:Record<string,number>={'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
function numberOf(value:string):number|null {
  const number=/^\d+$/.test(value)?Number(value):numerals[value];
  return Number.isSafeInteger(number)&&number!>=1&&number!<=100?number!:null;
}

/** Capture only explicit allocation choices; a furniture inventory or an activity type is not a choice. */
export function mergeSeatingAllocation(previous:SeatingAllocation|undefined,raw:string):SeatingAllocation|undefined {
  let result=previous,seenPositive:number|null=null;
  for(const original of raw.split(/[，,；;。！!\n]/)){
    const clause=original.trim().normalize('NFKC').replace(/\s+/g,'');if(!clause||/(?:去年|上次|上一场|以前|之前|历史)/.test(clause))continue;
    const perPerson=/(?:每人|一人|1人)(?:各)?(?:一|1)(?:张)?(?:课桌|长条桌|长桌|圆桌|方桌|桌子|桌|套)(?:椅)?/.exec(clause);
    const peopleFirst=/(?:每)?(\d{1,3}|[一二两三四五六七八九十]+)(?:个)?人(?:(?:共用|合用|共坐|共)(?:(?:一|1)(?:张)?)?|(?:一|1)(?:张)?)(?:课桌|长条桌|长桌|圆桌|方桌|桌子|桌|套)/.exec(clause);
    const deskFirst=/(?:每桌|每张(?:课|长条|长|圆|方)?桌(?:子)?|(?:一|1)(?:张)?(?:课|长条|长|圆|方)?桌(?:子)?)(?:坐|供|配|安排|容纳)?(\d{1,3}|[一二两三四五六七八九十]+)(?:个)?人/.exec(clause);
    const shorthand=/(\d{1,3}|[一二两三四五六七八九十]+)(?:个)?人\/(?:张)?(?:课桌|长条桌|长桌|圆桌|方桌|桌子|桌)/.exec(clause);
    const matches=[...(perPerson?[{index:perPerson.index,count:1}]:[]),...(peopleFirst?[{index:peopleFirst.index,count:numberOf(peopleFirst[1]!)}]:[]),...(deskFirst?[{index:deskFirst.index,count:numberOf(deskFirst[1]!)}]:[]),...(shorthand?[{index:shorthand.index,count:numberOf(shorthand[1]!)}]:[])].sort((a,b)=>a.index-b.index);
    if(!matches.length){
      if(/(?:多人|几人|数人|若干人)(?:共用|合用|共坐|共|一)(?:一|1|张)*(?:课桌|长条桌|长桌|圆桌|方桌|桌子|桌)|(?:每桌|一桌|每张桌)(?:坐|供|配|安排|容纳)?(?:多人|几人|数人|若干人|多少人)|(?:每桌|一桌|每张桌)(?:的)?(?:人数|座位数|坐几人)(?:还没|尚未|未|没|待|不)(?:决定|确定|定|知道)|(?:每桌|一桌|每张桌)(?:坐|供|配|安排|容纳)?(?:不超过|至少|最多|不多于|不少于)\d{1,3}人/.test(clause)){
        result={status:'unknown',peoplePerDesk:null,evidence:original.trim().slice(0,200)};seenPositive=null;
      }
      continue;
    }
    // Existing stock alone is not a choice of how this activity will be arranged.
    if(/(?:现有|已有|库存|仓库|仓储)/.test(clause)&&!/(?:使用|采用|选用|安排|摆成|按)/.test(clause))continue;
    const evidence=original.trim().slice(0,200);if(!evidence)continue;
    const uncertain=/(?:不确定|不清楚|不知道|待定|未定|没定|可能|也许|是否|要不要|还是|或者|或|[?？吗么])/.test(clause);
    if(uncertain){result={status:'unknown',peoplePerDesk:null,evidence};seenPositive=null;continue;}
    for(const match of matches){
      const before=clause.slice(Math.max(0,match.index-10),match.index);
      const negated=/(?:不要|不想|不采用|不使用|不是|不按|取消|无需|不用|别)$/.test(before);
      if(negated){
        if(!result||result.status==='unknown'||(match.count===1&&result.status==='one_per_desk')||(match.count!==1&&result.status==='shared_desk'))result={status:'unknown',peoplePerDesk:null,evidence};
        continue;
      }
      const count=match.count;
      if(count===null){result={status:'unknown',peoplePerDesk:null,evidence};seenPositive=null;continue;}
      const explicitlyCorrected=/(?:改为|改成|更正|调整为|改用)/.test(before);
      if(seenPositive!==null&&seenPositive!==count&&!explicitlyCorrected){result={status:'unknown',peoplePerDesk:null,evidence};continue;}
      result=count===1?{status:'one_per_desk',peoplePerDesk:1,evidence}:{status:'shared_desk',peoplePerDesk:count,evidence};seenPositive=count;
    }
  }
  return result;
}
