import {describe, expect, it} from 'vitest';
import {
  assistantConversationScope,
  isAccountConversationScope,
  parseAccountConversationScope,
  retainedUnownedScopes,
  sameConversationOwner,
  unownedHistoryAction,
  visiblePeerScopes,
} from './assistant-conversation-scope';

describe('assistant conversation scope', () => {
  const first = assistantConversationScope('activity:first', 'backend', 'actor-a');
  const own = assistantConversationScope('activity:second', 'backend', 'actor-a');
  const other = assistantConversationScope('activity:second', 'backend', 'actor-b');
  const local = assistantConversationScope('activity:second', 'local', 'actor-a');

  it('keeps project activity actor and store as separate fields', () => {
    expect(parseAccountConversationScope(first)).toEqual({activityScope:'activity:first', store:'backend', actorId:'actor-a'});
    expect(first).not.toBe('activity:first');
    expect(first).not.toContain('actor-a:');
  });

  it('shows another activity of the same account and hides other accounts', () => {
    expect(sameConversationOwner(first, own)).toBe(true);
    expect(sameConversationOwner(first, other)).toBe(false);
    expect(sameConversationOwner(own, local)).toBe(false);
    expect(visiblePeerScopes(first, [first, own, other, local, 'activity:legacy'])).toEqual([own]);
    expect(visiblePeerScopes(other, [first, own, 'activity:legacy'])).toEqual([]);
  });

  it('does not adopt or delete an unowned legacy key', () => {
    const discovered = ['activity:legacy', 'legacy', first];
    expect(isAccountConversationScope('activity:legacy')).toBe(false);
    expect(assistantConversationScope('activity:legacy-room', 'backend', null)).toBe('activity:legacy-room');
    expect(sameConversationOwner('activity:legacy-room', first)).toBe(false);
    expect(unownedHistoryAction('adopt')).toEqual({allowed:false, effect:'none'});
    expect(unownedHistoryAction('delete')).toEqual({allowed:false, effect:'none'});
    expect(unownedHistoryAction('retain')).toEqual({allowed:true, effect:'none'});
    expect(retainedUnownedScopes(discovered)).toEqual(['activity:legacy', 'legacy']);
    expect(discovered).toEqual(['activity:legacy', 'legacy', first]);
  });

  it('rejects a blank activity or store instead of minting an owned key', () => {
    expect(() => assistantConversationScope('legacy', 'backend', 'actor-a')).toThrow('INVALID_ACTIVITY_SCOPE');
    expect(() => assistantConversationScope('activity:first', ' ', 'actor-a')).toThrow('INVALID_STORE');
  });
});
