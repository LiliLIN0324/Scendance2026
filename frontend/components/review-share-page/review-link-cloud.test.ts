import { describe, expect, it } from 'vitest';
import {
  newReviewCode,
  REVIEW_CODE_PATTERN,
  reviewClientLinkKind,
  reviewCodeFromHash,
  reviewCodeFromPath,
  reviewShortHref,
} from './review-link-cloud';

describe('review short link helpers', () => {
  it('reads only the review short-code fragment', () => {
    expect(reviewCodeFromHash('#review=abcdef123456')).toBe('abcdef123456');
    expect(reviewCodeFromHash('review=abcdef123456')).toBe('abcdef123456');
    expect(reviewCodeFromHash('#layout=2.abc')).toBeNull();
    expect(reviewCodeFromHash('#review=ABC')).toBeNull();
    expect(reviewCodeFromHash('#review=abc')).toBeNull();
    expect(reviewCodeFromHash('#review=abcdef123456&x=1')).toBeNull();
    expect(reviewCodeFromPath('/r/abcdef123456')).toBe('abcdef123456');
    expect(reviewCodeFromPath('/r/abcdef123456/')).toBe('abcdef123456');
    expect(reviewCodeFromPath('/review/abcdef123456')).toBeNull();
    expect(reviewCodeFromPath('/r/short')).toBeNull();
  });

  it('builds a path short link and classifies the three client URL shapes', () => {
    expect(reviewShortHref('https://app.example/editor?local=1', 'abcdef123456'))
      .toBe('https://app.example/r/abcdef123456');
    expect(reviewClientLinkKind(new URL('https://app.example/r/abcdef123456'))).toBe('path');
    expect(reviewClientLinkKind(new URL('https://app.example/review/#review=abcdef123456'))).toBe('hash');
    expect(reviewClientLinkKind(new URL('https://app.example/review/#layout=abc'))).toBe('layout');
    expect(reviewClientLinkKind(new URL('https://app.example/r/abcdef123456?view=1'))).toBeNull();
    expect(reviewClientLinkKind(new URL('https://app.example/r/abcdef123456#review=abcdef123456'))).toBeNull();
    expect(reviewShortHref('not a url', 'abcdef123456')).toBeNull();
    expect(reviewShortHref('https://app.example', 'short')).toBeNull();
  });

  it('generates an unguessable 24-char lowercase hex code', () => {
    const first = newReviewCode();
    const second = newReviewCode();
    expect(first).toMatch(REVIEW_CODE_PATTERN);
    expect(first).toHaveLength(24);
    expect(first).not.toBe(second);
  });
});
