// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RESTORE_JOURNAL_MARKER } from '@/lib/restore-journal';
import { STORAGE_KEY } from '../components/room-organizer/lib/constants';
import { isRecoveryKey } from '../components/room-organizer/lib/persistence';
import GlobalError from './global-error';

afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks();});
it('全局错误页配额不足时保留原始草稿并提示可下载',()=>{
  const raw='原始未修复内容\r\n{bytes}';localStorage.setItem(STORAGE_KEY,raw);
  const original=Storage.prototype.setItem;
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){
    if(isRecoveryKey(key))throw new DOMException('full','QuotaExceededError');original.call(this,key,value);
  });
  vi.spyOn(console,'warn').mockImplementation(()=>{});
  render(<GlobalError error={new Error('failure')} reset={() => {}}/>);
  fireEvent.click(screen.getByRole('button',{name:'保留备份，开始新方案'}));
  expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
  expect(screen.getByText(/原草稿未删除/)).toBeTruthy();
  expect(screen.getByRole('button',{name:'下载本地草稿'})).toBeTruthy();
});


it.each(['pending','damaged','unreadable'])('根外全局错误页在 %s 恢复状态下不重置并允许下载', kind=>{
  const raw='原始现场布置\r\n{raw}';localStorage.setItem(STORAGE_KEY,raw);
  if(kind!=='unreadable')localStorage.setItem(RESTORE_JOURNAL_MARKER,kind==='pending'?JSON.stringify({version:1,id:'pending'}):'{broken');
  if(kind==='unreadable'){const original=Storage.prototype.getItem;vi.spyOn(Storage.prototype,'getItem').mockImplementation(function(this:Storage,key){if(key===RESTORE_JOURNAL_MARKER)throw new Error('blocked');return original.call(this,key);});}
  const del=vi.spyOn(Storage.prototype,'removeItem');
  render(<GlobalError error={new Error('failure')} reset={() => {}}/>);
  fireEvent.click(screen.getByRole('button',{name:'保留备份，开始新方案'}));
  expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);expect(del.mock.calls.some(([key])=>key===STORAGE_KEY)).toBe(false);
  expect(screen.getByText(/恢复资料尚待核对/)).toBeTruthy();expect(screen.getByRole('button',{name:'下载本地草稿'})).toBeTruthy();
});
