import { describe, expect, it } from 'vitest';
import {
  LEFT_CARD_WIDTH_DEFAULT,
  LEFT_CARD_WIDTH_MAX,
  LEFT_CARD_WIDTH_MIN,
  clampLeftCardWidth,
  parseLeftCardWidth,
} from './left-card-width';

describe('left card width', () => {
  it('keeps the current 320px card when nothing is stored', () => {
    expect(parseLeftCardWidth(null)).toBe(LEFT_CARD_WIDTH_DEFAULT);
    expect(parseLeftCardWidth('')).toBe(320);
    expect(parseLeftCardWidth('nope')).toBe(320);
  });

  it('clamps a drag between 240 and 480', () => {
    expect(clampLeftCardWidth(200)).toBe(LEFT_CARD_WIDTH_MIN);
    expect(clampLeftCardWidth(360.4)).toBe(360);
    expect(clampLeftCardWidth(900)).toBe(LEFT_CARD_WIDTH_MAX);
    expect(parseLeftCardWidth('480')).toBe(480);
    expect(parseLeftCardWidth('239')).toBe(240);
  });
});
