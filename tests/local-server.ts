/** Explicit loopback-only test fixture, never a production authentication fallback. */
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { database, owner, editor, outsider } from './fixtures.ts';
import { createApi } from '../supabase/functions/_shared/api.ts';
import { ApiError } from '../supabase/functions/_shared/domain.ts';

export const testAccounts = [
  { id: owner, email: 'owner@scendance.test', password: 'local-integration-only' },
  { id: editor, email: 'editor@scendance.test', password: 'local-integration-only' },
  { id: outsider, email: 'outsider@scendance.test', password: 'local-integration-only' },
];
export const testPublicKey = 'sb_publishable_local_integration_only';

export interface LocalServerOptions {
  /** Explicitly passed by the isolated development runner; never reads production credentials. */
  env?: (key: string) => string | undefined;
  origins?: string[];
  /** Dedicated local test data, never an existing Supabase database. */
  dataDirectory?: string;
}

export async function startLocalServer(port = 0, aiFetcher?: typeof fetch, options: LocalServerOptions = {}) {
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
    ...(aiFetcher ? { DEEPSEEK_API_KEY: 'test-provider-only', AI_MAX_REQUEST_CENTS: '40' } : {}),
  })[key] ?? options.env?.(key);
  const api = createApi(backend, env, aiFetcher);
  const server = createServer(async (req, res) => {
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
      if (address.pathname.startsWith('/functions/v1/scene-api')) {
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
        response = await api(new Request(address, {
          method: req.method ?? 'GET', headers,
          ...(body.length ? { body } : {}),
        }));
      } else {
        const origin = req.headers.origin;
        const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        if (origin && origins.includes(origin)) headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Access-Control-Allow-Headers', 'authorization,apikey,content-type');
        headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
        if (origin && !origins.includes(origin)) response = json({ error: 'test_origin_forbidden' }, 403);
        else if (req.method === 'OPTIONS') response = new Response(null, { status: 204, headers });
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
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error('Local integration fixture failed:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' }).end('{"error":"test_fixture_failed"}');
    }
  });
  server.listen(port, '127.0.0.1');
  try { await once(server, 'listening'); }
  catch (error) { await fixture.db.close(); throw error; }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback address');
  url = `http://127.0.0.1:${address.port}`;
  return {
    ...fixture, backend, url, links, env,
    async close() {
      await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
      await fixture.db.close();
    },
  };
}
