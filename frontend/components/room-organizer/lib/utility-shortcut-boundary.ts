import {isClientReviewCommand,isCopyDraftCommand,isExportCommand,isMaterialListCommand,isReviewCommand,isZoneCommand,normalizeDimInput} from './workbench-agent';

// Utility shortcuts consume the whole sentence. Only standalone requests may
// execute them; extra information must remain available to the conversation.
const lead='(?:(?:请|麻烦|帮我|请帮我|麻烦帮我|先|给我|可以帮我|能帮我|我想要|我要))*';
const tail='(?:一下|下|吗|呢|吧)?';
const standalone=[
 new RegExp(`^${lead}(?:(?:列|列出|列一下|给|看看|看下|看|展示|生成|输出|提供|统计|汇总|出)(?:一份|一下|下|我)?(?:当前|这版|场景|现场|目前)?(?:的)?)?(?:一份)?(?:物料清单|材料清单|清单|物料表|材料表|多少件物料|有哪些物料|用了哪些物料)(?:给我看看)?${tail}$`),
 new RegExp(`^${lead}(?:(?:写|起草|生成|给)(?:一段|段|几句|一份|个|我)?(?:文案|宣传语|推广语|邀请语|朋友圈)|写一段|写几句)${tail}$`),
 new RegExp(`^${lead}(?:换区|换个区|换区域|换到(?:签到|休息|舞台|圆桌|座位)区|搬到(?:签到|休息|舞台|圆桌|座位)区|移到(?:签到|休息|舞台|圆桌|座位)区)${tail}$`),
 new RegExp(`^${lead}(?:(?:帮我|给我|先|现在|再)?(?:检查一下|检查下|检查|体检|挑毛病|挑挑毛病|优化一下|优化下|改一版|看看动线|看下动线|检查动线|动线检查|检查碰撞|检查冲突)(?:这版|当前方案|方案|场景|场地|布置)?|(?:再)?(?:看看|看下)?(?:哪里有问题|有什么问题|有没有问题)|太挤|挤不挤|走不走得通|顺不顺)${tail}$`),
 new RegExp(`^${lead}(?:客户评审|评审包|准备评审|准备客户评审|发给客户|给客户看|给甲方看|打开客户评审|打开评审包)${tail}$`),
 new RegExp(`^${lead}(?:导出(?:给搭建方|交接|交接文件|交接资料|交付|交付包|方案|文件|清单)?|交接|交付|打包带走|(?:给|发给)搭建方|出交接|导出给搭建方)${tail}$`),
];

/** True means a substring-routed shortcut would discard unhandled content. */
export function hasMixedUtilityCommand(raw:string):boolean {
 const text=normalizeDimInput(raw).replace(/[.!！?？]+$/,'');
 if(!text)return false;
 const utility=isMaterialListCommand(raw)||isCopyDraftCommand(raw)||isZoneCommand(raw)||isReviewCommand(raw)||isClientReviewCommand(raw)||isExportCommand(raw);
 return utility&&!standalone.some(pattern=>pattern.test(text));
}
