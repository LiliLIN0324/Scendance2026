import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTOSAVE_DEBOUNCE_MS, STORAGE_KEY } from '../lib/constants';
import { notify } from '../lib/editor-notices';
import {
  EDITOR_SETTLED_MS,
  classifyStorageError,
  clearReloadAttempt,
  keepStoredLayout,
  loadLayout,
  sameLayoutContent,
  saveLayout,
} from '../lib/persistence';
import { isUntouched, snapshotBeforeReplace } from '../lib/restore-point';
import { parseLayoutEventOperations, parseStoredLayout } from '../lib/schema';
import { decodeShareUrl, isShareHash, isShareHashWithinBudget } from '../lib/share';
import { recordSnapshot } from '../lib/version-history';
import type { SaveFailureReason } from '../lib/persistence';
import type { RoomLayout } from '../lib/types';

export interface UseLayoutPersistenceOptions {
  layout: RoomLayout;
  onHydrate: (layout: RoomLayout) => void;
  debounceMs?: number;
}

export interface UseLayoutPersistenceResult {
  /** Verify the current activity id in storage, saving a fresh or hydrated ID-less activity if needed. Throws on refusal. */
  ensurePersistentIdentity(): void;
  /** Save and strictly read back a guarded layout; already-stored task recovery preserves the editor's newer geometry. */
  persistVerifiedLayout(expected: RoomLayout, next: RoomLayout, guard: () => void): Promise<RoomLayout>;
  /** Cancel older autosaves and acknowledge the fully verified file restore. */
  acknowledgeRestoredLayout(layout: RoomLayout, json: string): void;
  /** Milliseconds-since-epoch of the last successful save, or null. */
  lastSavedAt: number | null;
  /** True while the debounce window is pending — the next save is on the way. */
  saving: boolean;
  /**
   * Why the most recent save attempt failed — a full quota (typically an
   * oversized floor-plan image), storage blocked by the browser, or something
   * else (#472) — or null after a success. The HUD uses it to avoid falsely
   * showing "Saved" and to say what the user can do.
   */
  saveError: SaveFailureReason | null;
  /**
   * The layout another tab saved over ours, or null. Autosave stays
   * last-writer-wins between tabs (full merge is out of scope, #123), but the
   * race is surfaced instead of silent: the HUD shows a notice and can adopt
   * this snapshot. The caller decides what "adopt" means (an undoable
   * applyLayout — NOT the hydrate path, which would clear history).
   */
  remoteLayout: RoomLayout | null;
  /** Dismiss the cross-tab notice (also call after adopting `remoteLayout`). */
  clearRemoteLayout(): void;
}

