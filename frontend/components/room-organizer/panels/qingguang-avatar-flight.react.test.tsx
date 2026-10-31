// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QingguangAvatarFlight } from './qingguang-avatar-flight';
import { QINGGUANG_RAIL_MASCOT } from './qingguang-rail-button';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function box(left: number, top: number, size: number): DOMRect {
  return {
    left,
    top,
    width: size,
    height: size,
    right: left + size,
    bottom: top + size,
    x: left,
    y: top,
    toJSON() { return {}; },
  } as DOMRect;
}

describe('QingguangAvatarFlight', () => {
  it('stays unmounted until the panel open state changes and both avatars have a box', () => {
    const railRef = createRef<HTMLButtonElement>();
    const headerAvatarRef = createRef<HTMLSpanElement>();
    const view = render(
      <QingguangAvatarFlight open={false} railRef={railRef} headerAvatarRef={headerAvatarRef} />,
    );
    expect(document.querySelector('.sc-qingguang-avatar-flight')).toBeNull();
    view.rerender(<QingguangAvatarFlight open railRef={railRef} headerAvatarRef={headerAvatarRef} />);
    expect(document.querySelector('.sc-qingguang-avatar-flight')).toBeNull();
  });

  it('portals the same mascot from the rail image to the header slot', () => {
    vi.useFakeTimers();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this instanceof HTMLImageElement) return box(12, 24, 28);
      if (this instanceof HTMLSpanElement) return box(80, 40, 32);
      return box(0, 0, 0);
    });
    const railRef = createRef<HTMLButtonElement>();
    const headerAvatarRef = createRef<HTMLSpanElement>();
    const view = render(
      <>
        <button ref={railRef} type="button"><img alt="" /></button>
        <span ref={headerAvatarRef} />
        <QingguangAvatarFlight open={false} railRef={railRef} headerAvatarRef={headerAvatarRef} />
      </>,
    );
    view.rerender(
      <>
        <button ref={railRef} type="button"><img alt="" /></button>
        <span ref={headerAvatarRef} />
        <QingguangAvatarFlight open railRef={railRef} headerAvatarRef={headerAvatarRef} />
      </>,
    );
    const flight = document.querySelector<HTMLImageElement>('.sc-qingguang-avatar-flight');
    expect(flight?.getAttribute('src')).toBe(QINGGUANG_RAIL_MASCOT);
    expect(flight?.style.left).toBe('12px');
    expect(flight?.style.top).toBe('24px');
  });
});
