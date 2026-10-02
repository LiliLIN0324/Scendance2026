import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const config=z.object({
  SUPABASE_URL:z.url(),SUPABASE_SERVICE_ROLE_KEY:z.string().min(1),
  DEMO_STUDIO_ID:z.uuid(),DEMO_STUDIO_NAME:z.string().min(1).max(120),
  DEMO_OWNER_EMAIL:z.email(),DEMO_OWNER_PASSWORD:z.string().min(12),
  DEMO_EDITOR_EMAIL:z.email(),DEMO_EDITOR_PASSWORD:z.string().min(12),
}).parse(process.env);
if(!['localhost','127.0.0.1'].includes(new URL(config.SUPABASE_URL).hostname) && !process.argv.includes('--remote')) throw new Error('Remote account creation requires explicit --remote.');
if(config.DEMO_OWNER_EMAIL===config.DEMO_EDITOR_EMAIL) throw new Error('Use two distinct emails.');
const client=createClient(config.SUPABASE_URL,config.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
async function ensureUser(email,password) {
  for(let page=1;;page++) {
    const {data,error}=await client.auth.admin.listUsers({page,perPage:100});
    if(error) throw new Error('Could not list Auth users. Check server credentials.');
    const existing=data.users.find(u=>u.email?.toLowerCase()===email.toLowerCase());
    if(existing) return existing.id;
    if(data.users.length<100) break;
  }
  const {data,error}=await client.auth.admin.createUser({email,password,email_confirm:true});
  if(error||!data.user) throw new Error('Could not create demo user. Existing users and passwords were not modified.');
  return data.user.id;
}
const owner=await ensureUser(config.DEMO_OWNER_EMAIL,config.DEMO_OWNER_PASSWORD);
const editor=await ensureUser(config.DEMO_EDITOR_EMAIL,config.DEMO_EDITOR_PASSWORD);
const {data,error}=await client.rpc('provision_demo_studio',{p_studio:config.DEMO_STUDIO_ID,p_name:config.DEMO_STUDIO_NAME,p_owner:owner,p_editor:editor});
if(error) throw new Error(`Studio provisioning failed: ${error.code}. Created Auth users were preserved for retry.`);
console.log(JSON.stringify({studioId:data,members:2,passwordsChanged:false}));
