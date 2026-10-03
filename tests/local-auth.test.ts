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
