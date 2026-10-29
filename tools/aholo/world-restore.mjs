import { readFileSync } from 'node:fs';
// 把已下载的世界产物重新落进本机代理（绕开 2h 签名过期），再写回浏览器注册表所需信息。
const KEY = readFileSync('.env.local', 'utf8').split('\n').find(l => l.startsWith('LUX3D_API_KEY=')).split('=').slice(1).join('=').trim();
const res = await fetch('https://api.aholo3d.cn/world/v1/3FO4K4QI6N4V', { headers: { Authorization: KEY } });
const detail = await res.json();
const d = detail.d ?? detail.data ?? detail;
const ply = d.assets?.splats?.urls?.plyPath;
const meta = d.assets?.splats?.urls?.lodMetaPath;
console.log('ply:', ply?.slice(0, 60));
for (const url of [ply, meta].filter(Boolean)) {
  const saved = await (await fetch('http://127.0.0.1:3199/asset', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, kind: 'world' }),
  })).json();
  console.log('saved:', JSON.stringify(saved));
}
