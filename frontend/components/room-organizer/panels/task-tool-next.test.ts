import { describe, expect, it } from 'vitest';
import { checkBlockReason, handoffBlockReason, taskToolNextStep } from './task-tool-next';

const blank = { venueReady: false, peopleStated: false, itemCount: 0, planShown: false };

describe('task tool next step', () => {
  it('asks a first-time user to set the venue before anything else', () => {
    expect(taskToolNextStep(blank)).toEqual({
      focus: 'venue',
      group: 'space',
      text: '下一步：点「定场地」。',
    });
  });

  it('asks for a headcount once the venue exists', () => {
    expect(taskToolNextStep({ ...blank, venueReady: true }).focus).toBe('people');
  });

  it('sends the user back to the assistant when the venue and headcount are ready', () => {
    expect(taskToolNextStep({ ...blank, venueReady: true, peopleStated: true }).focus).toBe('chat');
  });

  it('points at the check once a plan or objects are on the canvas', () => {
    expect(taskToolNextStep({ venueReady: true, peopleStated: true, itemCount: 3, planShown: false }).focus).toBe('check');
    expect(taskToolNextStep({ venueReady: true, peopleStated: true, itemCount: 0, planShown: true }).group).toBe('handoff');
  });

  it('writes a visible reason when check or handoff cannot run', () => {
    expect(checkBlockReason({ itemCount: 0, generating: false, unconfirmed: false })).toMatch(/物料/);
    expect(checkBlockReason({ itemCount: 2, generating: true, unconfirmed: false })).toMatch(/整理/);
    expect(handoffBlockReason({ itemCount: 2, generating: false, unconfirmed: true })).toMatch(/确认布置/);
    expect(checkBlockReason({ itemCount: 2, generating: false, unconfirmed: false })).toBeNull();
  });
});
