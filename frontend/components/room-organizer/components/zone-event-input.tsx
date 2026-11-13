import { useEffect, useRef, useState, type CSSProperties } from 'react';

/** Keep spaces while typing; a completed edit is one plan/undo operation. Key by project + zone. */
export function ZoneEventInput({ name, value, onCommit, style }: {
  name: string; value?: string | undefined; onCommit(value: string | undefined): void; style?: CSSProperties;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const last = useRef(value ?? '');
  useEffect(() => { last.current = value ?? ''; setDraft(value ?? ''); }, [value]);
  function commit() {
    const next = draft.trim();
    if (next !== last.current) { last.current = next; onCommit(next || undefined); }
    setDraft(next);
  }
  return <input aria-label={`分区「${name}」事件`} data-testid="zone-event-input" value={draft} maxLength={120}
    onChange={event => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); commit(); event.currentTarget.blur(); } }}
    style={style} />;
}
