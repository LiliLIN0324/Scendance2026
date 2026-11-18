import { describe, expect, it } from 'vitest';
import { inheritPrice, priceForModel, replaceModelPrice, withModelPrice } from './price-book';

describe('项目级价格书', () => {
  it('写入与查询', () => {
    const book = withModelPrice(undefined, 'chair-a', 88);
    expect(priceForModel(book, 'chair-a')).toBe(88);
    expect(priceForModel(book, 'chair-b')).toBeNull();
    expect(priceForModel(undefined, 'chair-a')).toBeNull();
  });

  it('清价从书里删除，不留 0 元假价', () => {
    const book = withModelPrice(withModelPrice(undefined, 'chair-a', 88), 'chair-a', null);
    expect(priceForModel(book, 'chair-a')).toBeNull();
    expect(Object.keys(book)).toHaveLength(0);
  });

  it('非法价格不写入', () => {
    expect(priceForModel(withModelPrice(undefined, 'x', Number.NaN), 'x')).toBeNull();
    expect(priceForModel(withModelPrice(undefined, 'x', -1), 'x')).toBeNull();
  });

  it('新放置只补空缺，不覆盖手填值', () => {
    const book = { 'chair-a': 88 };
    expect(inheritPrice({ modelOverride: 'chair-a' }, book).unitPrice).toBe(88);
    expect(inheritPrice({ modelOverride: 'chair-a', unitPrice: 120 }, book).unitPrice).toBe(120);
    expect(inheritPrice({ modelOverride: 'unknown' }, book).unitPrice).toBeUndefined();
  });

  it('换型号改用新款书价，书里没有就清掉旧单价', () => {
    const book = { 'chair-b': 66 };
    expect(replaceModelPrice({ unitPrice: 88 }, book, 'chair-b').unitPrice).toBe(66);
    const cleared = replaceModelPrice({ unitPrice: 88 }, book, 'chair-a');
    expect(cleared.unitPrice).toBeUndefined();
    expect('unitPrice' in cleared).toBe(false);
    const untouched: { unitPrice?: number; label: string } = { label: '椅' };
    expect(replaceModelPrice(untouched, book, undefined)).toEqual({ label: '椅' });
  });
});
