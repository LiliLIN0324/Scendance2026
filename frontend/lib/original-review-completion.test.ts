import {describe,expect,it,vi} from 'vitest';
import {auditOriginalReviewStartup,createIsolatedOriginalReviewStore,reconcileIsolatedOriginalReviewCompletion} from './original-review-completion';
import {originalReviewReceiptKey,type OriginalReviewReceipt} from './original-review-commit';
const project='22222222-2222-4222-8222-222222222222',account='11111111-1111-4111-8111-111111111111';
const receipt:OriginalReviewReceipt={version:1,projectId:project,reviewId:'33333333-3333-4333-8333-333333333333',baseHash:'a'.repeat(64),candidateHash:'b'.repeat(64),baseRevision:4};
const key=originalReviewReceiptKey(account,project);
const cloud={projectId:project,reviewId:receipt.reviewId,baseHash:receipt.baseHash,candidateHash:receipt.candidateHash,baseRevision:4,appliedRevision:5,currentRevision:5,currentSceneHash:receipt.candidateHash};
function fixture(){
  const f=createIsolatedOriginalReviewStore();f.local.set(key,JSON.stringify(receipt));return f;
}
describe('original review completion protocol',()=>{
  it('cannot use fabricated cloud evidence or ledger to remove a real storage marker',async()=>{
    const f=fixture(),realValues=new Map([[key,JSON.stringify(receipt)]]),remove=vi.fn((k:string)=>{realValues.delete(k);});
    const realStorage={getItem:(k:string)=>realValues.get(k)??null,removeItem:remove};
    expect(await reconcileIsolatedOriginalReviewCompletion({accountId:account,projectId:project,storage:realStorage,ledger:f.ledger,isCurrent:()=>true,readCloud:async()=>cloud})).toBe('blocked');
    expect(remove).not.toHaveBeenCalled();expect(realValues.has(key)).toBe(true);
    expect(Object.isFrozen(f.storage)).toBe(true);
  });
  it('persists and reads back completion before deleting the pending receipt',async()=>{
    const f=fixture();
    expect(await reconcileIsolatedOriginalReviewCompletion({...f,accountId:account,projectId:project,isCurrent:()=>true,readCloud:async()=>cloud})).toBe('cleared');
    expect(await auditOriginalReviewStartup(f)).toBe('clear');
  });
  it('keeps pending on missing, changed, or uncommitted cloud evidence',async()=>{
    for(const evidence of [{...cloud,appliedRevision:null},{...cloud,currentRevision:6},{...cloud,currentSceneHash:'c'.repeat(64)}]){
      const f=fixture();expect(await reconcileIsolatedOriginalReviewCompletion({...f,accountId:account,projectId:project,isCurrent:()=>true,readCloud:async()=>evidence})).toBe('blocked');
      expect(f.local.has(key)).toBe(true);expect(await auditOriginalReviewStartup(f)).toBe('blocked');
    }
  });
  it('recovers after interruption between receipt deletion and ledger deletion',async()=>{
    const f=fixture(),del=f.ledger.delete;f.ledger.delete=async()=>{throw Error('interrupted');};
    expect(await reconcileIsolatedOriginalReviewCompletion({...f,accountId:account,projectId:project,isCurrent:()=>true,readCloud:async()=>cloud})).toBe('blocked');
    expect(f.local.has(key)).toBe(false);expect(await auditOriginalReviewStartup(f)).toBe('blocked');
    f.ledger.delete=del;expect(await reconcileIsolatedOriginalReviewCompletion({...f,accountId:account,projectId:project,isCurrent:()=>true,readCloud:async()=>cloud})).toBe('cleared');
  });
  it('blocks corrupt or orphan ledger and unreadable storage',async()=>{
    const f=fixture();f.data.set(key,{version:1,receipt,appliedRevision:99});
    expect(await reconcileIsolatedOriginalReviewCompletion({...f,accountId:account,projectId:project,isCurrent:()=>true,readCloud:async()=>cloud})).toBe('blocked');
    expect(await auditOriginalReviewStartup(f)).toBe('blocked');
    const broken=fixture();broken.local.clear();
    // getItem must also be exercised when the browser reports no keys.
    broken.ledger.list=async()=>{throw Error('database');};expect(await auditOriginalReviewStartup(broken)).toBe('blocked');
    const inaccessible=fixture();inaccessible.local.clear();
    expect(await auditOriginalReviewStartup({...inaccessible,storage:{...inaccessible.storage,getItem:()=>{throw Error('storage');}}})).toBe('blocked');
  });
  it('does not remove a receipt changed during cloud read',async()=>{
    const f=fixture();expect(await reconcileIsolatedOriginalReviewCompletion({...f,accountId:account,projectId:project,isCurrent:()=>true,readCloud:async()=>{f.local.set(key,'changed');return cloud;}})).toBe('blocked');
    expect(f.local.get(key)).toBe('changed');expect(f.data.size).toBe(1);
  });
  it('refuses a receipt copied under a different project key',async()=>{
    const f=fixture(),other='44444444-4444-4444-8444-444444444444',otherKey=originalReviewReceiptKey(account,other);
    f.local.delete(key);f.local.set(otherKey,JSON.stringify(receipt));
    expect(await reconcileIsolatedOriginalReviewCompletion({...f,accountId:account,projectId:other,isCurrent:()=>true,readCloud:async()=>cloud})).toBe('blocked');
    expect(f.local.has(otherKey)).toBe(true);
  });
});
