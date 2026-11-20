// 只读探针：定位 #1 分区句被判 invalid 是内容还是上下文长度
import fs from 'node:fs';
import { BASE, readEnv } from './harness.mjs';

const env = readEnv();
const session = JSON.parse(fs.readFileSync(process.argv[2] || '.temp/real-session.json', 'utf8'));
const url = `${BASE}/functions/v1/conversation-api/assistant/chat/stream`;

async function probe(label, message, history = []) {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, responseMode: 'outdoor_v1', includeThought: true, history }),
  });
  const text = await r.text();
  console.log(`\n=== ${label} status=${r.status} bytes=${text.length} ===`);
  console.log(text.slice(0, 2000).replace(/\s+/g, ' '));
}

await probe('short-zones', '室外发布会区和签到区');
await probe('short-exhibition', '室外展览区和表演区');
await probe('short-material', '按分区摆物料');
await probe('long-2k', '室外发布会区和签到区 ' + '场地边界已确认。'.repeat(220));
