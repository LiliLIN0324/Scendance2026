import { describe, expect, it } from 'vitest';
import { layoutChatHint, revisionRefusalText } from './layout-feedback';

describe('rejection hints', () => {
  it('says what to do for overlap, bounds and clearance', () => {
    expect(revisionRefusalText([{ code: 'BBOX_OVERLAP', message: '压在「桌子」的包围盒里' }])).toContain('往东挪');
    expect(revisionRefusalText([{ code: 'OUT_OF_BOUNDS', message: '超出场地边界' }])).toContain('往里收');
    expect(revisionRefusalText([{ code: 'STRUCTURAL', message: '压到墙体' }])).toContain('过道');
    expect(revisionRefusalText([])).not.toContain('没接住');
    expect(layoutChatHint({ overlapCount: 2 })).toContain('叠');
    expect(layoutChatHint({ blocked: '压到墙', refusals: [{ code: 'E_KEEP_OUT', message: '过道' }] })).toContain('过道');
    expect(layoutChatHint({ overlapCount: 0, blocked: null })).toBeNull();
  });
});
