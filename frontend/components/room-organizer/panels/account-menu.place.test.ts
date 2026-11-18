import { expect, it } from 'vitest';
import { placeSupportFlyout } from './account-menu';

const flyout = { width: 176, height: 168 };

it('opens the support list upward from a row pinned to the viewport bottom', () => {
  const viewport = { width: 1280, height: 720 };
  const guest = placeSupportFlyout({ top: 640, bottom: 676, left: 64, right: 284 }, flyout, viewport);
  expect(guest.top + flyout.height).toBeLessThanOrEqual(viewport.height - 8);
  expect(guest.top).toBeGreaterThanOrEqual(8);
  expect(guest.top).toBeLessThan(640);
  expect(guest.left).toBe(290);

  const signedIn = placeSupportFlyout({ top: 592, bottom: 628, left: 64, right: 284 }, flyout, viewport);
  expect(signedIn.top).toBe(628 - flyout.height);
  expect(signedIn.top + flyout.height).toBeLessThanOrEqual(628);
  expect(signedIn.top).toBeGreaterThanOrEqual(8);
});

it('keeps a tall support list inside a short viewport instead of painting past the edge', () => {
  const viewport = { width: 900, height: 320 };
  const placed = placeSupportFlyout({ top: 250, bottom: 286, left: 16, right: 220 }, { width: 176, height: 400 }, viewport);
  expect(placed.top).toBeGreaterThanOrEqual(8);
  expect(placed.top + Math.min(400, placed.maxHeight)).toBeLessThanOrEqual(viewport.height - 8);
  expect(placed.maxHeight).toBe(viewport.height - 16);
});
