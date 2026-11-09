import { canonical, sha256 } from '../../supabase/functions/_shared/domain.ts';

/** Experimental server-only fingerprint; accountRef must be a non-secret stable account identity. */
export async function prototypeBriefFingerprint(input:{url:string;body:string;accountRef:string;credentialVersion:string;headers:Record<string,string>}):Promise<string> {
  if(typeof input.url!=='string'||typeof input.body!=='string'||new TextEncoder().encode(input.body).length>256_000||
    typeof input.accountRef!=='string'||!input.accountRef.trim()||input.accountRef.length>128||
    typeof input.credentialVersion!=='string'||!input.credentialVersion.trim()||input.credentialVersion.length>128)throw new Error('INVALID_PROVIDER_CONFIG');
  const url=new URL(input.url);
  if((url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))||url.username||url.password||url.search||url.hash)throw new Error('INVALID_PROVIDER_CONFIG');
  if(!input.headers||typeof input.headers!=='object'||Array.isArray(input.headers))throw new Error('INVALID_PROVIDER_CONFIG');
  const headers:Record<string,string>={};
  for(const [rawKey,value] of Object.entries(input.headers)){
    const key=rawKey.toLowerCase();
    if(!/^[a-z0-9-]+$/.test(key)||key in headers||typeof value!=='string'||value.length>2048||/authorization|token|secret|cookie|api.key/i.test(key))throw new Error('INVALID_PROVIDER_CONFIG');
    headers[key]=value;
  }
  return sha256(canonical({version:1,method:'POST',url:url.href,body:input.body,accountRef:input.accountRef,credentialVersion:input.credentialVersion,headers}));
}
