import type {BriefConversationResponse} from '../../../../supabase/functions/_shared/brief-extract-contract';

/** A quoted noun is not enough if its surrounding clause negates or historicizes it. */
export function supportedMaterialQueries(raw:string,items:BriefConversationResponse['materialQueries']):string[] {
  if(!items?.length)return [];
  const clauses=raw.split(/[，,；;。！!\n]|但是|然而|不过/).map(value=>value.trim()).filter(Boolean);
  return items.flatMap(item=>{
    if(!item.query||!item.evidence.includes(item.query)||!raw.includes(item.evidence))return [];
    const matches=clauses.filter(clause=>clause.includes(item.evidence));
    if(matches.length!==1||/(?:不要|不需要|不用|不想|不考虑|排除|禁止|取消|不选|不使用|别用|没有|上次|上一场|上届|去年|以前|此前|往年)/.test(matches[0]!))return [];
    return [item.query];
  });
}
