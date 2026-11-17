import { expect, it } from 'vitest';
import { locateReadiness } from './gm-locate';

const ready = {
  outdoor2D: true,
  designScopeCount: 0,
  hasAnchor: true,
  hasOverlay: true,
  mapFootprintCount: 0,
};

it('frames a 2D design scope even without an anchor', () => {
  expect(locateReadiness({ ...ready, designScopeCount: 3, hasAnchor: false })).toBe('moved');
});

it('frames a 2D anchor when the design scope is still open', () => {
  expect(locateReadiness({ ...ready, designScopeCount: 2 })).toBe('moved');
});

it('misses in 2D when nothing is framed and does not borrow the map footprint', () => {
  expect(locateReadiness({
    ...ready,
    hasAnchor: false,
    mapFootprintCount: 5,
  })).toBe('miss');
  expect(locateReadiness({ ...ready, hasOverlay: false, designScopeCount: 4 })).toBe('miss');
});

it('frames the map footprint outside the 2D canvas and misses a short ring', () => {
  expect(locateReadiness({
    ...ready,
    outdoor2D: false,
    hasAnchor: false,
    hasOverlay: false,
    mapFootprintCount: 3,
  })).toBe('moved');
  expect(locateReadiness({
    ...ready,
    outdoor2D: false,
    mapFootprintCount: 2,
  })).toBe('miss');
});
