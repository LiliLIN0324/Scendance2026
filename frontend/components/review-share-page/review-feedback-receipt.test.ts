import {describe,expect,it} from 'vitest';
import {makeFloor,makeItem,makeLayout} from '../room-organizer/lib/__testfixtures__/fixtures';
import {createReviewFeedbackReceipt,inspectReviewFeedbackReceipt,reviewVersionForHash,type ReceiptPin} from './review-feedback-receipt';

const layout=()=>makeLayout({width:12,height:9,floors:[makeFloor({id:'floor-a',items:[makeItem({id:'chair-a',position:{x:1,z:1}})]})]});
const hash=(value=layout())=>`#layout=${Buffer.from(JSON.stringify(value)).toString('base64url')}`;
const pin=():ReceiptPin=>({id:'p1',floorId:'floor-a',text:'往左一点',itemId:'chair-a',x:1,y:0,z:1,offset:[0,0,0],camera:{position:[2,3,2],target:[1,0,1]},status:'open'});
describe('review feedback receipt',()=>{
 it('verifies exact version and returns a preview with idempotent duplicates',async()=>{
  const h=hash(),v=await reviewVersionForHash(h),json=createReviewFeedbackReceipt(v,[pin()],true);
  const first=await inspectReviewFeedbackReceipt(json,h);expect(first.receipt.completed).toBe(true);expect(first.added).toEqual([pin()]);
  const again=await inspectReviewFeedbackReceipt(json,h,[pin()]);expect(again.added).toEqual([]);expect(again.duplicates).toBe(1);
  await expect(inspectReviewFeedbackReceipt(json,hash({...layout(),name:'另一个版本'}))).rejects.toThrow('其他分享版本');
  await expect(inspectReviewFeedbackReceipt(json,h,[{...pin(),text:'不同内容'}])).rejects.toThrow('编号与已有内容冲突');
 });
 it('rejects wrong floor, object, invalid coordinates, duplicate ids and malformed JSON',async()=>{
  const h=hash(),v=await reviewVersionForHash(h);
  for(const bad of [{...pin(),floorId:'wrong'},{...pin(),itemId:'wrong'},{...pin(),x:200}]){
   await expect(inspectReviewFeedbackReceipt(createReviewFeedbackReceipt(v,[bad],true),h)).rejects.toThrow('楼层、位置或物件');
  }
  await expect(inspectReviewFeedbackReceipt(createReviewFeedbackReceipt(v,[{...pin(),offset:[10000,0,10000]}],true),h)).rejects.toThrow('偏移不一致');
  await expect(inspectReviewFeedbackReceipt(createReviewFeedbackReceipt(v,[{...pin(),itemId:null,offset:[0,0,0]}],true),h)).rejects.toThrow('偏移不一致');
  expect(()=>createReviewFeedbackReceipt(v,[pin(),pin()],true)).toThrow('重复编号');
  await expect(inspectReviewFeedbackReceipt('{',h)).rejects.toThrow('JSON');
  const valid=JSON.parse(createReviewFeedbackReceipt(v,[pin()],true));
  await expect(inspectReviewFeedbackReceipt(JSON.stringify({...valid,futureField:'keep'}),h)).rejects.toThrow('不支持的字段');
  await expect(inspectReviewFeedbackReceipt(JSON.stringify({...valid,pins:[{...pin(),futureField:'keep'}]}),h)).rejects.toThrow('不支持的字段');
 });
});
