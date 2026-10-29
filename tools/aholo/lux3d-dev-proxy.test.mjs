import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from './lux3d-dev-proxy.mjs';

const KEY = 'fake-secret-key-DO-NOT-LEAK';
const LUX = 'https://api.aholo.ai/global';
const WORLD = 'https://api.aholo3d.cn';
const MIB = 1024 * 1024;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const JPEG = 'data:image/jpeg;base64,/9j/';
const response = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const luxResponse = d => response({ c: '0', d });

async function fixture(t, responder = () => { throw new Error('Unexpected upstream request'); }, options = {}) {
  const calls = [];
  const server = createServer({
    key: KEY,
    ...options,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return responder(url, init);
    },
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const port = server.address().port;
  function request(path, { method = 'GET', headers = {}, body, chunked = false, setHost = true, raw = false } = {}) {
    const data = body === undefined ? undefined : Buffer.isBuffer(body) ? body :
      Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const outgoingHeaders = Array.isArray(headers) ? headers : {
      ...(data ? { 'Content-Type': 'application/json', ...(!chunked ? { 'Content-Length': data.length } : {}) } : {}),
      ...headers,
    };
    return new Promise((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port, path, method, headers: outgoingHeaders, agent: false, setHost }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          const bytes = Buffer.concat(chunks);
          const text = bytes.toString('utf8');
          resolve({ status: res.statusCode, headers: res.headers, text, bytes, body: raw || !text ? undefined : JSON.parse(text) });
        });
      });
      req.on('error', reject);
      if (chunked && data) {
        for (let offset = 0; offset < data.length; offset += 65536) req.write(data.subarray(offset, offset + 65536));
        req.end();
      } else {
        req.end(data);
      }
    });
  }
  return { calls, request, server };
}

function assertAuth(call) {
  assert.equal(call.init.headers.Authorization, KEY); // 裸 key，而非 Bearer。
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  assert.equal(call.init.redirect, 'error');
  assert.ok(call.init.signal instanceof AbortSignal);
}

for (const [path, body, upstream, payload] of [
  ['/text-to-3d', { prompt: '  一把木椅  ', injected: 'ignored' }, 'text', {
    prompt: '一把木椅', style: 'photorealistic', faceCount: 30000, outputFormat: ['zip', 'glb'], version: 'G1',
  }],
  ['/image-to-3d', { img: PNG, prompt: 'must not forward' }, 'img', {
    img: PNG, faceCount: 30000, outputFormat: ['zip', 'glb'], version: 'G1',
  }],
  ['/image-to-3d', { img: JPEG }, 'img', {
    img: JPEG, faceCount: 30000, outputFormat: ['zip', 'glb'], version: 'G1',
  }],
]) {
  test(`Lux creation ${path} (${upstream === 'text' ? 'text' : body.img === PNG ? 'PNG' : 'JPEG'})`, async t => {
    const f = await fixture(t, () => luxResponse('lux_task-123'));
    const result = await f.request(path, { method: 'POST', body, headers: { Origin: 'http://localhost:5173' } });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { taskid: 'lux_task-123' });
    assert.equal(result.headers['access-control-allow-origin'], 'http://localhost:5173');
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, `${LUX}/lux3d/v1/generate/${upstream}-to-3d/task/create`);
    assert.equal(f.calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(f.calls[0].init.body), payload);
    assertAuth(f.calls[0]);
  });
}

test('Lux creation returns Aholo 真实给出的数字任务号，转成字符串不丢任务', async t => {
  const f = await fixture(t, () => luxResponse(4425999));
  const result = await f.request('/text-to-3d', { method: 'POST', body: { prompt: '一张中式躺椅' } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { taskid: '4425999' });
});

for (const unusable of [0, -4425999, 1.5, 2 ** 53, '', 'has space', 'x'.repeat(129), null, undefined]) {
  test(`Lux creation rejects unusable taskid ${String(unusable)}`, async t => {
    const f = await fixture(t, () => luxResponse(unusable));
    const result = await f.request('/text-to-3d', { method: 'POST', body: { prompt: '椅子' } });
    assert.equal(result.status, 502);
    assert.equal(result.body.error, 'Aholo 返回的任务号无效');
    assert.equal(f.calls.length, 1);
  });
}

for (const wrapper of ['top', 'd', 'data']) {
  test(`World creation accepts ${wrapper} worldId and uses its own gateway`, async t => {
    const created = { worldId: '3FO4K4QI6N4V' };
    const f = await fixture(t, () => response(wrapper === 'top' ? created : { c: '0', [wrapper]: created }), {
      base: 'https://lux.example.test/custom/',
    });
    const result = await f.request('/world', { method: 'POST', body: { name: ' 世界 ', prompt: ' 山谷 ', operationId: 'ignore' } });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { taskid: '3FO4K4QI6N4V' });
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, `${WORLD}/world/v1/generations`);
    assert.deepEqual(JSON.parse(f.calls[0].init.body), { name: '世界', prompt: '山谷' });
    assertAuth(f.calls[0]);
  });
}

