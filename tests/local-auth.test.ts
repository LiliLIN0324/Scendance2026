import { expect, it } from 'vitest';
import { startLocalServer, testAccounts, testPublicKey } from './local-server.ts';

it('restores a local browser session through user lookup and rejects revoked sessions', async () => {
  const server = await startLocalServer();
  try {
    const login = await fetch(`${server.url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: testPublicKey, 'Content-Type': 'application/json' }, body: JSON.stringify(testAccounts[0]) });
    const session = await login.json();
    const headers = { apikey: testPublicKey, Authorization: `Bearer ${session.access_token}` };
    const user = await fetch(`${server.url}/auth/v1/user`, { headers });
    expect(user.status).toBe(200);
    expect(await user.json()).toEqual({ id: testAccounts[0]!.id, email: testAccounts[0]!.email });
    await fetch(`${server.url}/auth/v1/logout`, { method: 'POST', headers });
    expect((await fetch(`${server.url}/auth/v1/user`, { headers })).status).toBe(401);
  } finally { await server.close(); }
}, 30000);

it('allows the Supabase client auth preflight only for the configured loopback origin',async()=>{
  const origin='http://127.0.0.1:8582',server=await startLocalServer(0,undefined,{origins:[origin]});
  try{
    const requestHeaders='apikey,authorization,content-type,x-client-info,x-supabase-api-version';
    for(const route of ['/auth/v1/token?grant_type=password','/functions/v1/scene-api/brief/extract']){
      const preflight=await fetch(`${server.url}${route}`,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':requestHeaders}});
      expect(preflight.status).toBe(204);expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
      const allowed=(preflight.headers.get('access-control-allow-headers')??'').toLowerCase().split(',').map(value=>value.trim());
      for(const header of requestHeaders.split(','))expect(allowed).toContain(header);
      expect(allowed).not.toContain('x-arbitrary-private-header');
    }
    const denied=await fetch(`${server.url}/auth/v1/token?grant_type=password`,{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:9999','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':requestHeaders}});
    expect(denied.status).toBe(403);expect(denied.headers.get('access-control-allow-origin')).toBeNull();
    const login=await fetch(`${server.url}/auth/v1/token?grant_type=password`,{method:'POST',headers:{Origin:origin,apikey:testPublicKey,'Content-Type':'application/json','x-client-info':'fixture','x-supabase-api-version':'2024-01-01'},body:JSON.stringify(testAccounts[0])});
    expect(login.status).toBe(200);expect(login.headers.get('access-control-allow-origin')).toBe(origin);
  }finally{await server.close();}
},30000);
