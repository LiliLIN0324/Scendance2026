// 探查 LUX3D 动作库里到底有哪些 id —— 零成本。
//
// 原理：retarget 的 create 接口会顺序校验 animationIds，遇到未知 id 立刻整单拒绝。
// 于是每次提交 [候选, 哨兵]：哨兵是保证不存在的名字，
//   - 报错点名候选 → 候选不在库里
//   - 报错点名哨兵 → 候选通过校验（说明库里真有）
// 因为整单必然失败，不会生成任务、不扣 credits。
//
// 用法：
//   node tools/aholo/probe-animation-ids.mjs                        # 默认候选表
//   node tools/aholo/probe-animation-ids.mjs --words Sit,Seated,SitDown
//   node tools/aholo/probe-animation-ids.mjs --proxy http://127.0.0.1:3200
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const proxy = option('proxy', 'http://127.0.0.1:3200').replace(/\/+$/, '');
const rig = option('rig', 'https://pub-048147e4c4ad482d95df092dc8098e1d.r2.dev/people/7a9f1e21-8c34-4d51-a001-b00000000001.glb');
const sentinel = '__probe_no_such_clip__';
const explicit = option('words', '');

// 默认候选：坐姿语义 × 常见命名风格；外加已知可用的 Idle_Loop 做阳性对照。
const candidates = explicit
  ? explicit.split(',').map(word => word.trim()).filter(Boolean)
  : [
    'Idle_Loop', 'Walk_Loop', // 阳性对照，必须报「有效」
    'Sit', 'Sit_Loop', 'Sit_Idle', 'Sit_Idle_Loop', 'SitIdle_Loop', 'Sit_Pose',
    'Sitting', 'Sitting_Loop', 'Sitting_Idle', 'Sitting_Idle_Loop', 'Seated_Idle', 'Seated_Idle_Loop',
    'Sit_Down', 'SitDown', 'Sit_Down_Loop', 'Sit_To_Stand', 'SitToStand', 'Stand_To_Sit', 'Stand_Up', 'StandUp',
    'Sit_Chair', 'Sit_Chair_Loop', 'Chair_Sit', 'Chair_Sit_Loop', 'Sit_On_Chair', 'Sit_On_Chair_Loop',
    'Sit_Floor', 'Sit_Cross_Legged', 'Sit_And_Stand', 'Sit_And_Stand_Up',
    'Idle_Talking_Loop', 'Talk_Loop', // 交谈，看命名是否统一 _Loop
  ];

const unknownOf = text => {
  const match = /unknown animation_id:\s*([^"}\s]+)/.exec(text);
  return match ? match[1] : '';
};

const valid = [];
console.log(`${'候选'.padEnd(24)} 结论`);
console.log('-'.repeat(48));
for (const candidate of candidates) {
  let text = '';
  try {
    const response = await fetch(`${proxy}/retarget`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rigModelUrl: rig, animationIds: [candidate, sentinel] }),
    });
    text = await response.text();
  } catch (error) {
    console.log(`${candidate.padEnd(24)} 请求失败：${error.message}`);
    continue;
  }
  const unknown = unknownOf(text);
  if (text.includes(sentinel)) {
    valid.push(candidate);
    console.log(`${candidate.padEnd(24)} 有效 ✅`);
  } else if (unknown === candidate) {
    console.log(`${candidate.padEnd(24)} 不存在`);
  } else {
    console.log(`${candidate.padEnd(24)} 其它响应：${text.slice(0, 140)}`);
  }
  await new Promise(resolve => setTimeout(resolve, 400));
}

console.log(`\n有效 id：${valid.length ? valid.join(', ') : '（无）'}`);
if (!valid.includes('Idle_Loop')) {
  console.log('警告：阳性对照 Idle_Loop 都没通过，说明哨兵法不成立，结论不可信。');
}
