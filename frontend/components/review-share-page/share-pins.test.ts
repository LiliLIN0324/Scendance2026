import { describe, expect, it } from 'vitest';
import {
  appendReviewSharePin,
  readReviewSharePins,
  REVIEW_SHARE_PIN_STORAGE_KEY,
  REVIEW_SHARE_PIN_STORAGE_KEY_V2,
} from './share-pins';

const draft = {
  itemId: null,
  x: 1,
  y: 0,
  z: -2,
  offset: null,
  camera: {
    position: [3.4, 2.8, 0.4] as const,
    target: [1, 0, -2] as const,
  },
};

describe('review share pins', () => {
  it('stores pins per plan key', () => {
    const storage = memoryStorage();
    const first = appendReviewSharePin(storage, { planKey: 'sample:initial', text: '通道窄', draft });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(readReviewSharePins('sample:initial', storage)).toHaveLength(1);
    expect(storage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY)).toContain('通道窄');
  });

  it('rejects empty text', () => {
    const storage = memoryStorage();
    expect(appendReviewSharePin(storage, { planKey: 'a', text: '   ', draft }).ok).toBe(false);
  });
  it('does not overwrite malformed other plans or evict prior plans when saving strong-version feedback',()=>{
    const storage=memoryStorage(),key=`review-v2:${'a'.repeat(64)}`;
    const bad=JSON.stringify({version:1,byPlan:{other:[{id:'bad'}]}});storage.setItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2,bad);
    expect(appendReviewSharePin(storage,{planKey:key,text:'反馈',draft,floorId:'floor'})).toMatchObject({ok:false,reason:'storage'});
    expect(storage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2)).toBe(bad);
    const full=JSON.stringify({version:1,byPlan:Object.fromEntries(Array.from({length:40},(_,i)=>[`old-${i}`,[]]))});
    storage.setItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2,full);
    expect(appendReviewSharePin(storage,{planKey:key,text:'反馈',draft,floorId:'floor'})).toMatchObject({ok:false,reason:'full'});
    expect(storage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2)).toBe(full);
  });
  it('reports an uncertain outcome if a write is lost or throws after modifying storage',()=>{
    const key=`review-v2:${'a'.repeat(64)}`,lost={getItem:()=>null,setItem:()=>{}};
    expect(appendReviewSharePin(lost,{planKey:key,text:'反馈',draft,floorId:'floor'})).toMatchObject({ok:false,reason:'unknown'});
    const storage=memoryStorage(),uncertain={getItem:storage.getItem.bind(storage),setItem:(k:string,v:string)=>{storage.setItem(k,v);throw Error('response lost');}};
    expect(appendReviewSharePin(uncertain,{planKey:key,text:'反馈',draft,floorId:'floor'})).toMatchObject({ok:false,reason:'unknown'});
    expect(storage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2)).toContain('反馈');
  });
});

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}
