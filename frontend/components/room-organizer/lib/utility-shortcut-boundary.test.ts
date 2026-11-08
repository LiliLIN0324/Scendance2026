import {describe,expect,it} from 'vitest';
import {hasMixedUtilityCommand} from './utility-shortcut-boundary';

describe('utility shortcut must account for the full utterance',()=>{
 it.each([
  '办一场30人的讲座，需要签到，给我物料清单','办一场30人的讲座，需要签到，给甲方看',
  '办一场30人的讲座，需要签到，检查一下','办一场30人的讲座，需要签到，导出交接',
  '我想看看签到动线，预计30人','把签到区移到入口，再帮我检查一下',
  '需要签到，给我写一段宣传语','请导出交接，还需要一份物料清单','给客户看，同时改为课桌式',
 ])('retains all content instead of taking the shortcut: %s',raw=>expect(hasMixedUtilityCommand(raw)).toBe(true));
 it.each([
  '物料清单','出物料清单','请帮我列一下物料清单','有哪些物料？','我要一份物料清单','帮我汇总一下物料清单',
  '写段文案','帮我写一段宣传语','换区','检查一下','帮我检查一下场景','看看动线','看看哪里有问题','再看看哪里有问题',
  '给甲方看','准备评审','准备客户评审','导出给搭建方','导出交付包','交接','打包带走',
 ])('still allows a complete standalone shortcut: %s',raw=>expect(hasMixedUtilityCommand(raw)).toBe(false));
 it.each(['30人，室内12×9米，圆桌','需要签到','出方案','把桌子往左移1米',''])('leaves non-utility messages to their own route: %s',raw=>expect(hasMixedUtilityCommand(raw)).toBe(false));
});
