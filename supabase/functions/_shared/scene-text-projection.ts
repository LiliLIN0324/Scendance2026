import { canonical, sceneSchema } from './domain.ts';

/**
 * Read-only view of a scene with no claim that stored design prose was verified.
 * The caller owns the untouched original and its version/hash. A changed projection
 * must never be submitted as the canonical base or used to overwrite user data.
 */
export function projectUnverifiedScene(input: unknown) {
  const original=sceneSchema.parse(input);
  const scene=structuredClone(original);
  const hiddenObjectNotes=scene.objects.filter(object=>object.notes.length>0).length;
  scene.objects=scene.objects.map(object=>({...object,notes:''}));
  let hiddenDimensionLabels=0;
  if(scene.schemaVersion===2){
    const fixedLabels=new Set(['总宽','总深','总长','层高','净高','图纸标尺']);
    scene.dimensions=scene.dimensions.map((dimension,index)=>{
      const numbered=/^模型识别尺寸 ([1-9]\d{0,2})（待核验）$/.exec(dimension.label);
      if(fixedLabels.has(dimension.label)||(numbered&&Number(numbered[1])<=128))return dimension;
      hiddenDimensionLabels++;
      return {...dimension,label:`模型识别尺寸 ${index+1}（待核验）`};
    });
    if(scene.design){
      scene.design.concept='模型设计说明待人工核验。';
      scene.design.highlights=scene.design.highlights.map(highlight=>({...highlight,
        title:'模型建议（待核验）',description:'模型建议未独立核验，请人工检查。'}));
      scene.design.requirements=scene.design.requirements.map((requirement,index)=>({...requirement,
        text:`模型要求 ${index+1}（待核验）`,status:'partial' as const,
        reason:'模型意见未经独立核验，不代表现场或规范验收。'}));
    }
  }
  // Compare with the raw stored JSON, not the parsed object: defaults and transforms
  // can otherwise silently alter the canonical write baseline.
  const changed=canonical(scene)!==canonical(input);
  return {scene,modelText:{status:'unverified' as const,scope:'scene_design_object_notes_and_dimension_labels' as const,
    note:'原方案文字、物件备注及尺寸标签的来源未逐项验证，不代表消防、疏散、无障碍或容量验收。'},
    projection:{status:'read_only' as const,changed,requiresOriginalSceneForWrite:changed,hiddenObjectNotes,hiddenDimensionLabels,
      note:'来源不明的原备注和尺寸标签未在此投影展示，需授权查看；版本号和写入校验必须使用服务器内部未修改的原始场景。'}};
}
