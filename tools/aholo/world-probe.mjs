import { readFileSync } from 'node:fs';
const line = readFileSync('.env.local', 'utf8').split('\n').find(l => l.startsWith('LUX3D_API_KEY='));
const KEY = line.split('=').slice(1).join('=').trim();
const BASE = 'https://api.aholo.ai/global';
const tokenRes = await fetch(`${BASE}/asset/v1/token`, { headers: { Authorization: KEY } });
console.log('asset token status:', tokenRes.status);
const tokenBody = await tokenRes.text();
console.log(tokenBody.slice(0, 500));
try {
  const parsed = JSON.parse(tokenBody);
  const ous = parsed.d?.ousToken ?? parsed.ousToken ?? parsed.data?.ousToken;
  if (ous) {
    const gen = await fetch(`${BASE}/world/v1/generations`, {
      method: 'POST',
      headers: { Authorization: KEY, 'ous-token-v2': ous, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Scendance-M3-MVP', prompt: '室内活动场地，温暖灯光，圆桌与椅子' }),
    });
    console.log('retry status:', gen.status);
    console.log((await gen.text()).slice(0, 400));
  }
} catch (e) { console.log('parse skip:', String(e).slice(0, 120)); }
