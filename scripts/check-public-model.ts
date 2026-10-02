import { importPublicModel } from '../supabase/functions/_shared/assets.ts';
const result=await importPublicModel('chinese_armchair');
console.log(JSON.stringify({source:result.sourceUrl,license:result.license,bytes:result.bytes.length,metadata:result.metadata},null,2));
