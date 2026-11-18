/**
 * 提示词摘要生成器（2026-11-18）。
 *
 * 只取 `promptCore` 的 21 条（规范表 §9 的「一票否决」集），按
 * 「度量 → 阈值 → 动作」三段短句生成，每条带 `rule_id`，供校验回执直接引用。
 *
 * 三条刻意的取舍：
 * 1) **不生成指令性长文**。规范表原话：写成长段会让模型把 C 级经验说成规范。
 * 2) **C 级必须带「建议」**。文案里不许出现「规范要求」；源码有测试守着。
 * 3) **有字符预算**。户外提示词总预算 6000 字符（docs/47），这里默认 1600，
 *    超预算时按整条截断并显式标记，不静默丢规则。
 */

import type { CorpusRule } from './types';

export const DEFAULT_DIGEST_BUDGET = 1600;

function thresholdText(rule: CorpusRule): string {
  const parts: string[] = [];
  for (const item of rule.thresholds) {
    const value = item.m ?? item.m2 ?? item.value ?? item.count;
    if (value === undefined) continue;
    const unit = item.unit === 'm'
      ? 'm'
      : item.unit === 'm2'
        ? '㎡'
        : item.unit === 'm2_per_person'
          ? '㎡/人'
          : item.unit === 'person_per_m2'
            ? '人/㎡'
            : item.unit === 'ratio'
              ? '%'
              : item.unit === 'count'
                ? '个'
                : item.unit === 'deg'
                  ? '°'
                  : item.unit === 'db'
                    ? 'dB(A)'
                    : item.unit === 'hour'
                      ? 'h'
                      : item.unit === 'm_per_s'
                        ? 'm/s'
                        : '';
    const shown = item.unit === 'ratio' ? `${Math.round(value * 100)}%` : `${value}${unit}`;
    parts.push(item.label ? `${item.label} ${shown}` : shown);
  }
  if (rule.formula) parts.push(rule.formula);
  return parts.join('，');
}

function actionText(rule: CorpusRule): string {
  if (rule.severity === 'hard') return '不足即拒绝落笔';
  if (rule.severity === 'warn') return '不足只警告并说明代价';
  return '只进评分';
}

export function digestLine(rule: CorpusRule): string {
  const advice = rule.sourceLevel === 'C' ? '（建议值，非规范）' : '';
  return `${rule.id}｜${rule.zh}：${thresholdText(rule)}${advice}；${actionText(rule)}`;
}

export type Digest = {
  text: string;
  ruleIds: string[];
  omitted: string[];
  chars: number;
  budget: number;
};

/**
 * 生成提示词摘要。`maxChars` 是硬预算；超出时保留前面的整条规则，
 * 把未进正文的 id 放进 `omitted`，由调用方决定是否加预算。
 */
export function buildPromptDigest(rules: CorpusRule[], maxChars = DEFAULT_DIGEST_BUDGET): Digest {
  const core = rules.filter((rule) => rule.promptCore);
  const kept: string[] = [];
  const omitted: string[] = [];
  let used = 0;
  for (const rule of core) {
    const line = digestLine(rule);
    // 预留换行与标题的位置，避免最后一行刚好越界。
    if (used + line.length + 1 > maxChars) {
      omitted.push(rule.id);
      continue;
    }
    kept.push(line);
    used += line.length + 1;
  }
  const text = kept.join('\n');
  return {
    text,
    ruleIds: core.filter((rule) => !omitted.includes(rule.id)).map((rule) => rule.id),
    omitted,
    chars: text.length,
    budget: maxChars,
  };
}