export function useLayoutPersistence({
  layout,
  onHydrate,
  debounceMs = AUTOSAVE_DEBOUNCE_MS,
}: UseLayoutPersistenceOptions): UseLayoutPersistenceResult {
  const hasHydratedRef = useRef(false);
  const hydrationInFlightRef = useRef(true);
  const localHydrationRef = useRef<{ layout: RoomLayout; id: string | null } | null>(null);
  // While set, autosave is suppressed until the layout moves past the stored
  // pre-hydration value — i.e. until the hydration dispatch has landed. This
  // stops a freshly opened share link (or a plain reload) from overwriting the
  // local save before the user has actually edited anything.
  const hydrationBaseRef = useRef<RoomLayout | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const pendingRef = useRef(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<SaveFailureReason | null>(null);
  const [autosaveResume, setAutosaveResume] = useState(0);
  // The exact JSON this tab last wrote: its own echo must not count as
  // another tab's change (#334).
  const lastSavedJsonRef = useRef<string | null>(null);
  const storedBaselineRef = useRef<{ known: boolean; json: string | null }>({ known: false, json: null });
  // A task write may have reached storage even when readback fails. Keep the old UI's autosave off until verified and applied.
  const verifiedWriteRef = useRef<{ expected: RoomLayout; layout: RoomLayout; json: string; verified: boolean; resumeAutosave: boolean } | null>(null);
  const saveEpochRef = useRef(0);
  const restoredLayoutRef = useRef<RoomLayout | null>(null);
  // The main save holds a house that couldn't be opened and couldn't be
  // copied aside (storage full): it's the only copy, so nothing may be
  // written over it until a copy succeeds.
  const mainSaveHeldRef = useRef(false);
  const [remoteLayout, setRemoteLayout] = useState<RoomLayout | null>(null);

  // Cross-tab guard (#123): the `storage` event only fires in OTHER tabs of
  // the same origin, so any event on our key means a different tab saved.
  // A different tab, but not necessarily a different house: after one tab
  // adopts the other's version its autosave writes that same house back, and
  // flagging it would bounce the notice between the tabs forever (#334).
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== STORAGE_KEY || event.newValue === null) return;
      if (event.newValue === lastSavedJsonRef.current) {
        // Storage is back to what this tab wrote: a notice offering the
        // other tab's version is stale, and adopting it would restart the
        // ping-pong (#334).
        setRemoteLayout(null);
        return;
      }
      try {
        const parsed = parseStoredLayout(JSON.parse(event.newValue));
        if (!parsed) return;
        // Both sides through the same schema pass, so defaults it fills in
        // don't read as a difference.
        const shown = layoutRef.current;
        const shownNormalised = parseStoredLayout(JSON.parse(JSON.stringify(shown))) ?? shown;
        if (sameLayoutContent(parsed, shownNormalised)) {
          // The other tab now holds what this one shows: any earlier notice is moot.
          setRemoteLayout(null);
          return;
        }
        setRemoteLayout(parsed);
      } catch {
        /* another tab wrote something unreadable — nothing to offer */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const clearRemoteLayout = useCallback(() => setRemoteLayout(null), []);

  // The editor hydrated and stayed up, so the error screen's reload worked: a
  // later, unrelated crash must not read as the saved house failing again
  // (#336). A crash before then unmounts the hook and cancels this.
  useEffect(() => {
    const handle = window.setTimeout(() => clearReloadAttempt(), EDITOR_SETTLED_MS);
    return () => window.clearTimeout(handle);
  }, []);

  useEffect(() => {
    if (hasHydratedRef.current) return;
    hasHydratedRef.current = true;
    try { storedBaselineRef.current = { known: true, json: window.localStorage.getItem(STORAGE_KEY) }; }
    catch { /* The guarded save refuses an unknown baseline instead of treating it as empty. */ }

    // Copy the stored house aside, or hold the main save if it can't be.
    const keepStoredHouseAside = (): void => {
      const outcome = keepStoredLayout();
      if (outcome === 'kept') {
        notify('Your saved house couldn’t be opened, so a copy was kept in Manage → Saved Layouts → History.', 'info');
      }
      if (outcome === 'kept' || outcome === 'nothing') return;
      mainSaveHeldRef.current = true;
      setSaveError(outcome);
    };

    const hydrateFromLocalSave = (): void => {
      const saved = loadLayout();
      if (saved) {
        localHydrationRef.current = { layout: saved, id: saved.id || null };
        hydrationBaseRef.current = layoutRef.current;
        // A stored layout that parses but throws on apply must not
        // white-screen mount.
        try {
          onHydrate(saved);
        } catch (error) {
          console.warn('Failed to apply saved layout:', error);
          // Clearing the baseline resumes autosave, which will overwrite the
          // stored blob with the fallback layout ~debounceMs later. That blob
          // is the user's house — stash a copy first, exactly like the
          // unreadable-blob branch below (#206).
          keepStoredHouseAside();
          hydrationBaseRef.current = null;
          localHydrationRef.current = null;
        }
      } else {
        hydrationBaseRef.current = null;
        // A blob that exists but failed to load would otherwise be overwritten
        // by the autosave of the fallback layout ~debounceMs after mount —
        // permanent data loss. Stash a copy first (#113).
        keepStoredHouseAside();
      }
      hydrationInFlightRef.current = false;
    };

    // Share-URL takes precedence over the local auto-save so opening a
    // shared link always lands you on that layout.
    if (typeof window !== 'undefined' && isShareHash(window.location.hash)) {
      const hash = window.location.hash;
      // Refused before decoding, with the local house left as it was: a hash
      // this long is no house, and inflating it could take the tab down (#332).
      if (!isShareHashWithinBudget(hash)) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        notify('This shared link is far larger than any house, so it was not opened. Your own house is unchanged.', 'error');
        hydrateFromLocalSave();
        return;
      }
      // decodeShareUrl is async (DecompressionStream). Set the hydration
      // baseline synchronously so the autosave effect stays suppressed while
      // the decode is in flight — otherwise the fallback layout could be
      // scheduled to overwrite the local save before hydration lands.
      hydrationBaseRef.current = layoutRef.current;
      void decodeShareUrl(hash).then((shared) => {
        // Clear the hash either way: reloading after edits must not restore
        // the shared version, nor repeat the broken-link warning.
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        if (shared) {
          // Hydration clears undo and the first edit autosaves over the
          // stored house, so its final state needs a restore point now — the
          // ring's last cadence snapshot may be minutes stale (#298). Reads
          // storage only; the hydration baseline below is untouched.
          const outgoing = loadLayout();
          snapshotBeforeReplace(outgoing);
          // An unreadable save has no restore point to fall back on, and the
          // shared house would autosave over it (#113).
          if (!outgoing) keepStoredHouseAside();
          // Re-capture the baseline right before the hydration dispatch.
          hydrationBaseRef.current = layoutRef.current;
          // A corrupt-but-parseable layout can still throw while it's applied
          // to the scene. Guard the dispatch so a bad share link doesn't crash
          // the whole mount — the error boundary's reset path is the recovery.
          try {
            onHydrate(shared);
            hydrationInFlightRef.current = false;
          } catch (error) {
            console.warn('Failed to apply shared layout:', error);
            // The LOCAL save is healthy and untouched — the failure is the
            // shared layout's. Nulling the baseline here would let the
            // fallback layout autosave over the local house ~debounceMs
            // later (#206). Fall back to the local save instead, same as a
            // link that failed to decode.
            hydrateFromLocalSave();
          }
          return;
        }
        // The hash looks like a share link (`#layout=…`) but failed to decode
        // — truncated or corrupted. Surface a visible notice instead of
        // silently falling back to the local save.
        window.alert(
          'This shared layout link is broken or incomplete and could not be opened. Loading your last saved layout instead.'
        );
        hydrateFromLocalSave();
      });
      return;
    }

    hydrateFromLocalSave();
  }, [onHydrate]);

  useEffect(() => {
    if (restoredLayoutRef.current === layout) { restoredLayoutRef.current = null; return; }
    const held = verifiedWriteRef.current;
    if (held) {
      if (layout.id !== held.expected.id) verifiedWriteRef.current = null;
      else {
        if (!held.verified || !sameLayoutContent(layout, held.layout)) return;
        verifiedWriteRef.current = null;
        if (!held.resumeAutosave) return;
      }
    }
    if (hydrationBaseRef.current) {
      if (Object.is(layout, hydrationBaseRef.current)) return;
      // First layout change after hydration is the hydration dispatch itself,
      // not a user edit — swallow it and resume normal autosave afterwards.
      const hydrated = localHydrationRef.current;
      if (hydrated && !hydrated.id && sameLayoutContent(hydrated.layout, layout)) hydrated.id = layout.id || null;
      hydrationBaseRef.current = null;
      return;
    }
    const saveEpoch = saveEpochRef.current;
    setSaving(true);
    pendingRef.current = true;
    const handle = window.setTimeout(() => {
      if (saveEpoch !== saveEpochRef.current) return;
      // Retried on every edit, so freeing space lets saving resume.
      if (mainSaveHeldRef.current) {
        const outcome = keepStoredLayout();
        if (outcome !== 'kept' && outcome !== 'nothing') {
          setSaveError(outcome);
          return;
        }
        mainSaveHeldRef.current = false;
      }
      const result = saveLayout(layout);
      if (result.ok) {
        lastSavedJsonRef.current = result.json;
        storedBaselineRef.current = { known: true, json: result.json };
        // Only mark the edit persisted on a real success — otherwise the HUD
        // would show "Saved" for a layout that never reached localStorage.
        pendingRef.current = false;
        setLastSavedAt(Date.now());
        setSaving(false);
        setSaveError(null);
        // Restore point (#231): piggyback on the successful autosave. The
        // ring gates its own cadence and swallows quota failures, so this
        // can never break the save that just happened. A blank lot isn't
        // worth a point — and since #342 each one is a new house, so each
        // fresh start would add one.
        if (!isUntouched(layout)) recordSnapshot(layout);
      } else {
        // Keep `saving`/pending truthy and flag the error so the HUD reports
        // the failure instead of a false "Saved". A later successful edit
        // clears the flag.
        setSaveError(result.reason);
      }
    }, debounceMs);
    return () => window.clearTimeout(handle);
  }, [layout, debounceMs, autosaveResume]);

  // A hidden tab may be suspended without pagehide, so flush the same pending save at either boundary.
  useEffect(() => {
    const flush = (): void => {
      if (!pendingRef.current || mainSaveHeldRef.current || verifiedWriteRef.current) return;
      const saveEpoch = saveEpochRef.current;
      const result = saveLayout(layoutRef.current);
      if (saveEpoch !== saveEpochRef.current) return;
      if (result.ok) {
        saveEpochRef.current++; pendingRef.current = false;
        lastSavedJsonRef.current = result.json;
        storedBaselineRef.current = { known: true, json: result.json };
        setLastSavedAt(Date.now()); setSaving(false); setSaveError(null);
        // Capture the stored layout before a hidden or closing page may be suspended.
        if (!isUntouched(layoutRef.current)) recordSnapshot(layoutRef.current, { force: true });
      } else {
        pendingRef.current = true; setSaving(true); setSaveError(result.reason);
      }
    };
    const onVisibilityChange = (): void => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      flush();
    };
  }, []);

  const acknowledgeRestoredLayout = useCallback((restored: RoomLayout, json: string): void => {
    saveEpochRef.current++; restoredLayoutRef.current = restored;
    layoutRef.current = restored; lastSavedJsonRef.current = json;
    pendingRef.current = false; mainSaveHeldRef.current = false; hydrationBaseRef.current = null;
    localHydrationRef.current = null;
    verifiedWriteRef.current = null; storedBaselineRef.current = { known: true, json };
    setSaving(false); setSaveError(null); setLastSavedAt(Date.now()); setRemoteLayout(null);
  }, []);

  const ensurePersistentIdentity = useCallback((): void => {
    function refuse(reason: SaveFailureReason, message: string): never {
      // A queued autosave must not undo this refusal or overwrite the protected record on pagehide.
      saveEpochRef.current++; pendingRef.current = false;
      setSaving(false); setSaveError(reason);
      throw new Error(message);
    }
    if (!hasHydratedRef.current || hydrationInFlightRef.current || hydrationBaseRef.current) {
      refuse('unknown', '活动仍在载入，请稍后重试。');
    }
    if (mainSaveHeldRef.current) refuse('unknown', '原活动存档尚未安全保留，请先处理保存失败。');
    if (verifiedWriteRef.current) refuse('unknown', '任务存档仍待核对，请先重试任务保存。');
    const current = layoutRef.current;
    if (!current.id?.trim()) refuse('unknown', '活动编号尚未就绪，请重新打开活动。');

    let storage: Storage;
    let raw: string | null;
    try {
      storage = window.localStorage;
    } catch (error) {
      refuse(classifyStorageError(error), '无法读取本机存档，请检查浏览器存储权限。');
    }
    if (!storage) refuse('blocked', '无法读取本机存档，请检查浏览器存储权限。');
    try { raw = storage.getItem(STORAGE_KEY); }
    catch (error) { refuse(classifyStorageError(error), '无法读取本机存档，请检查浏览器存储权限。'); }
    if (raw !== null) {
      let stored: RoomLayout | null = null;
      try { stored = parseStoredLayout(JSON.parse(raw)); } catch { /* Refuse unreadable source without replacing it. */ }
      if (!stored) refuse('unknown', '本机存档无法核对，请先恢复或导出备份。');
      if (stored.id) {
        if (stored.id !== current.id) refuse('unknown', '本机存档已切换活动，请重新打开后继续。');
        return;
      }
      const hydrated = localHydrationRef.current;
      if (!hydrated || hydrated.layout.id || hydrated.id !== current.id || !sameLayoutContent(hydrated.layout, stored)) {
        refuse('unknown', '本机存档已变化，请重新打开后继续。');
      }
    } else if (localHydrationRef.current) {
      refuse('unknown', '本机存档已变化，请重新打开后继续。');
    }

    const result = saveLayout(current, storage);
    if (!result.ok) refuse(result.reason, '活动未保存到本机，请检查存储后重试。');
    let readback: string | null;
    try { readback = storage.getItem(STORAGE_KEY); }
    catch (error) { refuse(classifyStorageError(error), '无法回读活动存档，请检查存储后重试。'); }
    let verified: RoomLayout | null = null;
    try { verified = readback === null ? null : parseStoredLayout(JSON.parse(readback)); } catch { /* A save is acknowledged only after strict readback. */ }
    if (readback !== result.json || verified?.id !== current.id) {
      refuse('unknown', '活动存档回读不一致，请重新打开后继续。');
    }
    saveEpochRef.current++; lastSavedJsonRef.current = result.json; pendingRef.current = false;
    storedBaselineRef.current = { known: true, json: result.json };
    setSaving(false); setSaveError(null); setLastSavedAt(Date.now());
  }, []);

  const persistVerifiedLayout = useCallback(async (expected: RoomLayout, next: RoomLayout, guard: () => void): Promise<RoomLayout> => {
    const cancelOlderSave = (): void => { saveEpochRef.current++; pendingRef.current = false; setSaving(false); };
    function refuse(reason: SaveFailureReason, message: string): never {
      cancelOlderSave(); setSaveError(reason); throw new Error(message);
    }
    const checkLive = (): void => {
      try { guard(); } catch (error) { cancelOlderSave(); setSaveError('unknown'); throw error; }
      if (layoutRef.current !== expected) refuse('unknown', '活动内容已变化，请重新核对任务建议。');
    };
    checkLive();
    if (!hasHydratedRef.current || hydrationInFlightRef.current || hydrationBaseRef.current) refuse('unknown', '活动仍在载入，请稍后重试。');
    if (mainSaveHeldRef.current) refuse('unknown', '原活动存档尚未安全保留，请先处理保存失败。');
    if (!expected.id?.trim() || next.id !== expected.id) refuse('unknown', '活动编号不一致，请重新打开活动。');
    const checked = parseLayoutEventOperations(next);
    if (!checked) refuse('unknown', '任务内容无法保存，请重新核对建议。');
    const json = JSON.stringify(checked);
    const normalised = parseStoredLayout(JSON.parse(json));
    if (!normalised || normalised.id !== expected.id || !sameLayoutContent(normalised, checked)) refuse('unknown', '活动存档无法核对，请先恢复或导出备份。');
    const previous = verifiedWriteRef.current;
    if (previous && (previous.expected.id !== expected.id || previous.json !== json)) refuse('unknown', '上次任务保存仍待核对，请先重试原建议。');
    cancelOlderSave();
    if (!previous) verifiedWriteRef.current = { expected, layout: checked, json, verified: false, resumeAutosave: false };
    let storage: Storage;
    let raw: string | null;
    try { storage = window.localStorage; raw = storage.getItem(STORAGE_KEY); }
    catch (error) { refuse(classifyStorageError(error), '无法读取本机存档，请检查浏览器存储权限。'); }
    const baseline = storedBaselineRef.current;
    const ownRetry = previous?.expected.id === expected.id && previous.json === json;
    if (!baseline.known || (raw !== baseline.json && !(ownRetry && raw === json))) {
      refuse('unknown', '本机存档已变化，请重新打开后继续。');
    }
    if (previous && previous.expected !== expected) {
      const matchesOperations = (source: RoomLayout): boolean => {
        const compared = { ...expected };
        if (source.eventOperations === undefined) delete compared.eventOperations;
        else compared.eventOperations = source.eventOperations;
        return sameLayoutContent(expected, compared);
      };
      if (raw !== json || (!matchesOperations(previous.expected) && !matchesOperations(checked))) {
        refuse('unknown', '原任务已有新变化或保存尚未读回，请先核对原建议。');
      }
    }
    if (raw !== null) {
      let stored: RoomLayout | null = null;
      try { stored = parseStoredLayout(JSON.parse(raw)); } catch { /* Leave an unreadable source in place. */ }
      if (!stored) refuse('unknown', '本机存档无法核对，请先恢复或导出备份。');
      if (stored.id !== expected.id) refuse('unknown', '本机存档已切换活动，请重新打开后继续。');
    }
    // Keep the original before-state through another failed read; geometry-only recovery must not redefine it.
    verifiedWriteRef.current = { expected: previous?.expected ?? expected, layout: checked, json, verified: false, resumeAutosave: false };
    checkLive();
    let beforeWrite: string | null;
    try { beforeWrite = storage.getItem(STORAGE_KEY); }
    catch (error) { refuse(classifyStorageError(error), '无法读取本机存档，请检查浏览器存储权限。'); }
    if (beforeWrite !== raw) refuse('unknown', '本机存档已变化，请重新打开后继续。');
    if (raw !== json) {
      const result = saveLayout(checked, storage);
      if (!result.ok) refuse(result.reason, '任务未保存到本机，请检查存储后重试。');
      if (result.json !== json) refuse('unknown', '任务存档回读不一致，请重试原建议。');
    }
    checkLive();
    let readback: string | null;
    try { readback = storage.getItem(STORAGE_KEY); }
    catch (error) { refuse(classifyStorageError(error), '无法回读任务存档，请重试原建议。'); }
    let verified: RoomLayout | null = null;
    try { verified = readback === null ? null : parseStoredLayout(JSON.parse(readback)); } catch { /* Strict readback precedes acknowledgement. */ }
    if (readback !== json || verified?.id !== expected.id || !sameLayoutContent(verified, normalised)) {
      refuse('unknown', '任务存档回读不一致，请重试原建议。');
    }
    checkLive();
    // A read-only task recovery must wait for task application, not replacement by the stored geometry.
    const applicationTarget = raw === json ? { ...expected } : checked;
    if (raw === json) {
      if (checked.eventOperations === undefined) delete applicationTarget.eventOperations;
      else applicationTarget.eventOperations = checked.eventOperations;
    }
    const resumeAutosave = !sameLayoutContent(applicationTarget, checked);
    if (sameLayoutContent(expected, applicationTarget)) {
      verifiedWriteRef.current = null;
      if (resumeAutosave) setAutosaveResume(value => value + 1);
    } else {
      verifiedWriteRef.current = { expected, layout: applicationTarget, json, verified: true, resumeAutosave };
    }
    lastSavedJsonRef.current = json; storedBaselineRef.current = { known: true, json };
    setSaveError(null); setLastSavedAt(Date.now()); setRemoteLayout(null);
    return checked;
  }, []);
  return { lastSavedAt, saving, saveError, remoteLayout, clearRemoteLayout, acknowledgeRestoredLayout, ensurePersistentIdentity, persistVerifiedLayout };
}
