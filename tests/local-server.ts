/** Explicit loopback-only test fixture, never a production authentication fallback. */
import { createServer } from 'node:http';
import { listenLocalFetchSafe } from './local-loopback.ts';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { database, owner, editor, outsider } from './fixtures.ts';
import { createApi } from '../supabase/functions/_shared/api.ts';
import { ApiError } from '../supabase/functions/_shared/domain.ts';
import {trialModelRoundDiagnostic,trialSubmissionDiagnostic,trialValidationDiagnostic,type AgentTrialDiagnostic} from '../supabase/functions/_shared/agent-trial-diagnostic.ts';

export const testAccounts = [
  { id: owner, email: 'owner@scendance.test', password: 'local-integration-only' },
  { id: editor, email: 'editor@scendance.test', password: 'local-integration-only' },
  { id: outsider, email: 'outsider@scendance.test', password: 'local-integration-only' },
];
export const testPublicKey = 'sb_publishable_local_integration_only';
const traceTools=new Set(['get_scene','search_resources','search_places','inspect_zone','find_free_areas','prepare_seating_candidate','prepare_shared_seating_candidate','inspect_materials','get_bom','validate_candidate','submit_candidates','create_parametric_model','customize_material','start_lux3d_model']);
const traceErrors=new Set(['AGENT_TOOL_CALL_CONFLICT','CANDIDATE_GEOMETRY_CONFLICT','DIMENSION_CONFLICT','INVALID_MATERIAL_TARGET','INVALID_SELECTION','INVALID_TOOL_INPUT','PLACE_SEARCH_FAILED','PLACE_SEARCH_UNAVAILABLE','PREPARED_CANDIDATE_NOT_FOUND','RESOURCE_NOT_FOUND','SEATING_ALLOCATION_CONFLICT','SEATING_ALLOCATION_UNCONFIRMED','SEATING_SPEC_CONFLICT','SEATING_SPEC_UNCONFIRMED','SEATING_ATTEMPTS_EXHAUSTED','SEATING_RESULT_INVALID','UNKNOWN_TOOL','VALIDATED_CANDIDATE_NOT_FOUND']);
/** Project-owned fixture only: never expose arguments, model text or provider response. */
type LocalAgentTraceEntry={tool:string;outcome:'succeeded'|'failed'|'unknown';errorCode?:string};
export function safeLocalAgentTrace(usage:unknown):LocalAgentTraceEntry[] {
  if(!Array.isArray(usage))return [];
  return usage.flatMap<LocalAgentTraceEntry>(entry=>{
    if(!entry||typeof entry!=='object'||typeof entry.tool!=='string'||!traceTools.has(entry.tool))return [];
    if(typeof entry.errorCode==='string')return [{tool:entry.tool,outcome:'failed' as const,...(traceErrors.has(entry.errorCode)?{errorCode:entry.errorCode}:{})}];
    return [{tool:entry.tool,outcome:entry.ok===true?'succeeded' as const:'unknown' as const}];
  });
}

export interface LocalServerOptions {
  /** Explicitly passed by the isolated development runner; never reads production credentials. */
  env?: (key: string) => string | undefined;
  origins?: string[];
  /** Dedicated local test data, never an existing Supabase database. */
  dataDirectory?: string;
  /** Identifies the explicitly isolated, deterministic local agent runner. */
  fixtureKind?: 'agent-model-stub';
  /** Match the deployed background runner so slow providers do not hold the HTTP request open. */
  backgroundAgentRuns?: boolean;
  /** Opt in only for isolated trial telemetry; never included in production API. */
  agentTrace?: boolean;
  /** Local Lux3D only: loopback image URLs cannot be consumed by the vendor. */
  lux3dTextOnly?: boolean;
}

