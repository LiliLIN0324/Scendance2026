import { createBackend } from '../_shared/backend.ts';
import { createApi } from '../_shared/api.ts';

const env=(key:string)=>Deno.env.get(key);
Deno.serve(createApi(createBackend(env),env));
