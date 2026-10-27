import { readFileSync } from 'node:fs';
const line = readFileSync('.env.local', 'utf8').split('\n').find(l => l.startsWith('LUX3D_API_KEY='));
const KEY = line.split('=').slice(1).join('=').trim();
const CN = 'https://api.aholo3d.cn';
// 探 1:国内网关 world 创建
const w = await fetch(`${CN}/world/v1/generations`, {
  method: 'POST',
  headers: { Authorization: KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Scendance-M3-MVP', prompt: '室内活动场地，温暖灯光，圆桌与椅子' }),
});
console.log('CN world create:', w.status);
console.log((await w.text()).slice(0, 400));
// 探 2:国内网关 lux3d 任务列表(只读)
const l = await fetch(`${CN}/lux3d/v1/generate/task/list`, { headers: { Authorization: KEY } });
console.log('CN lux3d list:', l.status, (await l.text()).slice(0, 200));