test('Lux query uses taskid and outputs[].content only', async t => {
  const f = await fixture(t, () => luxResponse({ status: 3, outputs: [
    { content: 'https://cdn.example.test/model.glb?signature=abc' },
    { content: 'https://cdn.example.test/model.zip' },
    { url: 'https://cdn.example.test/ignored.glb' }, null, { content: 123 },
    { content: 'http://cdn.example.test/insecure.glb' },
  ] }));
  const result = await f.request('/task?taskid=lux_task-123');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { status: 3, statusLabel: '成功', outputs: [
    'https://cdn.example.test/model.glb?signature=abc', 'https://cdn.example.test/model.zip',
  ] });
  assert.equal(f.calls[0].url, `${LUX}/lux3d/v1/generate/task/get?taskid=lux_task-123`);
  assert.equal(f.calls[0].init.method, 'GET');
  assert.equal(f.calls[0].init.body, undefined);
  assertAuth(f.calls[0]);
});

for (const wrapper of ['top', 'd', 'data']) {
  test(`World query ${wrapper}: evidence-shaped assets, progress and separate panorama`, async t => {
    const detail = {
      status: 'SUCCEEDED', progress: 1,
      assets: {
        splats: { urls: {
          plyPath: 'https://cdn.example.test/world.ply',
          spzPath: 'https://cdn.example.test/world.spz',
          lodMetaPath: 'https://cdn.example.test/lod.json',
        } },
        imagery: { panoUrl: 'https://cdn.example.test/pano.jpg' },
      },
      output: { splat: 'https://cdn.example.test/wrong.ply' },
      semanticsMetadata: { upAxis: 'Z' },
    };
    const f = await fixture(t, () => response(wrapper === 'top' ? detail : { [wrapper]: detail }));
    const result = await f.request('/world?worldId=3FO4K4QI6N4V');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
      status: 3, statusLabel: '成功', progress: 1, upAxis: 'Z',
      outputs: ['https://cdn.example.test/world.ply', 'https://cdn.example.test/world.spz', 'https://cdn.example.test/lod.json'],
      panoUrl: 'https://cdn.example.test/pano.jpg',
    });
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, `${WORLD}/world/v1/3FO4K4QI6N4V`);
    assert.equal(f.calls[0].init.method, 'GET');
    assertAuth(f.calls[0]);
  });
}

test('World base override does not change Lux base', async t => {
  const f = await fixture(t, () => response({ status: 'PENDING' }), { worldBase: 'https://world.example.test/gateway/' });
  assert.equal((await f.request('/world?worldId=abc')).status, 200);
  assert.equal(f.calls[0].url, 'https://world.example.test/gateway/world/v1/abc');
  const health = await f.request('/health');
  assert.deepEqual(health.body, { ok: true, keyConfigured: true, base: LUX, worldBase: 'https://world.example.test/gateway' });
  assert.ok(!health.text.includes(KEY));
});

for (const [raw, expected] of [[0, 0], ['0', 0], [1, 1], ['1', 1], [3, 3], [4, 4], [6, 6], ['6', 6], [99, -1], ['NEW_STATE', -1], [null, -1], [{}, -1]]) {
  test(`Lux status ${JSON.stringify(raw)} -> ${expected}`, async t => {
    const f = await fixture(t, () => luxResponse({ status: raw, outputs: {} }));
    const result = await f.request('/task?taskid=abc');
    assert.equal(result.status, 200);
    assert.equal(result.body.status, expected);
    assert.deepEqual(result.body.outputs, []);
    if (expected === -1) assert.equal(result.body.statusLabel, typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '未知');
  });
}

for (const [raw, expected] of [
  ['QUEUED', 0], ['PENDING', 0], ['INITIALIZING', 0], ['RUNNING', 1], ['PROCESSING', 1], ['IN_PROGRESS', 1],
  ['SUCCEEDED', 3], ['SUCCESS', 3], ['COMPLETED', 3], ['FAILED', 4], ['FAILURE', 4], ['ERROR', 4],
  ['CANCELLED', 6], ['CANCELED', 6], ['failed', 4], [0, 0], [1, 1], [3, 3], [4, 4], [6, 6], ['FUTURE_STATE', -1],
]) {
  test(`World status ${raw} -> ${expected}, no invented progress`, async t => {
    const f = await fixture(t, () => response({ status: raw }));
    const result = await f.request('/world?worldId=abc');
    assert.equal(result.status, 200);
    assert.equal(result.body.status, expected);
    assert.deepEqual(result.body.outputs, []);
    assert.ok(!Object.hasOwn(result.body, 'progress'));
    assert.ok(!Object.hasOwn(result.body, 'panoUrl'));
    if (expected === -1) assert.equal(result.body.statusLabel, raw);
  });
}

