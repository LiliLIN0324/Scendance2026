// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ZoneEventInput } from './zone-event-input';
afterEach(cleanup);
it('keeps intermediate spaces and commits a completed phrase only once on blur',()=>{
 const commit=vi.fn();render(<ZoneEventInput name="签到区" value="" onCommit={commit}/>);
 const input=screen.getByTestId('zone-event-input') as HTMLInputElement;
 for(const value of ['签到','签到 ','签到 开始 ']) fireEvent.change(input,{target:{value}});
 expect(input.value).toBe('签到 开始 ');expect(commit).not.toHaveBeenCalled();
 fireEvent.blur(input);expect(commit).toHaveBeenCalledExactlyOnceWith('签到 开始');
});
it('Enter plus blur creates one undo step; unchanged/IME Enter never commits',()=>{
 const commit=vi.fn();render(<ZoneEventInput name="活动区" value="old" onCommit={commit}/>);
 const input=screen.getByTestId('zone-event-input');
 fireEvent.change(input,{target:{value:'new event'}});fireEvent.keyDown(input,{key:'Enter',isComposing:true});expect(commit).not.toHaveBeenCalled();
 fireEvent.keyDown(input,{key:'Enter'});fireEvent.blur(input);fireEvent.blur(input);
 expect(commit).toHaveBeenCalledExactlyOnceWith('new event');
});
it('project/zone identity remount discards uncommitted text instead of applying it to another region',()=>{
 const commit=vi.fn();const ui=render(<ZoneEventInput key="a:zone" name="A" value="saved" onCommit={commit}/>);
 fireEvent.change(screen.getByTestId('zone-event-input'),{target:{value:'unsaved'}});
 ui.rerender(<ZoneEventInput key="b:zone" name="B" value="other" onCommit={commit}/>);
 expect((screen.getByTestId('zone-event-input') as HTMLInputElement).value).toBe('other');
 fireEvent.blur(screen.getByTestId('zone-event-input'));expect(commit).not.toHaveBeenCalled();
});
