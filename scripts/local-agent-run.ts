/** 本地智能建造联调：真实 scene-api + 迁移过的 PGlite + 本地模型桩。
 *
 * 模型桩只负责回放工具调用，不做任何真实推理：先 get_scene 读场景，再 submit_candidates 交一份方案。
 * run 的状态、call_count、progress、candidates 全部由真实 agent_rpc 记录，前端看到的是与线上一致的形状与真值。
 * 用途：在没有模型额度时验证「前端接线 → 真实轮数与步骤时间线 → 审校完成卡」这条链路。
 */
import { startLocalServer, testAccounts, testPublicKey } from '../tests/local-server.ts';
import { owner, studio, scene } from '../tests/fixtures.ts';
import { createLocalAgentModel } from './local-agent-model.ts';

const rawMode=process.env.LOCAL_BRIEF_STUB_MODE;
if(rawMode&&!['valid','invalid','slow'].includes(rawMode))throw new Error('LOCAL_BRIEF_STUB_MODE 仅支持 valid、invalid 或 slow。');
const rawDelay=process.env.LOCAL_BRIEF_STUB_DELAY_MS;
const delayMs=rawDelay===undefined?5000:Number(rawDelay);
if(!Number.isSafeInteger(delayMs)||delayMs<0||delayMs>130000)throw new Error('LOCAL_BRIEF_STUB_DELAY_MS 须为 0 至 130000 的整数。');
const stubModel=createLocalAgentModel({briefMode:(rawMode??'valid') as 'valid'|'invalid'|'slow',delayMs});

// 前端 dev 独立起在 loopback 端口（默认 3210），桩必须把该来源加入 CORS 白名单，
// 否则浏览器登录被跨域拦截（NetworkError）；保留历史默认端口兼容既有集成用法。
const webPort=Number(process.env.SCENDANCE_DEV_WEB_PORT ?? 3210);
const origins=[
  `http://127.0.0.1:${webPort}`,
  `http://localhost:${webPort}`,
  'http://127.0.0.1:3018',
  'http://localhost:3018',
  'http://localhost:3000',
];

const server = await startLocalServer(54329, stubModel, {fixtureKind:'agent-model-stub', origins});
await server.rpc(owner, 'projects.create', { studioId: studio, name: '智能建造联调项目', scene: scene() });
console.log('LOCAL AGENT FIXTURE: real API + migrated PGlite + stub model. Data resets on exit.');
console.log(`Local brief stub mode: ${rawMode??'valid'} (no real provider)`);
console.log(`NEXT_PUBLIC_SUPABASE_URL=${server.url}`);
console.log(`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${testPublicKey}`);
console.log('Explicit test logins:', testAccounts.map(({ email, password }) => ({ email, password })));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void server.close().then(() => process.exit()); });