for (const progress of [0, 0.42, 1, -0.1, 1.1, '0.5', null, false, NaN, Infinity]) {
  test(`World progress ${String(progress)} is only forwarded for finite numbers in 0..1`, async t => {
    const f = await fixture(t, () => ({ ok: true, json: async () => ({ status: 'RUNNING', progress }) }));
    const result = await f.request('/world?worldId=abc');
    const valid = typeof progress === 'number' && Number.isFinite(progress) && progress >= 0 && progress <= 1;
    assert.equal(Object.hasOwn(result.body, 'progress'), valid);
    if (valid) assert.equal(result.body.progress, progress);
  });
}

for (const value of [
  'http://cdn.example.test/a.ply', 'javascript:alert(1)', 'data:image/png;base64,abc', '//cdn.example.test/a.ply',
  'https://user:pass@cdn.example.test/a.ply', 'https://localhost/a.ply', 'https://x.localhost/a.ply',
  'https://127.0.0.1/a.ply', 'https://2130706433/a.ply', 'https://10.0.0.1/a.ply', 'https://[::1]/a.ply',
  'https://host.local/a.ply', 'https://intranet/a.ply', 'https://cdn.example.test/white space',
  'https://cdn.example.test\\@localhost/a.ply', 'https://', null, 123,
]) {
  test(`unsafe output URL filtered: ${String(value)}`, async t => {
    const f = await fixture(t, () => response({ status: 'SUCCEEDED', assets: {
      splats: { urls: { plyPath: value, spzPath: value, lodMetaPath: value } }, imagery: { panoUrl: value },
    } }));
    const result = await f.request('/world?worldId=abc');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.outputs, []);
    assert.ok(!Object.hasOwn(result.body, 'panoUrl'));
  });
}

for (const origin of [
  'https://evil.example', 'null', '', 'http://localhost.evil.example:5173', 'http://127.0.0.1.evil.example',
  'file://localhost', 'http://localhost@evil.example', 'http://localhost:65536', 'http://localhost:0',
  'http://localhost/', 'http://localhost:5173, https://evil.example',
]) {
  test(`untrusted Origin rejected before all routes: ${JSON.stringify(origin)}`, async t => {
    const f = await fixture(t);
    for (const [path, method, body] of [
      ['/text-to-3d', 'POST', { prompt: 'chair' }], ['/image-to-3d', 'POST', { img: PNG }],
      ['/world', 'POST', { name: 'world', prompt: 'forest' }], ['/task?taskid=abc', 'GET'],
      ['/world?worldId=abc', 'GET'], ['/health', 'GET'], ['/world', 'OPTIONS'],
    ]) {
      const result = await f.request(path, { method, body, headers: { Origin: origin } });
      assert.equal(result.status, 403);
      assert.equal(result.headers['access-control-allow-origin'], undefined);
    }
    assert.equal(f.calls.length, 0);
  });
}

for (const host of ['evil.example', 'localhost.evil.example', 'localhost@evil.example', '127.1', '[::1]', 'localhost:65536', 'localhost:0', 'localhost.', '']) {
  test(`untrusted Host rejected even with trusted Origin: ${JSON.stringify(host)}`, async t => {
    const f = await fixture(t);
    for (const method of ['POST', 'GET', 'OPTIONS']) {
      // 禁止 Node 客户端把空 Host 自动补成本机 Host。
      const result = await f.request('/world', { method, setHost: false, headers: { Host: host, Origin: 'http://localhost:5173' },
        ...(method === 'POST' ? { body: { name: 'world', prompt: 'forest' } } : {}) });
      assert.equal(result.status, 403);
      assert.equal(result.headers['access-control-allow-origin'], undefined);
    }
    assert.equal(f.calls.length, 0);
  });
}

test('missing and duplicate Host/Origin cannot bypass origin validation', async t => {
  const f = await fixture(t);
  for (const headers of [
    ['Host', 'localhost', 'Host', 'evil.example'],
    ['Host', 'localhost', 'Origin', 'http://localhost', 'Origin', 'https://evil.example'],
  ]) {
    assert.equal((await f.request('/health', { headers })).status, 403);
  }
  // Node itself may reject a missing HTTP/1.1 Host before invoking the handler.
  assert.ok([400, 403].includes((await f.request('/health', { setHost: false })).status));
  assert.equal(f.calls.length, 0);
});

