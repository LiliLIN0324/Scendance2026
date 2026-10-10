import { createBackend } from '../_shared/backend.ts';
import { createReconstructionWorker } from '../_shared/reconstruction-handler.ts';
const env=(key:string)=>Deno.env.get(key);
Deno.serve(createReconstructionWorker(createBackend(env),env));
