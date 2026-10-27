const base = 'http://localhost:3099/functions/v1/scene-api';
const create = await (await fetch(base + '/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: '验证圆桌', requestId: crypto.randomUUID(), provider: 'aholo' }) })).json();
console.log('create:', create.state, create.provider_mode, create.provider_model);
let job = create;
for (let i = 0; i < 6 && job.state !== 'ready'; i++) {
  await new Promise(r => setTimeout(r, 300));
  job = await (await fetch(base + '/jobs/' + create.id)).json();
  console.log('poll', i, job.state);
}
const url = await (await fetch(base + '/assets/' + job.asset_id + '/url', { method: 'POST' })).json();
console.log('authorize:', url.url.slice(0, 60));
const added = await (await fetch(base + '/jobs/' + create.id + '/added', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'p' }) })).json();
console.log('added:', added.state);
const list = await (await fetch(base + '/jobs')).json();
console.log('list:', list.length, 'item:', list[0].state);
