import { createBackend } from '../_shared/backend.ts';
import { createWorker } from '../_shared/worker-handler.ts';

const env=(key:string)=>Deno.env.get(key);
const backend=createBackend(env);
Deno.serve(createWorker(backend,env));
