// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {readVenueFacts,venueFactsStorageKey} from '../lib/venue-facts-storage';
import {VenueFactsPanel} from './venue-facts-panel';

afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals();});
describe('local venue notes',()=>{
 it('records user-provided dimensions with their source while keeping the independence notice',async()=>{
  vi.stubGlobal('navigator',{locks:{request:async(_name:string,_options:unknown,callback:()=>Promise<void>)=>callback()}});
  render(<VenueFactsPanel activityId="a" isCurrent={()=>true}/>);
  fireEvent.change(screen.getByLabelText('数值（米）'),{target:{value:'12'}});
  fireEvent.change(screen.getByLabelText('记录人'),{target:{value:'测试'}});
  fireEvent.click(screen.getByRole('button',{name:'保存这项信息'}));
  await waitFor(()=>expect(screen.getByText(/场地宽度：12 米 · 待核对 · 用户提供/)).toBeTruthy());
  expect(screen.getByText(/不会同步到画布/)).toBeTruthy();
 });
 it('accepts fractional door width and position while retaining whole-person capacity',async()=>{
  vi.stubGlobal('navigator',{locks:{request:async(_name:string,_options:unknown,callback:()=>Promise<void>)=>callback()}});
  render(<VenueFactsPanel activityId="a" isCurrent={()=>true}/>);
  fireEvent.change(screen.getByLabelText('记录人'),{target:{value:'测试'}});
  fireEvent.change(screen.getByLabelText('要记录的信息'),{target:{value:'door_width'}});
  const width=screen.getByLabelText('数值（米）') as HTMLInputElement;
  fireEvent.change(width,{target:{value:'1.2'}});
  expect(width.checkValidity()).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'保存这项信息'}));
  await waitFor(()=>expect(screen.getByText(/门宽：1.2 米 · 待核对/)).toBeTruthy());
  fireEvent.change(screen.getByLabelText('要记录的信息'),{target:{value:'door_position'}});
  const x=screen.getByLabelText('横向位置（米）') as HTMLInputElement;
  const z=screen.getByLabelText('纵向位置（米，以平面中心为原点）') as HTMLInputElement;
  fireEvent.change(x,{target:{value:'-2.35'}});fireEvent.change(z,{target:{value:'3.45'}});
  expect(x.checkValidity()).toBe(true);expect(z.checkValidity()).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'保存这项信息'}));
  await waitFor(()=>expect(screen.getByText(/门的位置：横向 -2.35 米，纵向 3.45 米/)).toBeTruthy());
  fireEvent.change(screen.getByLabelText('要记录的信息'),{target:{value:'approved_capacity'}});
  const count=screen.getByLabelText('人数') as HTMLInputElement;
  fireEvent.change(count,{target:{value:'30.5'}});expect(count.checkValidity()).toBe(false);
 });
 it('does not overwrite corrupt records',()=>{
  const key=venueFactsStorageKey('activity:a')!;localStorage.setItem(key,'broken');
  render(<VenueFactsPanel activityId="a" isCurrent={()=>true}/>);
  expect(screen.getByRole('alert').textContent).toContain('暂停保存');
  expect((screen.getByRole('button',{name:'保存这项信息'}) as HTMLButtonElement).disabled).toBe(true);
  expect(localStorage.getItem(key)).toBe('broken');
 });
 it('lets a user withdraw an unreliable fact to unknown and records a new revision',async()=>{
  vi.stubGlobal('navigator',{locks:{request:async(_name:string,_options:unknown,callback:()=>Promise<void>)=>callback()}});
  render(<VenueFactsPanel activityId="a" isCurrent={()=>true}/>);
  fireEvent.change(screen.getByLabelText('数值（米）'),{target:{value:'12.5'}});
  fireEvent.change(screen.getByLabelText('记录人'),{target:{value:'测试'}});
  fireEvent.click(screen.getByRole('button',{name:'保存这项信息'}));
  await waitFor(()=>expect(screen.getByText(/场地宽度：12.5 米/)).toBeTruthy());
  fireEvent.click(screen.getByRole('button',{name:'将这项标为未知'}));
  await waitFor(()=>expect(screen.getByText(/场地宽度：未填写 · 未知/)).toBeTruthy());
  const saved=readVenueFacts('activity:a');expect(saved.status).toBe('ready');
  if(saved.status==='ready'){
   expect(saved.value.revision).toBe(2);expect(saved.value.facts.venue_width.value).toBeNull();
   expect(saved.value.facts.venue_width.updatedBy).toBe('测试');expect(saved.value.facts.venue_width.source).toBe('unavailable');
  }
 });
 it('does not save if the activity switches while waiting for the lock',async()=>{
  let release!:()=>void;vi.stubGlobal('navigator',{locks:{request:async(_name:string,_options:unknown,callback:()=>Promise<void>)=>{await new Promise<void>(resolve=>{release=resolve;});return callback();}}});
  let current=true;render(<VenueFactsPanel activityId="a" isCurrent={()=>current}/>);
  fireEvent.change(screen.getByLabelText('数值（米）'),{target:{value:'12'}});
  fireEvent.change(screen.getByLabelText('记录人'),{target:{value:'测试'}});
  fireEvent.click(screen.getByRole('button',{name:'保存这项信息'}));
  await waitFor(()=>expect(typeof release).toBe('function'));current=false;release();
  await waitFor(()=>expect(localStorage.getItem(venueFactsStorageKey('activity:a')!)).toBeNull());
 });
});
