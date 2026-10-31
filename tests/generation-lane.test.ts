import { describe,it,expect } from 'vitest';
import { chooseLane,generationLanes,laneCost } from '../supabase/functions/_shared/generation-lane.ts';
import type { GenerationCapabilities } from '../supabase/functions/_shared/generation-contract.ts';

const capabilities=(over:Partial<GenerationCapabilities>={}):GenerationCapabilities=>({model:'hy-3d-3.0',textToModel:true,imageToModel:true,texture:false,textureRequiresImage:true,aholoTextToModel:false,aholoImageToModel:false,...over});
const table={family:'table',width:1.2,depth:0.6,height:0.75};

describe('generation lane routing',()=>{
  it('keeps a declared deterministic build on the free parametric lane',()=>{
    const decision=chooseLane({kind:'text',parameters:table},capabilities());
    expect(decision).toMatchObject({lane:'parametric',cost:'free',available:true});
    expect(decision.reason).toContain('table');
  });
  it('prefers an existing offline artifact over rebuilding identical parameters',()=>{
    const decision=chooseLane({kind:'text',parameters:table,offlineFingerprint:'abc123'},capabilities());
    expect(decision).toMatchObject({lane:'offline',cost:'free',available:true});
    expect(decision.reason).toContain('abc123');
  });
  it('stays on the free lane even when the cloud is entirely unavailable',()=>{
    expect(chooseLane({kind:'text',parameters:table},capabilities({textToModel:false,imageToModel:false}))).toMatchObject({lane:'parametric',available:true});
  });
  it('rejects malformed declared parameters instead of silently falling back to the cloud',()=>{
    expect(()=>chooseLane({kind:'text',parameters:{family:'table',width:1}},capabilities())).toThrow('INVALID_PARAMETRIC_PARAMETERS');
    expect(()=>chooseLane({kind:'text',parameters:{...table,variant:'round'}},capabilities())).toThrow('INVALID_PARAMETRIC_PARAMETERS');
  });
  it('uses the curated library only when no build was declared',()=>{
    expect(chooseLane({kind:'text',libraryAssetId:'asset-1'},capabilities())).toMatchObject({lane:'library',cost:'free',available:true});
    expect(chooseLane({kind:'text',parameters:table,libraryAssetId:'asset-1'},capabilities()).lane).toBe('parametric');
  });
  it('prefers Aholo Lux3D for free text when configured, otherwise HY-3D',()=>{
    expect(chooseLane({kind:'text'},capabilities())).toMatchObject({lane:'hy3d',cost:'metered',available:true});
    expect(chooseLane({kind:'text'},capabilities({aholoTextToModel:true}))).toMatchObject({lane:'aholo',cost:'metered',available:true});
  });
  it('reports an unavailable cloud lane honestly instead of substituting another lane',()=>{
    const retired=capabilities({textToModel:false,imageToModel:false,texture:false});
    expect(chooseLane({kind:'text'},retired)).toMatchObject({lane:'hy3d',cost:'metered',available:false});
    expect(chooseLane({kind:'image'},retired).available).toBe(false);
    const texture=chooseLane({kind:'texture'},capabilities({texture:false}));
    expect(texture).toMatchObject({lane:'hy3d',available:false});
    expect(texture.reason).toContain('HUNYUAN_TEXTURE_ENABLED');
  });
  it('never routes image or texture requests to a free lane',()=>{
    for(const kind of ['image','texture'] as const)
      expect(chooseLane({kind,parameters:table,libraryAssetId:'asset-1',offlineFingerprint:'abc'},capabilities({texture:true})).lane).toBe('hy3d');
  });
  it('enters the aholo lane on explicit declaration or when Lux3D is configured',()=>{
    expect(chooseLane({kind:'text'},capabilities())).toMatchObject({lane:'hy3d'});
    expect(chooseLane({kind:'text',provider:'aholo'},capabilities())).toMatchObject({lane:'aholo',cost:'metered',available:false});
    expect(chooseLane({kind:'text',provider:'aholo'},capabilities({aholoTextToModel:true}))).toMatchObject({lane:'aholo',available:true});
    expect(chooseLane({kind:'text'},capabilities({aholoTextToModel:true}))).toMatchObject({lane:'aholo',available:true});
    expect(chooseLane({kind:'image',provider:'aholo'},capabilities({aholoImageToModel:true}))).toMatchObject({lane:'aholo',available:true});
    expect(chooseLane({kind:'image'},capabilities({aholoImageToModel:true}))).toMatchObject({lane:'aholo',available:true});
    // Texture has no Lux3D equivalent: the declaration is ignored and the HY-3D lane owns it.
    expect(chooseLane({kind:'texture',provider:'aholo'},capabilities({texture:true,aholoTextToModel:true}))).toMatchObject({lane:'hy3d'});
  });
  it('exposes exactly five lanes with their costs',()=>{
    expect(generationLanes).toEqual(['offline','library','parametric','hy3d','aholo']);
    expect(laneCost).toEqual({offline:'free',library:'free',parametric:'free',hy3d:'metered',aholo:'metered'});
  });
});