export async function startLocalServer(port = 0, aiFetcher?: typeof fetch, options: LocalServerOptions = {}) {
  const businessTrace=new Map<string,AgentTrialDiagnostic[]>();
  if (options.dataDirectory) await mkdir(options.dataDirectory, { recursive: true });
  const fixture = await database(options.dataDirectory ? join(options.dataDirectory, 'postgres') : undefined);
  const sessions = new Map<string, { id: string; refresh: string }>();
  const files = new Map<string, { bytes: Uint8Array; mime: string }>();
  const links = new Map<string, { path: string; until: number }>();
  const storageDirectory = options.dataDirectory ? join(options.dataDirectory, 'private-storage') : undefined;
  if (storageDirectory) await mkdir(storageDirectory, { recursive: true });
  const storageKey = (path: string) => createHash('sha256').update(path).digest('hex');
  async function readStored(path: string) {
    const cached = files.get(path);
    if (cached || !storageDirectory) return cached;
    try {
      const key = storageKey(path);
      const [bytes, mime] = await Promise.all([readFile(join(storageDirectory, key)), readFile(join(storageDirectory, `${key}.mime`), 'utf8')]);
      return { bytes: new Uint8Array(bytes), mime };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  const origins = options.origins ?? ['http://127.0.0.1:3018', 'http://localhost:3018', 'http://localhost:3000'];
  let url = '';
  const backend = {
    ...fixture.backend,
    ...(options.agentTrace?{agentTrialDiagnostic(actor:string,projectId:string,runId:string,value:AgentTrialDiagnostic){
      const checked=value.tool==='validate_candidate'?trialValidationDiagnostic(value):
        value.tool==='submit_candidates'?trialSubmissionDiagnostic(value.accepted,value.expected,value.errorCodes.map(code=>({code}))):
        value.tool==='model_round'?trialModelRoundDiagnostic(value.turn,value.phase,value.remainingMs,value.elapsedMs):null;
      if(!checked)return;
      const key=`${actor}/${projectId}/${runId}`;
      if(!businessTrace.has(key)&&businessTrace.size>=128)businessTrace.delete(businessTrace.keys().next().value!);
      const entries=businessTrace.get(key)??[];if(entries.length<64)entries.push(checked);businessTrace.set(key,entries);
    }}:{}),
    async user(token: string) {
      const user = sessions.get(token);
      if (!user) throw new ApiError('UNAUTHENTICATED', 401);
      return user.id;
    },
    async upload(path: string, bytes: Uint8Array, mime: string) {
      if (storageDirectory) {
        const key = storageKey(path);
        await writeFile(join(storageDirectory, key), bytes);
        await writeFile(join(storageDirectory, `${key}.mime`), mime);
      } else files.set(path, { bytes, mime });
    },
    async readSourceBytes(path: string) {
      const file = await readStored(path);
      if (!file) throw new ApiError('ASSET_NOT_FOUND', 404);
      return file.bytes;
    },
    async sign(path: string) {
      const token = crypto.randomUUID();
      links.set(token, { path, until: Date.now() + 300_000 });
      return `${url}/test-storage/${token}`;
    },
  };
  const env = (key: string) => ({
    ALLOWED_ORIGINS: origins.join(','), PUBLIC_APP_URL: origins[0],
    ...(aiFetcher ? { DEEPSEEK_API_KEY: 'test-provider-only', TOKENDANCE_API_KEY: 'test-provider-only', AI_MAX_REQUEST_CENTS: '40' } : {}),
  })[key] ?? options.env?.(key);
  const pendingRuns=new Set<Promise<unknown>>();
  const waitUntil=options.backgroundAgentRuns?(task:Promise<unknown>)=>{
    pendingRuns.add(task);void task.then(()=>pendingRuns.delete(task),()=>pendingRuns.delete(task));
  }:undefined;
  const api = createApi(backend, env, aiFetcher, waitUntil);
  const server = createServer(async (req, res) => {
    // 浏览器直连本机服务要过跨域与私有网络两道预检，Node 侧集成测试走不到这里。
    const origin = req.headers.origin;
    const allowOrigin = origin && origins.includes(origin) ? origin : null;
    const corsHeaders = new Headers({ 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info,x-supabase-api-version', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Allow-Local-Network': 'true' });
    if (allowOrigin) corsHeaders.set('Access-Control-Allow-Origin', allowOrigin);
    try {
      const address = new URL(req.url ?? '/', url);
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        const limit = address.pathname.includes('/assets/sources') || address.pathname.endsWith('/assets/floorplan') ? 5 * 1024 * 1024 + 65536 : 256_000;
        if (length > limit) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      let response: Response;
      const conversationRoute = address.pathname.startsWith('/functions/v1/conversation-api');
      if (conversationRoute) address.pathname = address.pathname.slice('/functions/v1/conversation-api'.length) || '/';
      if (address.pathname.startsWith('/functions/v1/scene-api') || conversationRoute) {
        if (req.method === 'OPTIONS') { res.writeHead(204, Object.fromEntries(corsHeaders)); res.end(); return; }
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
        const cancelled=new AbortController();
        res.once('close',()=>{if(!res.writableEnded)cancelled.abort();});
        let unsupportedImage=false;
        if(options.lux3dTextOnly&&req.method==='POST'&&address.pathname==='/functions/v1/scene-api/jobs')try{
          const data=JSON.parse(body.toString()) as {provider?:unknown;kind?:unknown};unsupportedImage=data?.provider==='aholo'&&data?.kind==='image';
        }catch{/* Let the normal API validate malformed requests. */}
        const authorizedFixture=!!sessions.get((req.headers.authorization??'').replace(/^Bearer /,''))&&req.headers.apikey===testPublicKey;
        response = unsupportedImage&&authorizedFixture?Response.json({error:{code:'LOCAL_LUX3D_IMAGE_UNAVAILABLE'}},{status:400}):await api(new Request(address, {
          method: req.method ?? 'GET', headers, signal:cancelled.signal,
          ...(body.length ? { body } : {}),
        }));
        if(options.lux3dTextOnly&&req.method==='GET'&&address.pathname==='/functions/v1/scene-api/generation/capabilities'&&response.ok){
          const capabilities=await response.json() as Record<string,unknown>;
          response=Response.json({...capabilities,aholoImageToModel:false},{status:response.status,headers:response.headers});
        }
      } else {
        const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        for (const [key, value] of corsHeaders) headers.set(key, value);
        const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
        if (origin && !origins.includes(origin)) response = json({ error: 'test_origin_forbidden' }, 403);
        else if (req.method === 'OPTIONS') response = new Response(null, { status: 204, headers });
        else if (address.pathname === '/__fixture' && req.method === 'GET' && options.fixtureKind === 'agent-model-stub') response=json({fixture:'agent-model-stub',provider:'local-deterministic',production:false});
        else if (options.agentTrace && req.method==='GET' && /^\/__test-agent-trace\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(address.pathname)) {
          const authenticated=sessions.get((req.headers.authorization??'').replace(/^Bearer /,''));
          if(!authenticated||req.headers.apikey!==testPublicKey)response=json({error:'unauthenticated'},401);
          else {
            const [, , projectId, runId]=address.pathname.split('/');
            const rows=await fixture.db.query<{usage:unknown}>('select usage from scene_private.agent_runs where id=$1 and project_id=$2 and owner_id=$3',[runId,projectId,authenticated.id]);
            const details=businessTrace.get(`${authenticated.id}/${projectId}/${runId}`);
            response=rows.rows.length?json({tools:safeLocalAgentTrace(rows.rows[0]!.usage),...(details?.length?{business:details}:{})}):json({error:'not_found'},404);
          }
        }
        else if (address.pathname === '/auth/v1/token' && req.method === 'POST') {
          const input = JSON.parse(body.toString());
          const grant = address.searchParams.get('grant_type');
          const previous = [...sessions].find(([, s]) => s.refresh === input.refresh_token);
          const account = grant === 'password'
            ? testAccounts.find(a => a.email === input.email && a.password === input.password)
            : grant === 'refresh_token' && previous ? testAccounts.find(a => a.id === previous[1].id) : undefined;
          if (!account || req.headers.apikey !== testPublicKey) response = json({ error: 'invalid_grant' }, 400);
          else {
            if (previous) sessions.delete(previous[0]);
            const access = crypto.randomUUID(), refresh = crypto.randomUUID();
            sessions.set(access, { id: account.id, refresh });
            response = json({ access_token: access, refresh_token: refresh, expires_in: 3600, user: { id: account.id, email: account.email } });
          }
        } else if (address.pathname === '/auth/v1/user' && req.method === 'GET') {
          const session = sessions.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
          const account = session && testAccounts.find(a => a.id === session.id);
          response = account && req.headers.apikey === testPublicKey
            ? json({ id: account.id, email: account.email }) : json({ error: 'invalid_token' }, 401);
        } else if (address.pathname === '/auth/v1/logout' && req.method === 'POST') {
          sessions.delete((req.headers.authorization ?? '').replace(/^Bearer /, ''));
          response = new Response(null, { status: 204, headers });
        } else if (address.pathname.startsWith('/test-storage/') && req.method === 'GET') {
          const link = links.get(address.pathname.split('/').at(-1)!);
          const file = link && link.until > Date.now() ? await readStored(link.path) : undefined;
          if (!file) response = json({ error: 'test_signed_url_expired' }, 404);
          else { headers.set('Content-Type', file.mime); response = new Response(new Uint8Array(file.bytes), { headers }); }
        } else response = json({ error: 'test_route_not_found' }, 404);
      }
      response.headers.set('X-Scendance-Test-Fixture', 'PGlite; Auth and Storage are test doubles');
      // 业务接口也要带 CORS 头：浏览器直连本机服务时，缺头就是 net::ERR_FAILED，而不是可见的 HTTP 错误。
      for (const [key, value] of corsHeaders) { try { response.headers.set(key, value); } catch { /* 不可变的响应头（重定向等）保持原样 */ } }
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      console.error('Local integration fixture failed.');
      const headers = new Headers({ 'Content-Type': 'application/json' });
      for (const [key, value] of corsHeaders) headers.set(key, value);
      res.writeHead(500, Object.fromEntries(headers)).end('{"error":"test_fixture_failed"}');
    }
  });
  let address: Awaited<ReturnType<typeof listenLocalFetchSafe>>;
  try { address=await listenLocalFetchSafe(server,port); }
  catch (error) { await fixture.db.close(); throw error; }
  url = `http://127.0.0.1:${address.port}`;
  return {
    ...fixture, backend, url, links, env,
    async close() {
      await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
      await Promise.allSettled([...pendingRuns]);
      await fixture.db.close();
    },
  };
}
