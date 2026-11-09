import {expect,it} from 'vitest';
import {makeFloor,makeItem,makeLayout} from './__testfixtures__/fixtures';
import {createVenueFromPick} from './amap-venue';
const pick={name:'测试场地',location:'测试',polygon:[{lng:120.53,lat:30.40},{lng:120.531,lat:30.40},{lng:120.531,lat:30.401},{lng:120.53,lat:30.401}]};
it('refuses a two-floor map replacement before changing a locked upper chair or zone',()=>{
 const before=makeLayout({id:'test',floors:[makeFloor({id:'ground',zones:[{id:'zone',name:'签到区',x:0,z:0,w:1,d:1,color:'#fff'}]}),
   makeFloor({id:'upper',items:[makeItem({id:'locked',name:'锁定椅',locked:true})]})]});
 const copy=structuredClone(before);expect(()=>createVenueFromPick(before,pick)).toThrow();expect(before).toEqual(copy);
});
it('keeps existing floor identity and regions when an ordinary one-floor venue is planned',()=>{
 const before=makeLayout({id:'test',floors:[makeFloor({id:'original-floor',zones:[{id:'zone',name:'签到区',x:0,z:0,w:1,d:1,color:'#fff'}]})]});
 const copy=structuredClone(before),result=createVenueFromPick(before,pick);
 expect(result.layout.floors[0]!.id).toBe('original-floor');expect(result.layout.floors[0]!.zones).toEqual(before.floors[0]!.zones);expect(before).toEqual(copy);
});