for (const origin of ['http://localhost', 'https://localhost:5173', 'http://127.0.0.1:3000', 'https://127.0.0.1']) {
  test(`local Origin ${origin}: health and preflight work without a key`, async t => {
    const f = await fixture(t, undefined, { key: '' });
    const result = await f.request('/health', { headers: { Origin: origin, Host: 'localhost:3199' } });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, keyConfigured: false, base: LUX, worldBase: WORLD });
    assert.equal(result.headers['access-control-allow-origin'], origin);
    assert.equal(result.headers['cache-control'], 'no-store');
    const preflight = await f.request('/image-to-3d', { method: 'OPTIONS', headers: { Origin: origin,
      'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], origin);
    assert.equal(preflight.headers['access-control-allow-methods'], 'GET,POST,OPTIONS');
    assert.equal(preflight.headers['access-control-allow-headers'], 'Content-Type');
    assert.equal(f.calls.length, 0);
  });
}

test('no-Origin CLI GET and JSON POST are allowed; form POST is blocked', async t => {
  const f = await fixture(t, () => luxResponse('abc'));
  const health = await f.request('/health');
  assert.equal(health.status, 200);
  assert.equal(health.headers['access-control-allow-origin'], undefined);
  assert.equal((await f.request('/text-to-3d', { method: 'POST', body: { prompt: 'chair' } })).status, 200);
  assert.equal((await f.request('/text-to-3d', { method: 'POST', body: 'prompt=chair', headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
  } })).status, 415);
  assert.equal(f.calls.length, 1);
});

for (const [path, body, expected] of [
  ['/text-to-3d', {}, 400], ['/text-to-3d', { prompt: null }, 400], ['/text-to-3d', { prompt: 12 }, 400],
  ['/text-to-3d', { prompt: {} }, 400], ['/text-to-3d', { prompt: ' \n ' }, 400],
  ['/text-to-3d', { prompt: 'x'.repeat(4001) }, 400], ['/text-to-3d', { prompt: 'hello\u0000world' }, 400],
  ['/world', { prompt: 'forest' }, 400], ['/world', { name: 'world' }, 400],
  ['/world', { name: 1, prompt: 'forest' }, 400], ['/world', { name: ' '.repeat(10), prompt: 'forest' }, 400],
  ['/world', { name: 'x'.repeat(129), prompt: 'forest' }, 400],
  ['/world', { name: 'world', prompt: 'x'.repeat(4001) }, 400],
  ['/image-to-3d', {}, 400], ['/image-to-3d', { img: 123 }, 400],
  ['/image-to-3d', { img: 'https://127.0.0.1/private.png' }, 400],
  ['/image-to-3d', { img: 'data:image/gif;base64,R0lGODlh' }, 415],
  ['/image-to-3d', { img: 'data:image/svg+xml;base64,PHN2Zz4=' }, 415],
  ['/image-to-3d', { img: 'data:image/png,raw' }, 400],
  ['/image-to-3d', { img: 'data:image/png;base64,' }, 400],
  ['/image-to-3d', { img: 'data:image/png;base64,!!!!' }, 400],
  ['/image-to-3d', { img: 'data:image/png;base64,iVBORw0KGgo' }, 400],
  ['/image-to-3d', { img: 'data:image/png;base64,iVBO Rw0KGgo=' }, 400],
  ['/image-to-3d', { img: 'data:image/png;base64,iVBORw0KGgp=' }, 400], // noncanonical padding bits
  ['/image-to-3d', { img: 'data:image/png;base64,=VBORw0KGgo=' }, 400],
  ['/image-to-3d', { img: JPEG.replace('image/jpeg', 'image/png') }, 415],
  ['/image-to-3d', { img: PNG.replace('image/png', 'image/jpeg') }, 415],
  ['/image-to-3d', { img: 'data:image/png;base64,aGVsbG8=' }, 415],
]) {
  test(`invalid input ${path}: ${JSON.stringify(body).slice(0, 100)}`, async t => {
    const f = await fixture(t);
    const result = await f.request(path, { method: 'POST', body });
    assert.equal(result.status, expected);
    assert.equal(typeof result.body.error, 'string');
    assert.equal(f.calls.length, 0);
  });
}

for (const raw of ['', '{broken', 'null', '[]', 'true', '123', '"prompt"', Buffer.from([0xff, 0xfe])]) {
  test(`malformed JSON object rejected: ${String(raw)}`, async t => {
    const f = await fixture(t);
    assert.equal((await f.request('/text-to-3d', { method: 'POST', body: raw })).status, 400);
    assert.equal(f.calls.length, 0);
  });
}

for (const headers of [
  { 'Content-Type': '' }, { 'Content-Type': 'text/plain' }, { 'Content-Type': 'application/jsonp' },
  { 'Content-Type': 'application/json; charset=latin1' }, { 'Content-Encoding': 'gzip' },
]) {
  test(`unsupported body encoding ${JSON.stringify(headers)}`, async t => {
    const f = await fixture(t);
    assert.equal((await f.request('/text-to-3d', { method: 'POST', body: { prompt: 'chair' }, headers })).status, 415);
    assert.equal(f.calls.length, 0);
  });
}

for (const route of ['task', 'world']) {
  test(`${route} rejects missing, repeated, overlong and path-like identifiers`, async t => {
    const field = route === 'task' ? 'taskid' : 'worldId';
    const f = await fixture(t);
    for (const suffix of ['', `?${field}=`, `?${field}=a&${field}=b`, `?${field}=${'a'.repeat(129)}`,
      `?${field}=a%2Fb`, `?${field}=..`, `?${field}=a%3Fb`, `?${field}=a%23b`, `?${field}=%00`, `?${field}=%20abc`]) {
      assert.equal((await f.request(`/${route}${suffix}`)).status, 400, suffix);
    }
    assert.equal(f.calls.length, 0);
  });
}

