import { describe, expect, it } from 'vitest';
import { parseLocalProjectBackupJson } from '@/lib/local-project-backup';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { localDraftDeliveryJson, localDraftMaterialsCsv, LOCAL_DRAFT_FORMAT } from './local-draft-delivery';
import { backendSceneToLayout, createMeasuredRoomLayout } from './backend-adapter';
import { extractPlanSizeFacts } from '@/lib/plan-size-facts';
import { sceneSchema, type SceneV2 } from '../../../../supabase/functions/_shared/domain';
import { sceneDeliveryJson } from './scene-delivery';

const localLayout = () => makeLayout({ name: '场地草案', width: 12, height: 9, roof: { style: 'none' }, floors: [makeFloor({
  zones: [{ id: 'rest-zone', name: '休息区（待核验）', color: '#4A7C59', x: -5, z: -3, w: 2.2, d: 1.6 }],
  items: [makeItem({ id: 'bench', type: 'bench', name: '休息长椅（示意）', category: 'rest', width: 1.4, depth: .4, height: .45, position: { x: -3.9, z: -2.2 }, rotation: 0 })],
})] });

describe('local draft delivery', () => {
  it('keeps a file-level uncertainty notice in an empty materials CSV without inventing a row',()=>{
    const layout=makeLayout({floors:[makeFloor({items:[]})]});
    const csv=localDraftMaterialsCsv(layout);
    expect(csv).toContain('本文件未绑定候选与活动需求');
    expect(csv).toContain('签到、舞台、出入口、消防及现场条件待核验');
    expect(csv.split('\r\n')).toHaveLength(1);
  });
  it('omits unverified design claims from a local handoff while retaining the original',()=>{
    const layout=createMeasuredRoomLayout(makeLayout({id:'draft-safe',roof:{style:'none'}}),{width:12,depth:9,height:3});
    layout.backendSceneV2!.design={concept:'消防部门已经批准，可以举办',palette:[],highlights:[],requirements:[]};
    layout.backendSceneV2!.dimensions[0]!.label='疏散审查全部通过';
    const json=localDraftDeliveryJson(layout);expect(json).not.toContain('消防部门已经批准');expect(json).not.toContain('疏散审查全部通过');
    expect(JSON.parse(json).layout.backendSceneV2.design).toBeUndefined();expect(layout.backendSceneV2!.design!.concept).toBe('消防部门已经批准，可以举办');
  });
  it('keeps the actual area and unsupported furniture without pretending they are cloud Scene objects', async () => {
    const layout=localLayout();
    const before=JSON.stringify(layout);
    const exported=JSON.parse(localDraftDeliveryJson(layout,{id:'draft-1',generatedAt:'2026-11-06T00:00:00Z'}));
    expect(exported).toMatchObject({format:LOCAL_DRAFT_FORMAT,version:1,state:'draft_unverified',coordinateOrigin:'venue-center'});
    expect(exported).not.toHaveProperty('scene');
    expect(exported.provenance).toMatchObject({ai:0,human:0,procedural:0,structure:0,unknown:1,deployable:1});
    expect(exported.layout.floors[0].zones).toEqual(layout.floors[0]!.zones);
    expect(exported.layout.floors[0].items[0]).toMatchObject({id:'bench',type:'bench',width:1.4,depth:.4,position:{x:-3.9,z:-2.2}});
    expect(exported.materials[0]).toMatchObject({name:'休息长椅（示意）',quantity:1,zoneName:'休息区（待核验）'});
    expect(exported.checks.every((check:{status:string})=>check.status==='unknown')).toBe(true);
    expect(exported.candidateChecklist.entries.every((check:{status:string})=>check.status==='unknown')).toBe(true);
    expect(exported.candidateChecklist.functionalNeeds.map((check:{status:string})=>check.status)).toEqual(['unknown','unknown']);
    expect(exported.candidateChecklist.scope).toContain('未绑定');
    expect(exported.confirmations).toEqual({venue:'unknown',execution:'unknown',authority:'unknown'});
    expect(localDraftMaterialsCsv(layout)).toContain('休息长椅（示意）');
    expect(localDraftMaterialsCsv(layout)).toContain('休息区（待核验）');
    expect(JSON.stringify(layout)).toBe(before);
    await expect(sceneDeliveryJson(layout)).rejects.toThrow();
  });

  it('本地 JSON 和 CSV 保留同规格但不同名称的物料', () => {
    const current=localLayout();
    const bench=current.floors[0]!.items[0]!;
    const withNamedItems={...current,floors:[{...current.floors[0]!,items:[
      {...bench,id:'a',name:'签到桌'}, {...bench,id:'b',name:'服务台'}, {...bench,id:'c',name:'签到桌'},
    ]}]};
    const rows=JSON.parse(localDraftDeliveryJson(withNamedItems)).materials;
    expect(rows.map((row:{name:string;quantity:number})=>[row.name,row.quantity])).toEqual([['签到桌',2],['服务台',1]]);
    const csv=localDraftMaterialsCsv(withNamedItems);
    expect(csv).toContain('签到桌');
    expect(csv).toContain('服务台');
    expect(csv.split('\r\n')).toHaveLength(3);
  });

  it('交接草案记录未定位物件与其计数', () => {
    const current=localLayout();
    const bench=current.floors[0]!.items[0]!;
    const {position: _position, ...unplaced}=bench;
    const draft={...current,floors:[{...current.floors[0]!,items:[{...unplaced,id:'missing'}]}]};
    const result=JSON.parse(localDraftDeliveryJson(draft));
    expect(result.unplacedItems).toMatchObject([{id:'missing',name:'休息长椅（示意）',status:'unknown'}]);
    const csv=localDraftMaterialsCsv(draft);
    expect(csv).toContain('位置待确认件数');
    const lines=csv.split('\r\n').map(line=>line.replace(/^\uFEFF?"|"$/g,'').split('","'));
    expect(lines[1]![lines[0]!.indexOf('位置待确认件数')]).toBe('1');
  });

  it('keeps current size provenance and marks a modified scene dimension unknown instead of reusing confirmation', () => {
    const measured=createMeasuredRoomLayout(makeLayout({roof:{style:'none'}}),{width:12,depth:9,height:3});
    const withArea={...measured,floors:[{...measured.floors[0]!,zones:localLayout().floors[0]!.zones!,items:localLayout().floors[0]!.items}]};
    const recorded=JSON.parse(localDraftDeliveryJson(withArea));
    expect(recorded.sizeFacts[0].width.status).toBe('confirmed');
    expect(recorded.scope.notice).toContain('不代表场地方确认');
    const changed={...withArea,width:13};
    const fact=extractPlanSizeFacts(changed,0).width;
    expect(fact).toMatchObject({valueMeters:13,status:'unknown',reason:'stale_scene'});
    expect(fact.records[0]).toMatchObject({matchesCurrent:false});
    expect(fact.records[0]!.record.valueMeters).toBe(12);
    expect(()=>localDraftDeliveryJson(changed)).toThrow('请保留原始完整备份');
  });

  it('rejects stale door width, column position and wall evidence before producing a draft',()=>{
    const id=(n:number)=>`80000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
    const scene=sceneSchema.parse({schemaVersion:2,venue:{shape:'rectangle',width:8,depth:6,height:3,entrances:[]},objects:[],camera:'overview',lighting:'neutral',
      structure:{walls:[{id:id(1),start:{x:0,z:0},end:{x:0,z:6},thickness:.2,height:3,kind:'exterior',status:'confirmed'}],
        openings:[{id:id(2),wallId:id(1),kind:'door',offset:2,width:1,height:2,sillHeight:0,status:'confirmed'}],
        columns:[{id:id(3),position:{x:4,z:4},size:{width:.5,depth:.5,height:3},rotation:0,status:'confirmed'}]},sources:[],
      dimensions:[{id:id(4),kind:'distance',targetId:id(2),measure:'width',valueMeters:1,status:'confirmed',label:'门宽'}]}) as SceneV2;
    const clean=backendSceneToLayout(scene),draft=JSON.parse(localDraftDeliveryJson(clean));
    expect(draft.state).toBe('draft_unverified');expect(draft.checks.every((v:{status:string})=>v.status==='unknown')).toBe(true);
    for(const mutation of ['door','column','wall'] as const){
      const stale=structuredClone(clean);const floor=stale.floors[0]!;
      if(mutation==='door'){const door=floor.items.find(item=>item.structuralOpeningId===id(2))!;door.width=1.5;door.name='门 token=private-value';}
      else if(mutation==='column'){const item=floor.items.find(value=>value.structuralColumnId===id(3))!;item.position={...item.position!,x:item.position!.x+0.5};}
      else floor.interiorWalls![0]!.x1+=0.1;
      expect(()=>localDraftDeliveryJson(stale)).toThrow('请保留原始完整备份');
      expect(()=>localDraftMaterialsCsv(stale)).toThrow('请保留原始完整备份');
      try{localDraftDeliveryJson(stale);}catch(error){expect(String(error)).not.toContain('private-value');}
    }
  });
  it('keeps unsupported local furniture and zones exportable when structure is consistent',()=>{
    const current=createMeasuredRoomLayout(makeLayout({roof:{style:'none'}}),{width:12,depth:9,height:3});
    current.floors[0]!.zones=localLayout().floors[0]!.zones!;
    current.floors[0]!.items.push(localLayout().floors[0]!.items[0]!);
    expect(JSON.parse(localDraftDeliveryJson(current)).layout.floors[0].zones).toHaveLength(1);
  });

  it('removes signed model links and credential-bearing user text, including from inventory and metadata', () => {
    const layout=localLayout();
    layout.floors[0]!.items[0]!.glbUrl='https://assets.example/sign/chair.glb?token=secret-value';
    layout.floors[0]!.items[0]!.notes='参照 https://example.com/plan?access_token=private-value';
    layout.floors[0]!.items[0]!.name='椅子 token=private-name';
    const json=localDraftDeliveryJson(layout);
    const csv=localDraftMaterialsCsv(layout);
    for (const output of [json,csv]) {
      expect(output).not.toContain('secret-value');
      expect(output).not.toContain('private-value');
      expect(output).not.toContain('private-name');
    }
    expect(JSON.parse(json).scope.redactedFields).toBeGreaterThan(0);
    expect(JSON.parse(json).scope.excluded).toContain('模型文件与加载地址');
  });

  it.each([
    '查看附件(blob:https://example.test/private-blob)',
    '![照片](data:image/png;base64,private-image)',
    '本机文件(file:///C:/private/secret.png)',
    '链接(https://user:password@example.test/private)',
    '链接(https:\\/\\/user:password@example.test/private)',
    '访问 //user:password@example.test/private',
    '查看 https%3A%2F%2Fexample.test%2Fprivate%3Ftoken%3Dsecret',
    '查看 https://example.test/path%3Ftoken%3Dsecret',
    '查看 https://example.test/private-photo.jpg',
    '原始附件 iVBORw0KGgoABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890==',
  ])('redacts private references embedded in notes: %s', (note) => {
    const layout=localLayout();
    layout.floors[0]!.items[0]!.notes=note;
    const json=localDraftDeliveryJson(layout);
    expect(json).not.toContain(note);
    expect(json).toContain('[私密链接或凭据已隐藏]');
  });

  it('removes image attachment fields regardless of key casing and preserves ordinary descriptions', () => {
    const layout={...localLayout(), FLOORPLANIMAGE:'data:image/png;base64,hidden-image', sourcePhotoURL:'https://example.test/private-image', PHOTOraw:'hidden-raw-image',
      ordinary:'保留 metadata: 与普通说明，公开资料 https://example.test/docs', floorPlanImage:'data:image/png;base64,iVBORw0KGgo='};
    const output=localDraftDeliveryJson(layout);
    expect(output).not.toContain('hidden-image');
    expect(output).not.toContain('private-image');
    expect(output).not.toContain('hidden-raw-image');
    expect(output).not.toContain('iVBORw0KGgo=');
    expect(output).toContain('保留 metadata: 与普通说明，公开资料 https://example.test/docs');
  });

  it('never confuses this export with a restorable backup and keeps legacy layout import intact', () => {
    const layout=localLayout();
    expect(()=>parseLocalProjectBackupJson(localDraftDeliveryJson(layout))).toThrow('不支持此备份文件格式');
    expect(parseLocalProjectBackupJson(JSON.stringify(layout)).source).toBe('legacy-layout');
  });
});
