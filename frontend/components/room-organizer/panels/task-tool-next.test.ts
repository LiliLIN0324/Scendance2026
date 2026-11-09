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

  it('opens materials once a venue exists and nothing is placed yet', () => {
    const step = taskToolNextStep({ ...blank, venueReady: true });
    expect(step.focus).toBe('people');
    expect(step.group).toBe('material');
  });

  it('sends the user back to the assistant when the venue and headcount are ready', () => {
    const step = taskToolNextStep({ ...blank, venueReady: true, peopleStated: true });
    expect(step.focus).toBe('chat');
    expect(step.group).toBe('material');
  });

  it('opens check once objects are on the canvas', () => {
    expect(taskToolNextStep({ venueReady: true, peopleStated: true, itemCount: 3, planShown: false }).group).toBe('handoff');
    expect(taskToolNextStep({ venueReady: true, peopleStated: false, itemCount: 3, planShown: false }).focus).toBe('check');
  });

  it('writes a visible reason when check or handoff cannot run', () => {
    expect(checkBlockReason({ itemCount: 0, generating: false, unconfirmed: false })).toMatch(/物料/);
    expect(checkBlockReason({ itemCount: 2, generating: true, unconfirmed: false })).toMatch(/整理/);
    expect(handoffBlockReason({ itemCount: 2, generating: false, unconfirmed: true })).toMatch(/确认布置/);
    expect(checkBlockReason({ itemCount: 2, generating: false, unconfirmed: false })).toBeNull();
  });
});
