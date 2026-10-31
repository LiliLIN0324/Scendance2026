import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  captureChangedLanes,
  invertLaneSnapshot,
  mergeLayoutLaneSnapshot,
  type LayoutLaneSnapshot,
} from '../lib/layout-lanes';
import type { RoomLayout } from '../lib/types';
import type { UseHistoryOptions, UseHistoryResult } from './use-history';

interface LaneStacks {
  readonly past: readonly LayoutLaneSnapshot[];
  readonly future: readonly LayoutLaneSnapshot[];
}

/**
 * Lane-aware undo/redo for the editor's one persisted tree. The scene (walls,
 * items, camera, finishes…) and the business documents (production plan,
 * event operations, design book) are recorded as separate lanes in one
 * chronological stack:
 *
 *  - undoing a furniture move leaves the production plan alone;
 *  - undoing a plan edit leaves the furniture where it is;
 *  - an AI or scene-snapshot apply is one scene lane entry, never a plan
 *    rollback.
 *
 * The stack order still tells you *when* each edit happened, so redo walks the
 * same steps back. `truncateTo` keeps the keyboard-placement contract.
 */
export function useLayoutHistory(
  value: RoomLayout,
  apply: (snapshot: LayoutLaneSnapshot) => void,
  options: UseHistoryOptions = {}
): UseHistoryResult<RoomLayout> {
  const { debounceMs = 600, maxEntries = 50 } = options;

  const [stacks, setStacks] = useState<LaneStacks>({ past: [], future: [] });
  const stacksRef = useRef(stacks);
  stacksRef.current = stacks;
  const valueRef = useRef(value);
  valueRef.current = value;
  const lastCommittedRef = useRef<RoomLayout>(value);
  const skipNextRef = useRef(false);
  const generationRef = useRef(0);
  const discreteRef = useRef(false);
  const discreteTimerRef = useRef<number | undefined>(undefined);

  const commit = useCallback(
    (next: RoomLayout) => {
      const entry = captureChangedLanes(lastCommittedRef.current, next, 'prev');
      if (!entry) {
        lastCommittedRef.current = next;
        return;
      }
      const past = [...stacksRef.current.past, entry];
      const trimmed = past.length > maxEntries ? past.slice(past.length - maxEntries) : past;
      stacksRef.current = { past: trimmed, future: [] };
      setStacks(stacksRef.current);
      lastCommittedRef.current = next;
    },
    [maxEntries]
  );

  useEffect(() => {
    if (skipNextRef.current) {
      skipNextRef.current = false;
      lastCommittedRef.current = value;
      return undefined;
    }
    if (Object.is(value, lastCommittedRef.current)) return undefined;

    if (discreteRef.current) {
      discreteRef.current = false;
      window.clearTimeout(discreteTimerRef.current);
      commit(value);
      return undefined;
    }

    const generation = generationRef.current;
    const timer = window.setTimeout(() => {
      if (generation !== generationRef.current) return;
      commit(value);
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [value, debounceMs, commit]);

  useEffect(() => () => window.clearTimeout(discreteTimerRef.current), []);

  const undo = useCallback(() => {
    const { past, future } = stacksRef.current;

    if (!skipNextRef.current && !Object.is(valueRef.current, lastCommittedRef.current)) {
      // A pending edit that hasn't reached the debounce yet: undo it back to
      // the last committed value, but keep the pending lanes redoable.
      const pending = captureChangedLanes(lastCommittedRef.current, valueRef.current, 'next');
      if (pending) {
        stacksRef.current = { past, future: [...future, pending] };
        setStacks(stacksRef.current);
      }
      skipNextRef.current = true;
      apply(captureChangedLanes(lastCommittedRef.current, valueRef.current, 'prev') ?? {});
      return;
    }

    if (past.length === 0) return;
    const entry = past[past.length - 1];
    if (!entry) return;
    const redo = invertLaneSnapshot(entry, valueRef.current);
    stacksRef.current = { past: past.slice(0, -1), future: [...future, redo] };
    setStacks(stacksRef.current);
    skipNextRef.current = true;
    lastCommittedRef.current = mergeLayoutLaneSnapshot(valueRef.current, entry);
    apply(entry);
  }, [apply]);

  const redo = useCallback(() => {
    const { past, future } = stacksRef.current;

    if (!skipNextRef.current && !Object.is(valueRef.current, lastCommittedRef.current)) {
      if (future.length > 0) {
        stacksRef.current = { past, future: [] };
        setStacks(stacksRef.current);
      }
      return;
    }

    if (future.length === 0) return;
    const entry = future[future.length - 1];
    if (!entry) return;
    stacksRef.current = { past: [...past, invertLaneSnapshot(entry, valueRef.current)], future: future.slice(0, -1) };
    setStacks(stacksRef.current);
    skipNextRef.current = true;
    lastCommittedRef.current = mergeLayoutLaneSnapshot(valueRef.current, entry);
    apply(entry);
  }, [apply]);

  const clear = useCallback((baseline: RoomLayout) => {
    generationRef.current += 1;
    stacksRef.current = { past: [], future: [] };
    setStacks(stacksRef.current);
    skipNextRef.current = false;
    discreteRef.current = false;
    lastCommittedRef.current = baseline;
  }, []);

  const commitNow = useCallback(() => {
    if (!skipNextRef.current && !Object.is(valueRef.current, lastCommittedRef.current)) {
      generationRef.current += 1;
      commit(valueRef.current);
    }
    discreteRef.current = true;
    window.clearTimeout(discreteTimerRef.current);
    discreteTimerRef.current = window.setTimeout(() => {
      discreteRef.current = false;
    }, debounceMs);
  }, [commit, debounceMs]);

  const truncateTo = useCallback((snapshot: RoomLayout) => {
    const { past } = stacksRef.current;
    // Scene entries carry the full prior layout, so a placement session's
    // starting layout is the scene of the entry the add committed on top of.
    let index = -1;
    for (let i = past.length - 1; i >= 0; i--) {
      if (past[i]?.scene === snapshot) {
        index = i;
        break;
      }
    }
    const kept = index >= 0
      ? past.slice(0, index)
      : Object.is(snapshot, lastCommittedRef.current)
        ? past
        : [];
    generationRef.current += 1;
    stacksRef.current = { past: kept, future: [] };
    setStacks(stacksRef.current);
    discreteRef.current = false;
    skipNextRef.current = true;
  }, []);

  const pendingEdit = !skipNextRef.current && !Object.is(value, lastCommittedRef.current);
  const canUndo = stacks.past.length > 0 || pendingEdit;
  const canRedo = stacks.future.length > 0 && !pendingEdit;

  return useMemo(
    () => ({ canUndo, canRedo, undo, redo, clear, commitNow, truncateTo }),
    [canUndo, canRedo, undo, redo, clear, commitNow, truncateTo]
  );
}
