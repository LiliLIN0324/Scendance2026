import {createBackend} from '../_shared/backend.ts';
import {createConversationApi} from '../_shared/conversation-api.ts';

const env=(key:string)=>Deno.env.get(key);
Deno.serve(createConversationApi(createBackend(env),env));
