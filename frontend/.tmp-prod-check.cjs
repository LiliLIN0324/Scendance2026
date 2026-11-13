const BASE = 'https://scendance-scene-planner-ewz.pages.dev';
const MARKER = '删除本机归档的'; // 归档右键删除确认文案（本批次产品级标记）
(async () => {
  const home = await fetch(BASE + '/');
  const html = await home.text();
  const scripts = [...html.matchAll(/src="([^"]*\/_next\/static\/[^"]+\.js)"/g)].map(m => m[1]);
  console.log('status:', home.status, 'html bytes:', html.length, 'scripts:', scripts.length);
  let hit = null;
  for (const s of scripts) {
    const url = s.startsWith('http') ? s : BASE + s;
    const t = await (await fetch(url)).text();
    if (t.includes(MARKER)) { hit = s.split('/').pop().slice(0, 50); break; }
  }
  console.log('marker:', hit ? 'FOUND in ' + hit : 'not found — old build still active or build in progress');
})().catch(e => console.log('FETCH FAIL:', e.message));