test('exact text/name/ID limits and UTF-8 JSON charset accepted', async t => {
  const f = await fixture(t, () => response({ worldId: 'a'.repeat(128) }));
  const result = await f.request('/world', { method: 'POST', body: { name: '名'.repeat(128), prompt: '文'.repeat(4000) },
    headers: { 'Content-Type': 'application/json; charset="utf-8"' } });
  assert.equal(result.status, 200);
  assert.equal(result.body.taskid.length, 128);
});

for (const size of [5 * MIB, 5 * MIB + 1, 5 * MIB + 4]) {
  test(`image decoded size ${size}: exact 5 MiB accepted, larger rejected`, async t => {
    const bytes = Buffer.alloc(size);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
    const f = await fixture(t, () => luxResponse('image-task'));
    const result = await f.request('/image-to-3d', { method: 'POST', body: { img: `data:image/png;base64,${bytes.toString('base64')}` } });
    assert.equal(result.status, size === 5 * MIB ? 200 : 413);
    assert.equal(f.calls.length, size === 5 * MIB ? 1 : 0);
  });
}

test('Content-Length above 7 MiB is rejected before reading the body', async t => {
  const f = await fixture(t);
  const result = await f.request('/image-to-3d', { method: 'POST', body: '{}', headers: { 'Content-Length': 7 * MIB + 1 } });
  assert.equal(result.status, 413);
  assert.equal(f.calls.length, 0);
});

test('chunked body cannot bypass the 7 MiB limit; exact limit is accepted', async t => {
  const f = await fixture(t, () => luxResponse('abc'));
  const body = JSON.stringify({ prompt: 'chair' }).padEnd(7 * MIB, ' ');
  assert.equal((await f.request('/text-to-3d', { method: 'POST', body, chunked: true })).status, 200);
  assert.equal((await f.request('/text-to-3d', { method: 'POST', body: `${body} `, chunked: true })).status, 413);
  assert.equal(f.calls.length, 1);
});

for (const [label, responder, expected] of [
  ['HTTP failure', () => new Response(KEY, { status: 401, statusText: KEY }), 502],
  ['Lux error envelope', () => response({ c: KEY, m: KEY }), 502],
  ['numeric Lux code is not the agreed string code', () => response({ c: 0, d: 'abc' }), 502],
  ['invalid JSON', () => new Response(`not JSON ${KEY}`), 502],
  ['null JSON', () => response(null), 502],
  ['network rejection', () => { throw new Error(`connection failed: ${KEY}`); }, 502],
  ['timeout', () => { throw new DOMException(KEY, 'TimeoutError'); }, 504],
  ['aborted request', () => { throw new DOMException(KEY, 'AbortError'); }, 504],
  ['redirect is not followed', (_url, init) => {
    assert.equal(init.redirect, 'error');
    return new Response(null, { status: 302, headers: { Location: `https://evil.example/${KEY}` } });
  }, 502],
]) {
  test(`${label}: safe error, no secret or automatic retries`, async t => {
    const f = await fixture(t, responder);
    const result = await f.request('/text-to-3d', { method: 'POST', body: { prompt: 'chair' } });
    assert.equal(result.status, expected);
    assert.equal(typeof result.body.error, 'string');
    assert.ok(!result.text.includes(KEY));
    assert.equal(f.calls.length, 1);
  });
}

for (const [path, method, body, upstream] of [
  ['/world', 'POST', { name: 'world', prompt: 'forest' }, { c: 'bad', m: KEY, d: { worldId: 'abc' } }],
  ['/world', 'POST', { name: 'world', prompt: 'forest' }, { operationId: 'not-a-world-id' }],
  ['/world', 'POST', { name: 'world', prompt: 'forest' }, { worldId: 123 }],
  ['/world', 'POST', { name: 'world', prompt: 'forest' }, { worldId: '../bad' }],
  ['/text-to-3d', 'POST', { prompt: 'chair' }, { c: '0', d: {} }],
  ['/image-to-3d', 'POST', { img: PNG }, { c: '0', d: null }],
  ['/world?worldId=abc', 'GET', undefined, { data: { error: KEY } }],
  ['/world?worldId=abc', 'GET', undefined, { data: [] }],
  ['/task?taskid=abc', 'GET', undefined, { c: '0', d: null }],
  ['/task?taskid=abc', 'GET', undefined, { c: '0', d: { error: KEY } }],
]) {
  test(`invalid upstream response ${method} ${path}: ${JSON.stringify(upstream)}`, async t => {
    const f = await fixture(t, () => response(upstream));
    const result = await f.request(path, { method, body });
    assert.equal(result.status, 502);
    assert.ok(!result.text.includes(KEY));
    assert.equal(f.calls.length, 1);
  });
}

