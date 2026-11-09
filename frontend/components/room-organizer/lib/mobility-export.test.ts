import {describe,expect,it} from 'vitest';
import {extractMobilityWidth,validMobilityWidth} from './mobility-export';

describe('user-stated mobility width for delivery',()=>{
  it.each([
    ['需要1.5米轮椅通道',1.5,'m',1.5,false],
    ['需要轮椅通道净宽150厘米',150,'cm',1.5,true],
    ['需要轮椅通道净宽1500毫米',1500,'mm',1.5,true],
    ['需要轮椅通道宽度至少150cm',150,'cm',1.5,false],
  ] as const)('retains the explicit value and unit from %s',(evidence,value,unit,meters,explicitClearWidth)=>{
    const width=extractMobilityWidth({decision:'needed',evidence},false);
    expect(width).toMatchObject({value,unit,meters,explicitClearWidth,source:'user_statement'});expect(validMobilityWidth(width)).toBe(true);
  });
  it.each(['需要轮椅通道','需要1.5米到2米轮椅通道','去年需要1.5米轮椅通道','轮椅通道宽约1.5米','需要1.5米轮椅通道，轮椅通道宽2米','需要1.5米轮椅通道，电话13800138000','需要1.5英尺轮椅通道','轮椅通道需要1.5米吗？'])('does not guess a width from %s',evidence=>{
    expect(extractMobilityWidth({decision:'needed',evidence},false)).toBeNull();
  });
  it('does not convert an unconfirmed or explicitly unnecessary requirement into a width',()=>{
    for(const decision of ['unknown','not_needed'] as const)expect(extractMobilityWidth({decision,evidence:'需要1.5米轮椅通道'},false)).toBeNull();
    expect(extractMobilityWidth({decision:'needed',evidence:'需要1.5米轮椅通道'},true)).toBeNull();
  });
  it('preserves an explicit minimum without treating it as a verified site measurement',()=>{
    expect(extractMobilityWidth({decision:'needed',evidence:'需要轮椅通道净宽至少150厘米'},false)).toEqual({value:150,unit:'cm',meters:1.5,bound:'at_least',explicitClearWidth:true,source:'user_statement'});
  });
});
