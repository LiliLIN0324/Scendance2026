/**
 * 从仓库里的 **真实契约源码** 现场生成可执行副本。
 *
 * 为什么必须生成而不是拷贝一份固定副本：
 * 契约会随仓库演进（这次会话期间就变过），烤死的副本会让 bench 继续按旧规则打分，
 * 而这种"分数看着正常、其实按过期契约算的"错误最难发现。
 *
 * 做法与 bench 团队当初一致：只改写前两行 import（zod → 垫片，chat-provider → stub），
 * 其余字节与仓库源码完全一致。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// bench/ → scendance-model-chain/ → skills/ → .dsh/ → 仓库根
const REPO = path.resolve(HERE, "..", "..", "..", "..");
const SRC = path.join(REPO, "supabase", "functions", "_shared", "brief-extract-contract.ts");
const OUT = path.join(HERE, "contract.real.ts");

if (!fs.existsSync(SRC)) {
  console.error("找不到契约源码: " + SRC);
  process.exit(1);
}

const lines = fs.readFileSync(SRC, "utf8").split(/\r?\n/);
if (!/from '\.\/chat-provider\.ts'/.test(lines[1] ?? "")) {
  console.error("契约前两行结构变了，无法安全改写 import：\n  " + lines.slice(0, 3).join("\n  "));
  process.exit(1);
}
lines[0] = "import { z } from './zod-lite.mjs';";
lines[1] = "import { chatProviderSchema } from './chat-provider.stub.ts';";

const text = lines.join("\n");
const before = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
fs.writeFileSync(OUT, text);
console.log("已同步 contract.real.ts ← " + path.relative(REPO, SRC));
console.log("  行数 " + lines.length + (before === text ? "（与上次一致，无变化）" : before === "" ? "（新建）" : "（已更新）"));
console.log("  含 materialQueries hoist: " + text.includes("rawSlot"));
