import { describe, expect, it } from 'vitest';
import { captureLegacyBriefRecord, captureUnconfirmedSavedBrief, hasPreservedLegacyBrief, prepareLegacyBriefPreservation } from './legacy-brief';

describe('legacy brief preservation',()=>{
  const old={event:'公益讲座',guests:80,allowIdeas:true,description:'原始说明',mustHave:'保留入口'};
  it('captures absent confirmation flags without mutating or claiming confirmation',()=>{
    const saved=prepareLegacyBriefPreservation(old);
    expect(saved.legacyBriefRecord).toEqual({event:'公益讲座',guests:80,allowIdeas:true});
    expect(saved).not.toHaveProperty('eventConfirmed');expect(saved).not.toHaveProperty('guestsConfirmed');expect(saved).not.toHaveProperty('ideasConfirmed');
    expect(old).not.toHaveProperty('legacyBriefRecord');
  });
  it('requires readback of all original values before allowing the caller to edit',()=>{
    const prepared=prepareLegacyBriefPreservation(old);
    expect(hasPreservedLegacyBrief(old,old)).toBe(false);
    expect(hasPreservedLegacyBrief(old,{legacyBriefRecord:{event:'公益讲座',guests:81,allowIdeas:true}})).toBe(false);
    expect(hasPreservedLegacyBrief(old,prepared)).toBe(true);
  });
  it('preserves first-recorded values across later edits and captures false and zero',()=>{
    const prepared=prepareLegacyBriefPreservation(old);
    expect(captureLegacyBriefRecord({...prepared,event:'别的活动',guests:60,allowIdeas:false})).toEqual(prepared.legacyBriefRecord);
    expect(captureLegacyBriefRecord({event:'',guests:0,allowIdeas:false})).toEqual({event:'',guests:0,allowIdeas:false});
  });
  it('preserves explicit false values as unconfirmed stored values without claiming their origin',()=>{
    const mixed={event:'自定义讲座',eventConfirmed:false,guests:80,guestsConfirmed:false,allowIdeas:true,ideasConfirmed:false};
    const prepared=prepareLegacyBriefPreservation(mixed);
    expect(prepared.unconfirmedSavedBrief).toEqual({event:'自定义讲座',guests:80,allowIdeas:true});
    expect(captureLegacyBriefRecord(mixed)).toBeNull();
    expect(hasPreservedLegacyBrief(mixed,mixed)).toBe(false);
    expect(hasPreservedLegacyBrief(mixed,prepared)).toBe(true);
    expect(captureUnconfirmedSavedBrief({...prepared,event:'新活动',guests:60})).toEqual(prepared.unconfirmedSavedBrief);
  });
  it('does not label explicit unconfirmed defaults as legacy or change confirmed values',()=>{
    expect(captureLegacyBriefRecord({event:'品牌快闪',eventConfirmed:false,guests:24,guestsConfirmed:false,allowIdeas:false,ideasConfirmed:false})).toBeNull();
    expect(captureLegacyBriefRecord({event:'公益讲座',eventConfirmed:true,guests:80,guestsConfirmed:true,allowIdeas:true,ideasConfirmed:true})).toBeNull();
  });
});
