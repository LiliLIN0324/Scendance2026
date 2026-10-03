import { describe, expect, it } from 'vitest';
import { containedImagePoint, parseDimensionText, suggestSourceKind } from './source-storage';
describe('source measurements',()=>{
  it('maps contained-image clicks and rejects horizontal/vertical letterboxing',()=>{
    const rect={left:100,top:50,width:300,height:200};
    expect(containedImagePoint(100,60,rect,1200,600)).toBeNull();
    expect(containedImagePoint(250,150,rect,1200,600)).toEqual({x:600,z:300});
    expect(containedImagePoint(110,150,rect,600,1200)).toBeNull();
    expect(containedImagePoint(250,150,rect,600,1200)).toEqual({x:300,z:600});
    expect(containedImagePoint(1,1,{...rect,width:0},100,100)).toBeNull();
  });
  it('normalizes explicit metric units without treating photo pixels as meters',()=>{
    expect(parseDimensionText('总宽 12 米；北墙 800 厘米，入口 1200mm')).toEqual([
      {label:'总宽',kind:'width',valueMeters:12},{label:'北墙',kind:'wall',valueMeters:8},{label:'入口',kind:'distance',valueMeters:1.2}
    ]);
    expect(parseDimensionText('北墙很长；0米')).toEqual([]);
  });
  it('only suggests source types, favoring photo when no floorplan evidence exists',()=>{
    expect(suggestSourceKind('手绘平面图.png')).toBe('floorplan');
    expect(suggestSourceKind('venue.jpg')).toBe('photo');
    const inkAndPaper=new Uint8ClampedArray(4000).fill(255);inkAndPaper.fill(0,0,40);
    expect(suggestSourceKind('scan.png',inkAndPaper)).toBe('floorplan');
  });
});
