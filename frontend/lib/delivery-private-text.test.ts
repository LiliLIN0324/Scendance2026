import {describe,expect,it,vi} from 'vitest';
import {deliveryPrivateText,hasDeliveryPrivateLiteral} from './delivery-private-text';
import {INITIAL_LAYOUT} from '../components/room-organizer/lib/initial-layout';
import {localDraftDeliveryJson,localDraftMaterialsCsv} from '../components/room-organizer/lib/local-draft-delivery';
import {sealLocalDraft,verifyLocalDraft} from '../components/room-organizer/lib/local-draft-integrity';
import {sceneDeliveryCsv,sceneDeliveryJson,deliveryMaterials} from '../components/room-organizer/lib/scene-delivery';
import {exportCloudMaterialDraft} from '../components/room-organizer/lib/cloud-material-draft';
import {eventOperationsSchema} from '../../supabase/functions/_shared/event-operations-contract';
import {productionPlanHandoffHtml} from './production-plan-export';
import {executionTimetableHtml} from './execution-timetable-export';

describe('delivery privacy literals',()=>{
 it('detects high-confidence standalone credentials and Windows paths without blocking ordinary text or public URLs',()=>{
  for(const value of ['sk-TEST12345678','参照 C:\\Users\\Fixture\\PRIVATE_FOLDER\\file.glb','D:/PRIVATE_FOLDER/model.glb','\\\\server\\PRIVATE_FOLDER\\model.glb']){
   expect(hasDeliveryPrivateLiteral(value)).toBe(true);expect(deliveryPrivateText(value)).toBe('[私密链接或凭据已隐藏]');
  }
  for(const value of ['桌子 sk-12','桌子 desk-12345678','联系人 13800138000 organizer@example.test','https://example.test/C:/public']){
   expect(hasDeliveryPrivateLiteral(value)).toBe(false);expect(deliveryPrivateText(value)).toBe(value);
  }
 });
 it('removes synthetic credentials and local paths from actual JSON, CSV, sealed draft and HTML without altering source data',async()=>{
  const layout=structuredClone(INITIAL_LAYOUT),snapshot={id:'fictional-snapshot',generatedAt:'2026-11-08T00:00:00Z'};
  layout.name='虚构活动，联系人 13800138000 organizer@example.test，https://example.test/C:/public';
  layout.floors[0]!.items[0]!.name='椅子 sk-TEST12345678';
  layout.floors[0]!.items[1]!.name='桌子 C:\\Users\\Fixture\\PRIVATE_FOLDER\\model.glb';
  layout.floors[0]!.items[2]!.name='普通款 sk-12';
  layout.eventOperations=eventOperationsSchema.parse({tasks:[{id:'ab100000-0000-4000-8000-000000000001',title:'搭建 sk-TEST12345678',phase:'setup',ownerName:'C:\\Users\\Fixture\\PRIVATE_FOLDER\\owner',acceptance:'联系 13800138000 organizer@example.test'}]});
  const original=JSON.stringify(layout),draft=localDraftDeliveryJson(layout,snapshot),sealed=await sealLocalDraft(draft),download=vi.fn();
  await exportCloudMaterialDraft({layout,dirty:false,stillCurrent:()=>true,load:async()=>({deliveryMaterials,downloadSceneDelivery:download})});
  const outputs=[draft,localDraftMaterialsCsv(layout,snapshot),await sceneDeliveryJson(layout,snapshot),sceneDeliveryCsv(layout,snapshot),sealed,String(download.mock.calls[0]![0])];
  for(const output of outputs){expect(output).not.toContain('sk-TEST12345678');expect(output).not.toContain('PRIVATE_FOLDER');expect(output).toContain('普通款 sk-12');}
  expect(draft).toContain('13800138000');expect(draft).toContain('organizer@example.test');expect(draft).toContain('https://example.test/C:/public');
  expect(String(download.mock.calls[0]![0])).toContain('13800138000');expect(String(download.mock.calls[0]![0])).toContain('organizer@example.test');
  expect(JSON.parse(draft).scope.note).toContain('不能保证识别全部敏感信息');
  expect(localDraftMaterialsCsv(layout,snapshot)).toContain('隐私过滤不能保证覆盖全部敏感信息');
  expect(sceneDeliveryCsv(layout,snapshot)).toContain('隐私过滤不能保证识别全部敏感信息');
  expect(JSON.parse(draft).scope.redactedFields).toBeGreaterThanOrEqual(2);
  const sceneJson=JSON.parse(await sceneDeliveryJson(layout,snapshot));expect(sceneJson.privacy.redactedFields).toBeGreaterThanOrEqual(2);
  expect(sceneJson.privacy.note).toContain('不能保证识别全部敏感信息');
  for(const html of [await productionPlanHandoffHtml(layout,snapshot,undefined,{scope:'activity'}),await executionTimetableHtml(layout,snapshot)]){
    expect(html).not.toContain('sk-TEST12345678');expect(html).not.toContain('PRIVATE_FOLDER');
    expect(html).toContain('不能保证识别全部敏感信息');expect(html).toContain('13800138000');expect(html).toContain('organizer@example.test');
  }
  expect(String(download.mock.calls[0]![0])).toContain('不能保证识别全部敏感信息');
  expect(await verifyLocalDraft(sealed)).toMatchObject({status:'consistent'});expect(JSON.stringify(layout)).toBe(original);
 });
});
