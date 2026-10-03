import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { startLocalServer } from './local-server.ts';
import { owner, studio, scene } from './fixtures.ts';

it('keeps isolated project and private source bytes across local API restarts', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'scendance-floorplan-'));
  let server: Awaited<ReturnType<typeof startLocalServer>> | undefined;
  try {
    server = await startLocalServer(0,undefined,{dataDirectory});
    const created = await server.rpc(owner,'projects.create',{studioId:studio,name:'Persistence test',scene:scene()});
    const bytes = new Uint8Array([10,20,30,40]);
    await server.backend.upload('owner/private/source.webp',bytes,'image/webp');
    await server.close(); server=undefined;
    server = await startLocalServer(0,undefined,{dataDirectory});
    const reopened = await server.rpc(owner,'projects.get',{projectId:created.id});
    expect(reopened.scene).toEqual(scene());
    expect(await server.backend.readSourceBytes('owner/private/source.webp')).toEqual(bytes);
    const response = await fetch(await server.backend.sign('owner/private/source.webp'));
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get('x-scendance-test-fixture')).toContain('test doubles');
  } finally { await server?.close(); await rm(dataDirectory,{recursive:true,force:true}); }
},30_000);
