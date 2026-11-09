// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ReadonlyDraftExport} from './readonly-draft-export';
import {prepareReadonlyDraftBundle,type ReadonlyDraftInputs} from './lib/readonly-draft-bundle';
import {registerReadonlyDraftReader,readReadonlyDraft,readLiveReadonlyDraft} from './lib/readonly-draft-registry';
afterEach(cleanup);
function input():ReadonlyDraftInputs{return {scope:'a',layout:{status:'captured',value:{id:'a'}},conversations:{status:'captured',value:['草稿']},brief:{status:'captured',value:{description:'需求'}},
 images:{status:'captured',value:[{id:'photo',name:'原图.png',blob:new Blob(['original'],{type:'image/png'})}]},
 environment:{status:'unavailable',reason:'场地尚未核对'},calibration:{status:'unavailable',reason:'标定未接入'}};}
it('lists each unavailable item and keeps image bytes separate from the partial JSON',()=>{
 const value=prepareReadonlyDraftBundle(input()),json=JSON.parse(value.json);
 expect(json.sections.layout.value).toEqual({id:'a'});expect(json.sections.brief.value.description).toBe('需求');
 expect(json.sections.images.files[0].name).toBe('原图.png');expect(value.images[0]!.blob.size).toBe(8);
 expect(json.omissions.join(' ')).toContain('场地候选未包含');expect(json.omissions.join(' ')).toContain('标定候选未包含');expect(json.omissions.join(' ')).toContain('需逐个点击下载');
});
it('preserves last captured draft after writer unmount and isolates scopes',()=>{
 let value={description:'原需求'};const off=registerReadonlyDraftReader('scope-a','brief',()=>({status:'captured',value}));
 value={description:'最后输入'};off();expect(readReadonlyDraft('scope-a','brief')).toEqual({status:'captured',value});
 expect(readReadonlyDraft('scope-b','brief').status).toBe('unavailable');
 expect(readLiveReadonlyDraft('scope-a','brief').status).toBe('unavailable');
});
it('keeps drafts and lists omissions if a user-triggered download fails',()=>{
 const saveText=vi.fn(()=>{throw new Error('blocked');}),saveBlob=vi.fn(()=>{throw new Error('blocked');});
 render(<ReadonlyDraftExport capture={input} saveText={saveText} saveBlob={saveBlob}/>);
 expect(saveText).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'整理页面草稿'}));
 fireEvent.click(screen.getByRole('button',{name:'下载文字与布局草稿'}));expect(screen.getByRole('status').textContent).toContain('草稿仍保留');
 fireEvent.click(screen.getByRole('button',{name:'下载原图：原图.png'}));expect(screen.getByRole('status').textContent).toContain('草稿仍保留');
 expect(screen.getByText(/标定候选未包含/)).toBeTruthy();expect(screen.getByRole('button',{name:'下载原图：原图.png'})).toBeTruthy();
});
