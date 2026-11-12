import type { TourStep } from './tour-machine';

/**
 * 首访 6 步卡组：覆盖「说需求 → 确认 → 候选 → 写入 → 物料 → 交付」一次真实闭环。
 * 动作全部走真实控件（[data-tour]），倒计时只是兜底——用户随时可以抢先自己点。
 * 确认布置这步只高亮不代点：写入画布由用户亲手完成（动手试试优先）。
 */
export const onboardingSteps: readonly TourStep[] = [
  {
    target: 'chat-input',
    action: 'fill',
    payload: '社区健康讲座，45人，室内12×8米，课桌式，需要签到',
    caption: '第一步：把需求直接说给 Agent 听。已经帮你填好一句，可以随便改。',
    autoPressMs: 12_000,
  },
  {
    target: 'chat-send',
    action: 'click',
    caption: '点发送。Agent 会先复述需求让你确认——先核对再动手，是它的习惯。',
    autoPressMs: 8_000,
  },
  {
    target: 'proposal-card',
    action: 'highlight',
    caption: '第一次生成要十几秒。候选出来后先看两个数：「座位 X / N」和「待核验项」——门位、库存这些它不知道的会明说。',
    autoPressMs: 16_000,
  },
  {
    target: 'confirm-plan',
    action: 'highlight',
    caption: '满意就点「确认布置」写入画布；不满意点「加座」或「换一版」。这步你动手，我不代点。',
    autoPressMs: 12_000,
  },
  {
    target: 'nav-material',
    action: 'highlight',
    caption: '物料清单随布置自动汇总；这里也能自己挑物料、看库存缺口。',
    autoPressMs: 10_000,
  },
  {
    target: 'publish',
    action: 'highlight',
    caption: '给客户：发布面板里有评审链接；给施工同学：导出交接包。交付都在这颗按钮里。',
    autoPressMs: 10_000,
  },
];
