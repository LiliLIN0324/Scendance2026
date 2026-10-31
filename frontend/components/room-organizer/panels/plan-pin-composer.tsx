'use client';

import { useState } from 'react';
import { REVIEW_PIN_TEXT_MAX } from '../lib/review-pins';

/** 钉旁边的一句短输入。评审页和工作台共用这套文案，不再要称呼。 */
export function PlanPinComposer({
  label,
  onCommit,
  onCancel,
}: {
  label: string;
  onCommit(text: string): void;
  onCancel(): void;
}): JSX.Element {
  const [text, setText] = useState('');
  return (
    <form
      className="rsp-pin-form"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onCommit(text);
      }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <p>{label}</p>
      <input
        aria-label="议题"
        maxLength={REVIEW_PIN_TEXT_MAX}
        placeholder="写一句意见"
        value={text}
        autoFocus
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <div>
        <button type="submit" disabled={!text.trim()}>钉上</button>
        <button type="button" onClick={onCancel}>取消</button>
      </div>
    </form>
  );
}
