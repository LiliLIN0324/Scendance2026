import {describe,expect,it,vi} from 'vitest';
import {INITIAL_LAYOUT} from './initial-layout';
import {exportCloudMaterialDraft} from './cloud-material-draft';
import * as delivery from './scene-delivery';

describe('cloud material draft',()=>{
 it('exports only a labelled unverified editor snapshot and redacts private text',async()=>{
  const layout=structuredClone(INITIAL_LAYOUT);layout.name='测试 <script> 密钥=private';
  layout.floors[0]!.items[0]!.name='<img src=x> 密钥=private';
  const download=vi.fn();
  await exportCloudMaterialDraft({layout,dirty:true,stillCurrent:()=>true,load:async()=>({deliveryMaterials:delivery.deliveryMaterials,downloadSceneDelivery:download})});
  expect(download).toHaveBeenCalledOnce();const html=String(download.mock.calls[0]![0]);
  expect(html).toContain('本机快照');expect(html).toContain('未冻结');expect(html).toContain('数字模型不代表实物库存');
  expect(html).toContain('未包含完整活动需求、点验记录与场地方确认');expect(html).toContain('消防、无障碍');
  expect(html).toContain('本次包含尚未保存到云端的更改');
  expect(html).not.toContain('private');expect(html).not.toContain('<script>');expect(html).not.toContain('<img src=x>');
 });
 it('uses Chinese source labels and treats unrecognised sources as unverified',async()=>{
  const layout=structuredClone(INITIAL_LAYOUT),example=delivery.deliveryMaterials(layout)[0]!,download=vi.fn();
  const sources=['builtin','public_library','generated','cloud_asset','local_sample','unrecognised-secret'];
  await exportCloudMaterialDraft({layout,dirty:false,stillCurrent:()=>true,load:async()=>({deliveryMaterials:()=>sources.map(source=>({...example,source})),downloadSceneDelivery:download})});
  const html=String(download.mock.calls[0]![0]);
  for(const label of ['内置模型','公共模型库','生成模型','云端模型','来源待核验'])expect(html).toContain(label);
  for(const value of sources)expect(html).not.toContain(value);
  expect(html.match(/来源待核验/g)).toHaveLength(2);expect(html).toContain('数字模型不代表实物库存');expect(html).toContain('本次读取时无未保存更改');expect(html).toContain('未冻结');
 });
 it('does not download if the current project changes while preparing',async()=>{
  const download=vi.fn();let current=true,release!:(value:Pick<typeof delivery,'deliveryMaterials'|'downloadSceneDelivery'>)=>void;
  const pending=exportCloudMaterialDraft({layout:structuredClone(INITIAL_LAYOUT),dirty:false,stillCurrent:()=>current,load:()=>new Promise(resolve=>{release=resolve;})});
  current=false;release({deliveryMaterials:delivery.deliveryMaterials,downloadSceneDelivery:download});
  await expect(pending).rejects.toThrow('已变化');expect(download).not.toHaveBeenCalled();
 });
});