test('key is redacted even if upstream reflects it into selected success fields', async t => {
  const key = 'fake-secret+/=';
  const f = await fixture(t, () => response({ status: `NEW_${key}`, assets: {
    splats: { urls: { plyPath: `https://cdn.example.test/a.ply?token=${encodeURIComponent(key)}` } },
  } }), { key });
  const result = await f.request('/world?worldId=abc');
  assert.equal(result.status, 200);
  assert.equal(result.body.status, -1);
  assert.ok(!result.text.includes(key));
  assert.ok(!result.text.includes(encodeURIComponent(key)));
  assert.ok(result.text.includes('[REDACTED]'));
});

test('missing key fails locally on all paid routes; health remains available', async t => {
  const f = await fixture(t, undefined, { key: '' });
  for (const [path, body] of [['/text-to-3d', { prompt: 'chair' }], ['/image-to-3d', { img: PNG }],
    ['/world', { name: 'world', prompt: 'forest' }], ['/task?taskid=abc'], ['/world?worldId=abc']]) {
    const result = await f.request(path, { method: body ? 'POST' : 'GET', body });
    assert.equal(result.status, 500);
  }
  assert.equal((await f.request('/health')).status, 200);
  assert.equal(f.calls.length, 0);
});

test('pending upstream creation does not block health or origin checks', async t => {
  let release;
  let signalStarted;
  const pendingUpstream = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { signalStarted = resolve; });
  const f = await fixture(t, async () => {
    signalStarted();
    await pendingUpstream;
    return luxResponse('async-task');
  });
  const pendingRequest = f.request('/text-to-3d', { method: 'POST', body: { prompt: 'chair' } });
  try {
    await started;
    assert.equal((await f.request('/health')).status, 200);
    assert.equal((await f.request('/world', { method: 'POST', body: { name: 'world', prompt: 'forest' },
      headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal(f.calls.length, 1);
  } finally {
    release();
    assert.equal((await pendingRequest).status, 200);
  }
});

test('unknown routes/methods and absolute request targets never reach upstream', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/unknown')).status, 404);
  assert.equal((await f.request('/text-to-3d')).status, 404);
  assert.equal((await f.request('/world', { method: 'DELETE' })).status, 404);
  assert.equal((await f.request('https://evil.example/world')).status, 400);
  assert.equal((await f.request('//evil.example/world')).status, 400);
  assert.equal(f.calls.length, 0);
});

for (const base of ['http://api.example.test', 'https://user:secret@api.example.test', 'https://api.example.test?token=x', 'https://api.example.test#fragment']) {
  test(`unsafe configured gateway rejected: ${base}`, () => {
    assert.throws(() => createServer({ base }), /HTTPS URL/);
    assert.throws(() => createServer({ worldBase: base }), /HTTPS URL/);
  });
}

// ---- 产物落盘：签名链接进，本机稳定地址出 ----
const COS = 'https://aholo-cdn.cos.ap-guangzhou.myqcloud.com/lux3d/4475964/MODEL.glb';
const glb = (extra = Buffer.alloc(0)) => {
  const head = Buffer.alloc(12);
  head.write('glTF', 0, 'latin1');
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + extra.length, 8);
  return Buffer.concat([head, extra]);
};
const SPZ = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02]);
const PLY = Buffer.from('ply\r\nformat binary_little_endian 1.0\r\n');
const streamOf = chunks => new ReadableStream({ start(c) { chunks.forEach(chunk => c.enqueue(chunk)); c.close(); } });

function memoryStore() {
  const files = new Map();
  return {
    files,
    save: async (id, ext, bytes) => { files.set(`${id}.${ext}`, bytes); },
    read: async (id, ext) => files.get(`${id}.${ext}`) ?? null,
  };
}

test('POST /asset 按魔数识别 GLB/SPZ/PLY 并落盘，回源地址是本机相对路径', async t => {
  for (const [name, bytes, kind] of [['glb', glb(Buffer.from('mesh')), 'glb'], ['spz', SPZ, 'spz'], ['ply', PLY, 'ply']]) {
    const store = memoryStore();
    const f = await fixture(t, () => new Response(bytes), { assets: store });
    const result = await f.request('/asset', { method: 'POST', body: { url: COS }, headers: { Origin: 'http://localhost:3000' } });
    assert.equal(result.status, 200, result.text);
    assert.match(result.body.url, new RegExp(`^/asset/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.${kind}$`));
    assert.deepEqual({ kind: result.body.kind, bytes: result.body.bytes }, { kind, bytes: bytes.length });
    assert.equal(result.body.assetId, result.body.url.slice('/asset/'.length, -kind.length - 1));
    // 取产物用的是公共 CDN 链接，绝不带 Aholo 密钥；密钥也不出现在响应里。
    assert.equal(f.calls[0].init.headers, undefined);
    assert.equal(result.text.includes(KEY), false);
    assert.equal(store.files.get(`${result.body.assetId}.${kind}`).equals(bytes), true);
  }
});

