/** Isolated, persistent local acceptance environment. Never connects to a cloud database. */
import { spawn } from 'node:child_process';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalServer, testAccounts, testPublicKey } from '../tests/local-server.ts';
import { owner, studio } from '../tests/fixtures.ts';
import { sceneV2Schema } from '../supabase/functions/_shared/domain.ts';
import { processReconstruction } from '../supabase/functions/_shared/reconstruction.ts';
import { processGeneration } from '../supabase/functions/_shared/worker.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDirectory = resolve(root, process.env.SCENDANCE_DEV_DATA ?? '.local-dev/floorplan');
if (relative(root, dataDirectory).startsWith('..') || dataDirectory === resolve(root)) {
  throw new Error('SCENDANCE_DEV_DATA must name a dedicated subdirectory in this independent checkout.');
}
const port = Number(process.env.SCENDANCE_DEV_API_PORT ?? 54336);
const webPort = Number(process.env.SCENDANCE_DEV_WEB_PORT ?? 3026);
const origins = [`http://127.0.0.1:${webPort}`, `http://localhost:${webPort}`];
const permitted = new Set(['DEEPSEEK_API_KEY', 'AI_MAX_REQUEST_CENTS', 'RECONSTRUCTION_MAX_REQUEST_CENTS',
  'HUNYUAN_API_KEY', 'HUNYUAN_API_MODE', 'GENERATION_MAX_TASK_CENTS', 'HUNYUAN_TERMS_URL', 'HUNYUAN_TERMS_REVIEWED_AT']);
const server = await startLocalServer(port, undefined, { dataDirectory, origins, env: key =>
  permitted.has(key) ? process.env[key] ?? (key === 'RECONSTRUCTION_MAX_REQUEST_CENTS' ? '200' : undefined) : undefined });

if (!(await server.db.query('select id from scene_private.projects limit 1')).rows.length) {
  const wallIds = Array.from({ length: 5 }, () => crypto.randomUUID());
  const vertices = [{x:0,z:0},{x:12,z:0},{x:12,z:10},{x:0,z:10}];
  const demo = sceneV2Schema.parse({ schemaVersion:2,
    venue:{shape:'rectangle',width:12,depth:10,height:4.2,entrances:[]}, camera:'overview',lighting:'warm',
    structure:{ walls:[...vertices.map((start,i)=>({id:wallIds[i],start,end:vertices[(i+1)%4],thickness:0.2,height:4.2,kind:'exterior',status:'confirmed'})),
      {id:wallIds[4],start:{x:6,z:0},end:{x:6,z:6},thickness:0.2,height:3,kind:'interior',status:'confirmed'}],
      openings:[{id:crypto.randomUUID(),wallId:wallIds[0],kind:'door',offset:8,width:1.4,height:2.4,sillHeight:0,status:'confirmed'},
        {id:crypto.randomUUID(),wallId:wallIds[4],kind:'door',offset:3,width:1.2,height:2.3,sillHeight:0,status:'confirmed'}],
      columns:[{id:crypto.randomUUID(),position:{x:9,z:6},size:{width:0.5,depth:0.5,height:4.2},rotation:0,status:'confirmed'}]},
    objects:[{id:crypto.randomUUID(),materialId:'backdrop',position:{x:3,z:1.5},rotation:0,size:{width:3,depth:0.2,height:2.4},color:'#af734e',locked:false,notes:'人工示例背景板'},
      {id:crypto.randomUUID(),materialId:'table',position:{x:3,z:5},rotation:30,size:{width:1.8,depth:0.8,height:0.75},color:'#b59f7a',locked:false,notes:'拖动至中间墙可验证回弹'},
      {id:crypto.randomUUID(),materialId:'reception',position:{x:9,z:3},rotation:0,size:{width:1.8,depth:0.6,height:1},color:'#58776a',locked:false,notes:'人工示例签到台'}],
    sources:[],dimensions:[['width',12],['depth',10],['height',4.2]].map(([kind,valueMeters])=>({id:crypto.randomUUID(),kind,valueMeters,status:'confirmed',label:'人工验收尺寸'})),
    finishes:{floorColor:'#e9e5db',floorPattern:'solid'},
  });
  await server.rpc(owner, 'projects.create', { studioId: studio, name: '人工实测场地 · 本地验收', scene: demo });
}

const frontend = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--prefix','frontend','run','dev','--','--hostname','127.0.0.1','--port',String(webPort)], {
  cwd:root,stdio:'inherit',detached:process.platform!=='win32',env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:server.url,NEXT_PUBLIC_SUPABASE_ANON_KEY:testPublicKey,NEXT_PUBLIC_LOCAL_FIXTURE:'1'},
});
let stopping = false, working = false;
const worker = setInterval(async () => {
  if (working || stopping) return;
  working = true;
  try {
    if (server.env('DEEPSEEK_API_KEY')) await processReconstruction(server.backend,server.env);
    if (server.env('HUNYUAN_API_KEY')) await processGeneration(server.backend,server.env);
  } catch (error) { console.error('Local worker failed:', error instanceof Error ? error.message : 'unknown error'); }
  finally { working = false; }
}, 1500);
console.log(`Independent preview: ${origins[0]}\nLocal test API: ${server.url}\nData: ${dataDirectory}`);
console.log('Auth and storage use explicit local fixtures. Recognition uses real DeepSeek only when configured; no simulated AI success.');
console.log('Test login:', testAccounts[0].email, '/', testAccounts[0].password);
console.log(`Real vision configured: ${!!server.env('DEEPSEEK_API_KEY')}; real Hunyuan configured: ${!!server.env('HUNYUAN_API_KEY')}.`);
async function stop(code=0) {
  if (stopping) return; stopping=true; clearInterval(worker);
  try {
    if (process.platform !== 'win32' && frontend.pid) process.kill(-frontend.pid,'SIGTERM');
    else frontend.kill('SIGTERM');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  await server.close();process.exit(code);
}
for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,()=>{void stop();});
frontend.once('exit',code=>{if(!stopping)void stop(code??1);});
