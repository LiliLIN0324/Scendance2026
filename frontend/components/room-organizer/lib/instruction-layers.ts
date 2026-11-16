/**
 * 分层指令解析（现场口径：室外活动 / 集会 / 市集）。
 *
 * 用户一句话里常同时带两件事：
 * 1. **现在这件**：「先摆摊位」「先划观众区」——立刻处理；
 * 2. **后面那件**：「通道最后再调」「围栏等摆完再说」——现在不该做，也不该反问，只记下来排在后面。
 *
 * 注解：早先这里把例子写成「无室内，后续是造墙」（轮次 25），那是我转述时压扁出来的句子，
 * 既不是用户说法、也不是这个产品的场景（用户口径：室外活动、弄集会）。已改成室外集会的说法，
 * 室内/造墙一类只在用户真的提到时才处理。
 *
 * 环境口径：这个产品默认就是室外；只有用户明说才记 indoor / both，没提就不写（不猜）。
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

/** 后置引导词 + 一个动作，整段算「以后再做」。室外集会里真正会往后拖的是这些。 */
const DEFERRED_CLAUSE =
  /(?:后续|之后|后面|回头|后面再|下一步|待会儿|稍后|最后|等[^，,。；;！!？?\n]{0,8}(?:再|后))[^，,。；;！!？?\n]{0,24}?(?:调通道|调动线|通道|动线|围栏|隔离带|摆锥|地贴|铺地|铺装|灯光|临时电|撤场|清场|拆桁架|造墙|砌墙|隔墙)/g;

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