test('GET /asset/<id> 原样回源字节，带类型、CORS 与不可变缓存', async t => {
  const store = memoryStore();
  const f = await fixture(t, () => new Response(glb()), { assets: store });
  const saved = (await f.request('/asset', { method: 'POST', body: { url: COS }, headers: { Origin: 'http://localhost:3000' } })).body;
  const loaded = await f.request(saved.url, { headers: { Origin: 'http://localhost:3000' }, raw: true });
  assert.equal(loaded.status, 200);
  assert.equal(loaded.bytes.equals(glb()), true);
  assert.deepEqual([loaded.headers['content-type'], loaded.headers['content-length']], ['model/gltf-binary', '12']);
  assert.equal(loaded.headers['access-control-allow-origin'], 'http://localhost:3000');
  assert.match(loaded.headers['cache-control'], /immutable/);
  assert.equal(loaded.headers['x-content-type-options'], 'nosniff');
});

test('落盘上限分两种：物件 GLB 守 10 MiB，3DGS 场景包收到 150 MiB', async t => {
  const glbStore = memoryStore();
  const fat = await fixture(t, () => new Response(glb(Buffer.alloc(11 * MIB))), { assets: glbStore });
  const over = await fat.request('/asset', { method: 'POST', body: { url: COS } });
  assert.deepEqual([over.status, over.body], [413, { error: 'GLB 超过 10 MiB，未落盘' }]);
  assert.equal(glbStore.files.size, 0);

  // 场景包本来就有几十 MB，超过旧的 10 MiB 门槛也必须落得下。
  const splatStore = memoryStore();
  const room = await fixture(t, () => new Response(Buffer.concat([SPZ, Buffer.alloc(20 * MIB)])), { assets: splatStore });
  assert.equal((await room.request('/asset', { method: 'POST', body: { url: COS } })).status, 200);
  assert.equal(splatStore.files.size, 1);

  const declared = memoryStore();
  const huge = await fixture(t, () => new Response(streamOf([Buffer.alloc(MIB)]), { headers: { 'Content-Length': String(151 * MIB) } }), { assets: declared });
  const tooBig = await huge.request('/asset', { method: 'POST', body: { url: COS } });
  assert.deepEqual([tooBig.status, tooBig.body], [413, { error: '产物超过 150 MiB，未落盘' }]);
  assert.equal(declared.files.size, 0);
});

test('非 https、本机地址、带凭据均直接拒绝且不发请求；魔数不符与上游失败不落盘', async t => {
  const store = memoryStore();
  const f = await fixture(t, url => url.includes('boom') ?
    new Response('nope', { status: 404 }) :
    new Response(streamOf([Buffer.from('<html>登录页</html>')])), { assets: store });
  for (const url of ['http://cdn.example.test/a.glb', 'https://127.0.0.1:3199/a.glb', 'https://localhost/a.glb',
    'https://', 'https://user:pw@cdn.example.test/a.glb', 'https://cdn.example.test\\a.glb', 'not-a-url', '', undefined]) {
    assert.equal((await f.request('/asset', { method: 'POST', body: { url } })).status, 400, String(url));
  }
  assert.equal((await f.request('/asset', { method: 'POST', body: {} })).status, 400);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.request('/asset', { method: 'POST', body: { url: 'https://cdn.example.test/b.bin' } })).status, 415);
  assert.equal((await f.request('/asset', { method: 'POST', body: { url: 'https://cdn.example.test/boom.glb' } })).status, 502);
  assert.equal(store.files.size, 0);
  assert.equal(f.calls.every(call => call.init.headers === undefined), true);
});

test('资产地址只认 UUID + 白名单后缀：未知 ID 404、穿越与畸形 400、非 GET 405', async t => {
  const store = memoryStore();
  const f = await fixture(t, () => new Response(glb()), { assets: store });
  const saved = (await f.request('/asset', { method: 'POST', body: { url: COS } })).body;
  const id = saved.assetId;
  const cases = [
    ['/asset/00000000-0000-4000-8000-000000000000.glb', 404],
    [`/asset/${id}.exe`, 400],
    [`/asset/${id.toUpperCase()}.glb`, 400],
    [`/asset/${id}.glb.glb`, 400],
    [`/asset/${id}`, 400],
    [`/asset/${id}/../../etc/passwd`, 404],
    ['/asset/../../etc/passwd.glb', 404],
    ['//asset/' + id + '.glb', 400],
  ];
  for (const [path, status] of cases) assert.equal((await f.request(path, { raw: true })).status, status, path);
  assert.equal((await f.request(saved.url, { method: 'POST', body: { url: COS } })).status, 405);
  assert.equal((await f.request('/asset', { method: 'GET' })).status, 404);
});

test('落盘目录不可写时返回 500 且不泄漏堆栈文本', async t => {
  const f = await fixture(t, () => new Response(glb()), { assets: { save: async () => { throw new Error('EACCES secret-path'); }, read: async () => null } });
  const result = await f.request('/asset', { method: 'POST', body: { url: COS } });
  assert.deepEqual([result.status, result.body], [500, { error: '代理请求失败' }]);
  assert.equal(result.text.includes('secret-path'), false);
});

