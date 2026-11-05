/** 本地智能建造联调：真实 scene-api + 迁移过的 PGlite + 本地模型桩。
 *
 * 模型桩只负责回放工具调用，不做任何真实推理：先 get_scene 读场景，再 submit_candidates 交一份方案。
 * run 的状态、call_count、progress、candidates 全部由真实 agent_rpc 记录，前端看到的是与线上一致的形状与真值。
 * 用途：在没有模型额度时验证「前端接线 → 真实轮数与步骤时间线 → 审校完成卡」这条链路。
 */
import { startLocalServer, testAccounts, testPublicKey } from '../tests/local-server.ts';
import { owner, studio, scene } from '../tests/fixtures.ts';

/** 一份可落地的方案：场地中心放一张接待桌，颜色沿用品牌琥珀。 */
const candidate = {
  title: '接待区布置',
  explanation: '在场地中心放一张接待桌，作为签到与咨询的落点。',
  commands: [{ op: 'add', materialId: 'table', position: { x: 0, z: 0 }, rotation: 0, color: '#C9A96E' }],
};

/** OpenAI 兼容的模型桩：按对话里有没有工具结果决定下一步调用哪个工具。 */
const stubModel: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes('chat/completions')) throw new Error(`本地模型桩只处理 chat/completions，收到：${url}`);
  const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { role?: string }[] };
  const hasToolResult = (body.messages ?? []).some(message => message.role === 'tool');
  const name = hasToolResult ? 'submit_candidates' : 'get_scene';
  const args = hasToolResult ? { candidates: [candidate] } : {};
  return Response.json({
    choices: [{
      finish_reason: 'tool_calls',
      message: { content: null, tool_calls: [{ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] },
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
};

const server = await startLocalServer(54329, stubModel);
await server.rpc(owner, 'projects.create', { studioId: studio, name: '智能建造联调项目', scene: scene() });
console.log('LOCAL AGENT FIXTURE: real API + migrated PGlite + stub model. Data resets on exit.');
console.log(`NEXT_PUBLIC_SUPABASE_URL=${server.url}`);
console.log(`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${testPublicKey}`);
console.log('Explicit test logins:', testAccounts.map(({ email, password }) => ({ email, password })));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void server.close().then(() => process.exit()); });
