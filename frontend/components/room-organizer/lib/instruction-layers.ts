/**
 * 分层指令解析（2026-11-16 用户口径：「无室内，后续是造墙」这类一句两层的话）。
 *
 * 现场用户一句话里常同时带两件事：
 * 1. **现在这条**：环境口径（这次只做室外 / 没有室内），需要立刻进 brief；
 * 2. **以后那条**：造墙、隔断这类后置动作，现在不该执行，也不该反问，只记下来排在后面。
 *
 * 之前这两层都没被吸收：整句话原样贴在对话里，brief 不变、也不发请求，
 * 用户看到的就是「说了等于没说」。这里先做纯解析，接线到 brief 由调用方负责。
 *
 * 原则：只认说得出口的字面表达，不猜。没命中就返回空，绝不自己编一条约束。
 */

export type InstructionEnvironment = 'outdoor' | 'indoor' | 'both';

export interface InstructionLayers {
  /** 环境口径；没提到就是 undefined（不猜）。 */
  environment?: InstructionEnvironment;
  /** 后置动作原文（「后续是造墙」这类），按出现顺序。 */
  deferred: string[];
  /** 去掉后置从句后的当前指令，空串表示这句只剩后置内容。 */
  immediate: string;
}

/** 环境口径：只做室外。 */
const OUTDOOR_ONLY = /(?:没有|没|无|不含|不做)\s*室内|全(?:是|部是|部做)?\s*室外|只(?:做|要)?\s*室外|纯室外/;
/** 环境口径：只做室内。 */
const INDOOR_ONLY = /(?:没有|没|无|不含|不做)\s*室外|全(?:是|部是|部做)?\s*室内|只(?:做|要)?\s*室内|纯室内/;
/** 环境口径：两边都有。 */
const BOTH = /室内(?:和|与|、)?室外(?:都|均)|室内外都有|室内室外都要/;

/** 后置引导词 + 一个动作，整段算「以后再做」。 */
const DEFERRED_CLAUSE =
  /(?:后续|之后|后面|回头|后面再|下一步|待会儿|稍后|下阶段|二期)[^，,。；;！!？?\n]{0,24}?(?:造墙|砌墙|墙体|隔墙|隔断|天花|吊顶|地面找平|铺地|封顶)/g;

/** 去掉标点/空白后还能剩下字，才算一条真指令。 */
function meaningful(text: string): string {
  return text.replace(/[\s，,。.；;、！!？?：:]+/g, '');
}

export function parseInstructionLayers(text: string): InstructionLayers {
  const source = text ?? '';
  const deferred: string[] = [];
  for (const match of source.matchAll(DEFERRED_CLAUSE)) {
    const clause = match[0]?.trim();
    if (clause && meaningful(clause)) deferred.push(clause);
  }

  let immediate = source;
  if (deferred.length > 0) {
    for (const clause of deferred) immediate = immediate.replace(clause, '');
    // 清掉被拆开后留下的悬空连接词与标点。
    immediate = immediate
      .replace(/[，,、；;]\s*(?=[，,、；;]|$)/g, '')
      .replace(/^[\s，,、；;。]+|[\s，,、；;。]+$/g, '')
      .trim();
  }

  let environment: InstructionEnvironment | undefined;
  if (BOTH.test(source)) environment = 'both';
  else if (OUTDOOR_ONLY.test(source)) environment = 'outdoor';
  else if (INDOOR_ONLY.test(source)) environment = 'indoor';

  return {
    ...(environment ? { environment } : {}),
    deferred,
    immediate,
  };
}