// 子进程内替换内置 fs/http 导出；即使执行入口分支，也不会读真实 .env 或监听任何端口。
function sandboxEntry(mode) {
  const scriptUrl = new URL('./lux3d-dev-proxy.mjs', import.meta.url).href;
  const source = `
    import fs from 'node:fs/promises';
    import http from 'node:http';
    import { Readable } from 'node:stream';
    import { syncBuiltinESMExports } from 'node:module';
    const mode = ${JSON.stringify(mode)};
    const state = { reads: [], listened: null, created: 0 };
    let handleRequest;
    fs.readFile = async path => {
      state.reads.push(String(path));
      if (mode === 'missing') throw new Error('not found');
      return 'OTHER_KEY=ignored\\n LUX3D_API_KEY = "fixture-file-key=="\\r\\n';
    };
    globalThis.fetch = async (url, init) => {
      state.authMatches = init.headers.Authorization === (mode === 'env' ? 'fixture-env-key' : 'fixture-file-key==');
      state.upstream = url;
      return new Response(JSON.stringify({ worldId: 'sandbox-world' }));
    };
    http.createServer = (_options, handler) => {
      state.created++;
      handleRequest = handler;
      return { listen(port, host, callback) { state.listened = { port, host }; callback(); } };
    };
    syncBuiltinESMExports();
    delete process.env.LUX3D_API_KEY;
    delete process.env.LUX3D_PROXY_PORT;
    delete process.env.LUX3D_BASE_URL;
    delete process.env.AHOLO_WORLD_BASE_URL;
    if (mode === 'env') {
      process.env.LUX3D_API_KEY = 'fixture-env-key';
      process.env.LUX3D_PROXY_PORT = '3201';
      process.env.LUX3D_BASE_URL = 'https://lux.example.test/custom';
      process.env.AHOLO_WORLD_BASE_URL = 'https://world.example.test/custom';
    }
    if (mode === 'empty') process.env.LUX3D_API_KEY = '';
    if (mode === 'import') process.argv[1] = 'not-the-entry.mjs';
    const messages = [];
    console.log = message => messages.push(message);
    await import(${JSON.stringify(scriptUrl)});
    if (handleRequest) {
      for (const [method, url] of [['GET', '/health'], ['POST', '/world']]) {
        const req = Readable.from([Buffer.from(JSON.stringify({ name: 'world', prompt: 'forest' }))]);
        Object.assign(req, { method, url, rawHeaders: ['Host', 'localhost'], headers: {
          host: 'localhost', 'content-type': 'application/json',
        } });
        const res = {
          writeHead(code) { state.lastStatus = code; this.headersSent = true; },
          end(json) { if (url === '/health') state.health = JSON.parse(json); },
        };
        await handleRequest(req, res);
      }
    }
    process.stdout.write(JSON.stringify({ ...state, messages }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source, fileURLToPath(scriptUrl)], {
    cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('import has no .env read, server creation or startup log', () => {
  assert.deepEqual(sandboxEntry('import'), { reads: [], listened: null, created: 0, messages: [] });
});

test('direct entry resolves root env relative to import.meta.url, not cwd; binds only loopback', () => {
  const state = sandboxEntry('file');
  assert.deepEqual(state.reads, [new URL('../../.env.local', import.meta.url).href]);
  assert.deepEqual(state.listened, { port: 3199, host: '127.0.0.1' });
  assert.equal(state.created, 1);
  assert.equal(state.authMatches, true);
  assert.equal(state.lastStatus, 200);
  assert.equal(state.upstream, `${WORLD}/world/v1/generations`);
  assert.match(state.messages[0], /已读到/);
  assert.ok(!JSON.stringify(state).includes('fixture-file-key'));
});

for (const mode of ['env', 'empty', 'missing']) {
  test(`entry key precedence and missing-file handling: ${mode}`, () => {
    const state = sandboxEntry(mode);
    assert.equal(state.reads.length, mode === 'missing' ? 1 : 0);
    assert.match(state.messages[0], mode === 'env' ? /已读到/ : /缺失/);
    if (mode === 'env') {
      assert.deepEqual(state.listened, { port: 3201, host: '127.0.0.1' });
      assert.equal(state.authMatches, true);
      assert.equal(state.lastStatus, 200);
      assert.equal(state.upstream, 'https://world.example.test/custom/world/v1/generations');
      assert.equal(state.health.base, 'https://lux.example.test/custom');
      assert.equal(state.health.worldBase, 'https://world.example.test/custom');
    } else {
      assert.equal(state.lastStatus, 500);
      assert.equal(state.health.keyConfigured, false);
      assert.equal(state.upstream, undefined);
    }
    assert.ok(!JSON.stringify(state).includes('fixture-env-key'));
  });
}
