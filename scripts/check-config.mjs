import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { z } from 'zod';

const usage='Usage: node scripts/check-config.mjs [--mode core|full] [--demo] [--env PATH ...]';
const args=process.argv.slice(2),files=[];
let mode='core',demo=false;
for(let i=0;i<args.length;i++) {
  if(args[i]==='--help') { console.log(usage);process.exit(0); }
  if(args[i]==='--demo') demo=true;
  else if(args[i]==='--mode' && args[i+1]) mode=args[++i];
  else if(args[i]==='--env' && args[i+1]) files.push(args[++i]);
  else if(args[i].startsWith('--env=')) files.push(args[i].slice(6));
  else { console.error(usage);process.exit(1); }
}
if(!['core','full'].includes(mode)) { console.error(usage);process.exit(1); }
const env={},explicitFiles=files.length>0;
for(const file of explicitFiles?files:['.env.local','.env.edge.local']) {
  try { Object.assign(env,parseEnv(readFileSync(file,'utf8'))); }
  catch(error) {
    if(!explicitFiles && error.code==='ENOENT') continue;
    console.error('ENV_FILE: could not read an environment file. Check --env paths and permissions.');process.exit(1);
  }
}
Object.assign(env,process.env);
const issues=[];
const present=key=>typeof env[key]==='string' && env[key].trim().length>0;
const problem=(key,reason)=>issues.push(`${key}: ${reason}`);
function required(key) { if(!present(key)) problem(key,'required'); }
function origin(key,value) {
  try {
    const url=new URL(value);
    const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if(value!==url.origin || url.hostname.includes('*') || (url.protocol!=='https:' && !(local && url.protocol==='http:'))) throw new Error();
  } catch { problem(key,'must be an exact HTTPS origin, or an HTTP localhost origin (no path, credentials, query or fragment)'); }
}
function group(keys,mandatory) {
  const active=mandatory || keys.some(present);
  if(active) keys.forEach(required);
  return active;
}
function cost(key,limit) {
  if(present(key) && (!/^\d+$/.test(env[key]) || !Number.isSafeInteger(Number(env[key])) || Number(env[key])<1 || Number(env[key])>limit)) {
    problem(key,`must be an integer between 1 and the SQL budget limit of ${limit} cents`);
  }
}
const publicKey=present('SUPABASE_PUBLISHABLE_KEY')?'SUPABASE_PUBLISHABLE_KEY':'SUPABASE_ANON_KEY';
for(const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','PUBLIC_APP_URL','ALLOWED_ORIGINS','GENERATION_WORKER_SECRET']) required(key);
if(!present(publicKey)) problem('SUPABASE_PUBLISHABLE_KEY / SUPABASE_ANON_KEY','a public client key is required');
for(const key of ['SUPABASE_URL','PUBLIC_APP_URL']) if(present(key)) origin(key,env[key]);
if(present('ALLOWED_ORIGINS')) {
  const origins=env.ALLOWED_ORIGINS.split(',').map(value=>value.trim());
  origins.forEach(value=>origin('ALLOWED_ORIGINS',value));
  if(present('PUBLIC_APP_URL') && !origins.includes(env.PUBLIC_APP_URL)) problem('ALLOWED_ORIGINS','must include PUBLIC_APP_URL');
}
for(const key of ['SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY']) {
  if(!present(key)) continue;
  let role;
  try { role=JSON.parse(Buffer.from(env[key].split('.')[1]??'','base64url').toString()).role; } catch {}
  if(env[key]===env.SUPABASE_SERVICE_ROLE_KEY || env[key].startsWith('sb_secret_') || role==='service_role') problem(key,'must be a public key, never a service role or secret key');
}
if(present('GENERATION_WORKER_SECRET')) {
  if(Buffer.byteLength(env.GENERATION_WORKER_SECRET,'utf8')<32) problem('GENERATION_WORKER_SECRET','must contain at least 32 bytes; generate a random token');
  if(['SUPABASE_SERVICE_ROLE_KEY','SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY','DEEPSEEK_API_KEY','TOKENDANCE_API_KEY','HUNYUAN_API_KEY'].some(key=>present(key) && env[key]===env.GENERATION_WORKER_SECRET)) problem('GENERATION_WORKER_SECRET','must be independent from API keys');
}
const ai=group(['TOKENDANCE_API_KEY','DEEPSEEK_API_KEY','AI_MAX_REQUEST_CENTS'],mode==='full');
const generation=group(['HUNYUAN_API_KEY','GENERATION_MAX_TASK_CENTS','HUNYUAN_TERMS_URL','HUNYUAN_TERMS_REVIEWED_AT'],mode==='full');
if(present('HUNYUAN_API_MODE') && !['tokenhub','legacy'].includes(env.HUNYUAN_API_MODE)) problem('HUNYUAN_API_MODE','must be tokenhub or legacy');
// Keep these limits aligned with 20261002060307_scene_jobs.sql.
cost('AI_MAX_REQUEST_CENTS',3000);
if(present('AI_MAX_REQUEST_CENTS') && Number(env.AI_MAX_REQUEST_CENTS)<40) problem('AI_MAX_REQUEST_CENTS','must reserve at least 40 cents for two bounded DeepSeek calls');
cost('GENERATION_MAX_TASK_CENTS',15000);
if(present('HUNYUAN_TERMS_URL')) {
  try {
    const url=new URL(env.HUNYUAN_TERMS_URL);
    if(url.protocol!=='https:' || url.username || url.password) throw new Error();
  } catch { problem('HUNYUAN_TERMS_URL','must be an HTTPS URL without credentials'); }
}
if(present('HUNYUAN_TERMS_REVIEWED_AT')) {
  const value=env.HUNYUAN_TERMS_REVIEWED_AT,date=new Date(value);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==value || value>new Date().toISOString().slice(0,10)) problem('HUNYUAN_TERMS_REVIEWED_AT','must be a real YYYY-MM-DD date that is not in the future');
}
const demoKeys=['DEMO_STUDIO_ID','DEMO_STUDIO_NAME','DEMO_OWNER_EMAIL','DEMO_OWNER_PASSWORD','DEMO_EDITOR_EMAIL','DEMO_EDITOR_PASSWORD'];
// The template includes a studio name; that label alone does not enable seeding.
const seed=demo || demoKeys.filter(key=>key!=='DEMO_STUDIO_NAME').some(present);
if(seed) {
  demoKeys.forEach(required);
  for(const [key,schema] of [
    ['DEMO_STUDIO_ID',z.uuid()],['DEMO_STUDIO_NAME',z.string().min(1).max(120)],
    ['DEMO_OWNER_EMAIL',z.email()],['DEMO_EDITOR_EMAIL',z.email()],
    ['DEMO_OWNER_PASSWORD',z.string().min(12)],['DEMO_EDITOR_PASSWORD',z.string().min(12)],
  ]) if(present(key) && !schema.safeParse(env[key]).success) problem(key,key.endsWith('PASSWORD')?'must contain at least 12 characters':'invalid format');
  if(present('DEMO_OWNER_EMAIL') && present('DEMO_EDITOR_EMAIL') && env.DEMO_OWNER_EMAIL.toLowerCase()===env.DEMO_EDITOR_EMAIL.toLowerCase()) problem('DEMO_OWNER_EMAIL / DEMO_EDITOR_EMAIL','must be distinct (case insensitive)');
  if(present('DEMO_OWNER_PASSWORD') && env.DEMO_OWNER_PASSWORD===env.DEMO_EDITOR_PASSWORD) problem('DEMO_OWNER_PASSWORD / DEMO_EDITOR_PASSWORD','must use independent passwords');
}
if(issues.length) {
  console.error(`Backend configuration failed (${mode}):\n${issues.map(issue=>`- ${issue}`).join('\n')}`);
  process.exitCode=1;
} else {
  console.log(`Backend configuration passed (${mode}). AI: ${ai?'configured':'disabled'}; 3D generation: ${generation?'configured':'disabled'}; demo: ${seed?'configured':'not requested'}.`);
  console.log('Local validation only; credentials, migrations, Auth, Storage, cron and provider access have not been verified online.');
}
