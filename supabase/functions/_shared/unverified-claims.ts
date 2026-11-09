/** Do not present model or unattributed legacy text as a safety approval. */
export function hideUnverifiedSafetyClaim(value:string):string {
  const safety=/(消防|防火|疏散|逃生|安全出口|无障碍|核定人数|核定容量|承载人数|安全容量|fire|egress|accessibility|occupancy)/i;
  const assertion=/(通过|达标|合规|符合|满足|已验收|验收合格|验收通过|合格|获批|approved|compliant|passed|certified)/i;
  return safety.test(value)&&assertion.test(value)?'模型意见含未核验安全结论，已隐藏':value;
}

/** Raw review is explicit and authorized, but private links and credentials are never returned. */
export function redactPrivateModelReview(value:unknown):unknown {
  if(typeof value==='string')return /(?:https?:\/\/|https?%3a%2f%2f|(?:%[0-9a-f]{2}){2}|(?:^|[^:])\/\/[^\s/]+|(?:^|[^a-z0-9_])(?:blob|data|file):|\bbearer\s+\S+|(?:[a-z0-9_-]{12,}\.){2}[a-z0-9_-]{12,}|(?:token|api[_-]?key|secret|password|authorization|signature|密钥|密码|令牌)\s*[:：=]\s*\S+)/i.test(value)?'[私密内容已隐藏]':value;
  if(Array.isArray(value))return value.map(redactPrivateModelReview);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,/(?:token|api[_-]?key|secret|password|authorization|credential|cookie|signature)/i.test(key)?'[私密内容已隐藏]':redactPrivateModelReview(entry)]));
  return value;
}
