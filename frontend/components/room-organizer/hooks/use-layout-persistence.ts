import { localWriteCapabilityGuard, type LocalWriteCapability } from '@/lib/local-write-lease';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  downloadRawLayout,
  withoutExpiringAssetUrls,
} from '../lib/persistence';
import { isUntouched, snapshotBeforeReplace } from '../lib/restore-point';
import { parseLayoutEventOperations, parseStoredLayout } from '../lib/schema';
import { decodeShareUrl, isShareHash, isShareHashWithinBudget } from '../lib/share';
import { recordSnapshot } from '../lib/version-history';
import {retainReadonlyDraft} from '../lib/readonly-draft-registry';
import type { SaveFailureReason } from '../lib/persistence';
import type { RoomLayout } from '../lib/types';

export interface UseLayoutPersistenceOptions {
  layout: RoomLayout;
  onHydrate: (layout: RoomLayout) => void;
  debounceMs?: number;
  /** Compatibility: omitted keeps legacy behavior. A connected workspace must pass its live lease assertion. */
  assertWriteLease?: () => void;
  /** Optional real capability; once supplied it cannot be removed or swapped during this mount. */
  localWriteCapability?: LocalWriteCapability | undefined;
  /** Synchronous layout identity, used to fence callbacks before React commits. */
  layoutSource?: {getState():{layout:RoomLayout;revision:number};subscribe(listener:()=>void):()=>void}|undefined;
}

export interface InterruptedLayoutDraft {key:number;scope:string;name:string}

export interface UseLayoutPersistenceResult {
  /** Verify the current activity id in storage, saving a fresh or hydrated ID-less activity if needed. Throws on refusal. */
  ensurePersistentIdentity(): void;
  /** Flush and read back the outgoing layout before changing activities. */
  flushPendingBeforeSwitch(expected?:RoomLayout): () => void;
  /** Unsaved layouts captured after an unexpected switch; memory-only. */
  interruptedDrafts: readonly InterruptedLayoutDraft[];
  downloadInterruptedDraft(key:number): void;
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
  reopenRemoteLayout(): void;
  externalConflict: boolean;
  hasRemoteCandidate: boolean;
}

export function useLayoutPersistence({
  layout,
  onHydrate,
  debounceMs = AUTOSAVE_DEBOUNCE_MS,
  assertWriteLease,
  localWriteCapability,
  layoutSource,
}: UseLayoutPersistenceOptions): UseLayoutPersistenceResult {
  const writeLeaseRef = useRef(assertWriteLease);
  writeLeaseRef.current = assertWriteLease;
  const capabilityRef = useRef<{value:LocalWriteCapability; revoked:boolean}|null>(null);
  if (!capabilityRef.current && localWriteCapability !== undefined) capabilityRef.current={value:localWriteCapability,revoked:false};
  else if (capabilityRef.current && localWriteCapability !== capabilityRef.current.value) capabilityRef.current.revoked=true;
  function requireWriteLease(): void {
    writeLeaseRef.current?.();
    if (capabilityRef.current) {
      if (capabilityRef.current.revoked) throw new Error('本机编辑权已变化，保存已暂停。');
      try { localWriteCapabilityGuard(capabilityRef.current.value).assertStillHeld(); }
      catch { capabilityRef.current.revoked=true; throw new Error('本机编辑权已失效，保存已暂停。'); }
    }
  }
  function hasWriteLease(): boolean {
    try { requireWriteLease(); return true; }
    catch { setSaveError('unknown'); return false; }
  }
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
  const sourceEpochRef=useRef(0);
  const renderedSourceEpochRef=useRef(0);renderedSourceEpochRef.current=sourceEpochRef.current;
  const interruptedRef=useRef<Array<InterruptedLayoutDraft & {layout:RoomLayout}>>([]);
  const [interruptedDrafts,setInterruptedDrafts]=useState<InterruptedLayoutDraft[]>([]);
  const restoredLayoutRef = useRef<RoomLayout | null>(null);
  // The main save holds a house that couldn't be opened and couldn't be
  // copied aside (storage full): it's the only copy, so nothing may be
  // written over it until a copy succeeds.
  const mainSaveHeldRef = useRef(false);
  const [remoteLayout, setRemoteLayout] = useState<RoomLayout | null>(null);
  // A dismissed notice is not consent to overwrite another tab's work.
  const externalConflictRef = useRef(false);
  const [externalConflict, setExternalConflict] = useState(false);
  const deferredRemoteRef = useRef<RoomLayout | null>(null);
  const markExternalConflict = (value: boolean): void => {
    externalConflictRef.current = value;
    setExternalConflict(value);
    if (!value) deferredRemoteRef.current = null;
  };
  const sameActivity = (a: RoomLayout, b: RoomLayout): boolean => (a.id ?? null) === (b.id ?? null) && sameLayoutContent(a, b);
  const mayWriteCurrentLayout = (): boolean => {
    if (externalConflictRef.current) return false;
    const baseline = storedBaselineRef.current;
    if (!baseline.known) return false;
    try {
      const current = window.localStorage.getItem(STORAGE_KEY);
      if (current === baseline.json) return true;
      const parsed = current === null ? null : parseStoredLayout(JSON.parse(current));
      if (parsed && sameActivity(parsed, layoutRef.current)) {
        storedBaselineRef.current = { known: true, json: current };
        return true;
      }
      markExternalConflict(true);
      if (parsed) { deferredRemoteRef.current = parsed; setRemoteLayout(parsed); }
      setSaveError('unknown');
      return false;
    } catch {
      markExternalConflict(true);
      setSaveError('unknown');
      return false;
    }
  };

  // Observe the source synchronously: React's effect cleanup can happen after
  // an already-due autosave when an activity is replaced in the same batch.
  useLayoutEffect(()=>{
    if(!layoutSource)return;
    let previous=layoutSource.getState().layout;
    return layoutSource.subscribe(()=>{
      const next=layoutSource.getState().layout;
      if(next===previous)return;
      sourceEpochRef.current++;
      const outgoing=previous;previous=next;
      if((outgoing.id??null)===(next.id??null)||!hasHydratedRef.current||hydrationInFlightRef.current)return;
      let saved=false;
      try{
        const raw=storedBaselineRef.current.known?storedBaselineRef.current.json:null;
        const stored=raw===null?null:parseStoredLayout(JSON.parse(raw));
        saved=window.localStorage.getItem(STORAGE_KEY)===raw&&!!stored&&(stored.id??null)===(outgoing.id??null)&&sameLayoutContent(stored,withoutExpiringAssetUrls(outgoing));
      }catch{/* Unknown storage means the outgoing draft must be retained. */}
      if(saved)return;
      let copy=outgoing;try{copy=structuredClone(outgoing);}catch{/* Retain the immutable old reference as a last resort. */}
      const key=(interruptedRef.current.at(-1)?.key??0)+1;
      const entry={key,scope:outgoing.id??'local',name:outgoing.name||'未命名活动',layout:copy};
      interruptedRef.current=[...interruptedRef.current,entry];
      retainReadonlyDraft(entry.scope,'layout',{status:'captured',value:copy});
      setInterruptedDrafts(interruptedRef.current.map(({key:entryKey,scope,name})=>({key:entryKey,scope,name})));
      setSaveError('unknown');
      notify('切换前的活动有未保存草稿，已暂留本页，请导出核对后再关闭。','error');
    });
  },[layoutSource]);

  const downloadInterruptedDraft=useCallback((key:number):void=>{
    const draft=interruptedRef.current.find(entry=>entry.key===key);
    if(!draft)throw new Error('未保存草稿不可用，请保留当前页面。');
    downloadRawLayout(JSON.stringify(draft.layout),`未保存的活动草稿-${key}.json`);
  },[]);

  // Cross-tab guard (#123): the `storage` event only fires in OTHER tabs of
  // the same origin, so any event on our key means a different tab saved.
  // A different tab, but not necessarily a different house: after one tab
  // adopts the other's version its autosave writes that same house back, and
  // flagging it would bounce the notice between the tabs forever (#334).
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== STORAGE_KEY) return;
      if (event.newValue === null) { markExternalConflict(true); setSaveError('unknown'); return; }
      if (event.newValue === lastSavedJsonRef.current) {
        // Storage is back to what this tab wrote: a notice offering the
        // other tab's version is stale, and adopting it would restart the
        // ping-pong (#334).
        markExternalConflict(false);
        storedBaselineRef.current = { known: true, json: event.newValue };
        setRemoteLayout(null);
        return;
      }
      try {
        const parsed = parseStoredLayout(JSON.parse(event.newValue));
        if (!parsed) { markExternalConflict(true); setSaveError('unknown'); return; }
        // Both sides through the same schema pass, so defaults it fills in
        // don't read as a difference.
        const shown = layoutRef.current;
        const shownNormalised = parseStoredLayout(JSON.parse(JSON.stringify(shown))) ?? shown;
        if (sameActivity(parsed, shownNormalised)) {
          // The other tab now holds what this one shows: any earlier notice is moot.
          markExternalConflict(false);
          storedBaselineRef.current = { known: true, json: event.newValue };
          setRemoteLayout(null);
          return;
        }
        markExternalConflict(true);
        setSaveError('unknown');
        deferredRemoteRef.current = parsed;
        setRemoteLayout(parsed);
      } catch {
        markExternalConflict(true);
        setSaveError('unknown');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const clearRemoteLayout = useCallback(() => setRemoteLayout(null), []);
  const reopenRemoteLayout = useCallback(() => setRemoteLayout(deferredRemoteRef.current), []);

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
      if (!hasWriteLease()) { mainSaveHeldRef.current = true; return; }
      const outcome = keepStoredLayout(undefined, undefined, writeLeaseRef.current || capabilityRef.current ? requireWriteLease : undefined);
      if (outcome === 'kept') {
        notify('本机保存的布置打不开，原件已另存一份，暂时不会覆盖。', 'info');
      }
      if (outcome === 'kept' || outcome === 'nothing') return;
      mainSaveHeldRef.current = true;
      setSaveError(outcome);
    };

    const hydrateFromLocalSave = (): void => {
      const saved = loadLayout(writeLeaseRef.current || capabilityRef.current ? requireWriteLease : undefined);
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
        notify('这个分享链接的数据量远超一份场地布置，未打开；你本机的布置没有变化。', 'error');
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
          const outgoing = loadLayout(writeLeaseRef.current || capabilityRef.current ? requireWriteLease : undefined);
          if (!hasWriteLease()) { hydrateFromLocalSave(); return; }
          if (!outgoing && capabilityRef.current) {
            try {
              if (window.localStorage.getItem(STORAGE_KEY) !== null) {
                notify('原方案无法读取或核对，分享方案未打开。', 'error');
                hydrateFromLocalSave(); return;
              }
            } catch { notify('本机方案无法读取，分享方案未打开。', 'error'); hydrateFromLocalSave(); return; }
          }
          if (!snapshotBeforeReplace(outgoing, writeLeaseRef.current || capabilityRef.current ? requireWriteLease : undefined, capabilityRef.current?.value) || !hasWriteLease()) {
            notify('原方案恢复点未能确认保存，分享方案未打开。', 'error');
            hydrateFromLocalSave(); return;
          }
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
    if (externalConflictRef.current) {
      // Accepting the current stored version is safe; dismissing the notice alone is not.
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const stored = raw === null ? null : parseStoredLayout(JSON.parse(raw));
        if (stored && sameActivity(stored, layout)) {
          markExternalConflict(false); storedBaselineRef.current = { known: true, json: raw };
          pendingRef.current = false; setSaving(false); setSaveError(null); setRemoteLayout(null);
        }
      } catch { /* Leave the freeze in place. */ }
      if (externalConflictRef.current) return;
    }
    const saveEpoch = saveEpochRef.current,sourceEpoch=sourceEpochRef.current;
    const sourceCurrent=()=>!layoutSource||(sourceEpochRef.current===sourceEpoch&&layoutSource.getState().layout===layout);
    if(!sourceCurrent())return;
    setSaving(true);
    pendingRef.current = true;
    const handle = window.setTimeout(() => {
      if (saveEpoch !== saveEpochRef.current || !sourceCurrent()) return;
      // Retried on every edit, so freeing space lets saving resume.
      if (!hasWriteLease()) return;
      if (mainSaveHeldRef.current) {
        const outcome = keepStoredLayout(undefined, undefined, writeLeaseRef.current || capabilityRef.current ? requireWriteLease : undefined);
        if (outcome !== 'kept' && outcome !== 'nothing') {
          setSaveError(outcome);
          return;
        }
        mainSaveHeldRef.current = false;
      }
      if (!mayWriteCurrentLayout() || !hasWriteLease()) return;
      const assertCurrent=()=>{requireWriteLease();if(!sourceCurrent())throw new Error('活动已变化，旧草稿未保存。');};
      const result = saveLayout(layout, undefined, layoutSource||writeLeaseRef.current||capabilityRef.current ? assertCurrent : undefined);
      if (!hasWriteLease() || !sourceCurrent()) return;
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
        if (!isUntouched(layout)) recordSnapshot(layout, { ...(writeLeaseRef.current || capabilityRef.current ? { assertWrite: requireWriteLease } : {}), ...(capabilityRef.current ? {capability:capabilityRef.current.value} : {}) });
      } else {
        // Keep `saving`/pending truthy and flag the error so the HUD reports
        // the failure instead of a false "Saved". A later successful edit
        // clears the flag.
        setSaveError(result.reason);
      }
    }, debounceMs);
    return () => window.clearTimeout(handle);
  }, [layout, debounceMs, autosaveResume,layoutSource]);

  // The caller supplies a stable assertion per lease. A new assertion signals a
  // newly acquired lease; never resume a dirty draft over a changed stored base.
  useEffect(() => {
    if (!assertWriteLease || !pendingRef.current || verifiedWriteRef.current || mainSaveHeldRef.current) return;
    if (!hasWriteLease() || !mayWriteCurrentLayout()) return;
    setAutosaveResume(value => value + 1);
  }, [assertWriteLease]); // eslint-disable-line react-hooks/exhaustive-deps

  // A hidden tab may be suspended without pagehide, so flush the same pending save at either boundary.
  useEffect(() => {
    const flush = (): void => {
      if (!pendingRef.current || mainSaveHeldRef.current || verifiedWriteRef.current || !hasWriteLease() || !mayWriteCurrentLayout() || !hasWriteLease()) return;
      const sourceEpoch=renderedSourceEpochRef.current,current=layoutRef.current;
      const sourceCurrent=()=>!layoutSource||(sourceEpochRef.current===sourceEpoch&&layoutSource.getState().layout===current);
      if(!sourceCurrent())return;
      const saveEpoch = saveEpochRef.current;
      const assertCurrent=()=>{requireWriteLease();if(!sourceCurrent())throw new Error('活动已变化，旧草稿未保存。');};
      const result = saveLayout(current, undefined, layoutSource||writeLeaseRef.current||capabilityRef.current ? assertCurrent : undefined);
      if (!hasWriteLease() || !sourceCurrent()) return;
      if (saveEpoch !== saveEpochRef.current) return;
      if (result.ok) {
        saveEpochRef.current++; pendingRef.current = false;
        lastSavedJsonRef.current = result.json;
        storedBaselineRef.current = { known: true, json: result.json };
        setLastSavedAt(Date.now()); setSaving(false); setSaveError(null);
        // Capture the stored layout before a hidden or closing page may be suspended.
        if (!isUntouched(current)) recordSnapshot(current, { force: true, ...(writeLeaseRef.current || capabilityRef.current ? { assertWrite: requireWriteLease } : {}), ...(capabilityRef.current ? { capability:capabilityRef.current.value } : {}) });
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
  }, [layoutSource]);

  const acknowledgeRestoredLayout = useCallback((restored: RoomLayout, json: string): void => {
    saveEpochRef.current++; restoredLayoutRef.current = restored;
    layoutRef.current = restored; lastSavedJsonRef.current = json;
    pendingRef.current = false; mainSaveHeldRef.current = false; hydrationBaseRef.current = null;
    localHydrationRef.current = null;
    verifiedWriteRef.current = null; markExternalConflict(false); storedBaselineRef.current = { known: true, json };
    setSaving(false); setSaveError(null); setLastSavedAt(Date.now()); setRemoteLayout(null);
  }, []);

  const flushPendingBeforeSwitch=useCallback((expected?:RoomLayout):(()=>void)=>{
    const current=layoutSource?.getState().layout??layoutRef.current,sourceEpoch=sourceEpochRef.current;
    const sourceCurrent=()=>!layoutSource||(sourceEpochRef.current===sourceEpoch&&layoutSource.getState().layout===current);
    const refuse=(message:string):never=>{setSaveError('unknown');setSaving(true);pendingRef.current=true;throw new Error(message);};
    if(expected&&expected!==current)return refuse('活动已变化，请重新核对后切换。');
    if(!hasHydratedRef.current||hydrationInFlightRef.current||hydrationBaseRef.current)return refuse('活动仍在载入，未切换。');
    if(mainSaveHeldRef.current||verifiedWriteRef.current||externalConflictRef.current)return refuse('本机存档尚待核对，未切换活动。');
    if(!hasWriteLease()||!sourceCurrent()||!mayWriteCurrentLayout())return refuse('当前活动无法安全保存，未切换；请保留草稿并核对。');
    const guard=()=>{requireWriteLease();if(!sourceCurrent())throw new Error('活动已变化，未切换。');};
    const result=saveLayout(current,undefined,guard);
    if(!result.ok)return refuse('当前活动未保存，未切换；请保留草稿并检查本机存储。');
    try{
      guard();const raw=window.localStorage.getItem(STORAGE_KEY),saved=raw===null?null:parseStoredLayout(JSON.parse(raw));
      if(raw!==result.json||!saved||(saved.id??null)!==(current.id??null)||!sameLayoutContent(saved,withoutExpiringAssetUrls(current)))throw new Error('readback mismatch');
      guard();
    }catch{return refuse('当前活动保存结果无法核对，未切换；请保留草稿。');}
    saveEpochRef.current++;lastSavedJsonRef.current=result.json;storedBaselineRef.current={known:true,json:result.json};
    pendingRef.current=false;setSaving(false);setSaveError(null);setLastSavedAt(Date.now());
    return guard;
  },[layoutSource]);

  const ensurePersistentIdentity = useCallback((): void => {
    function refuse(reason: SaveFailureReason, message: string, preservePending = false): never {
      // A queued autosave must not undo this refusal or overwrite the protected record on pagehide.
      saveEpochRef.current++;
      if (!preservePending) pendingRef.current = false;
      setSaving(pendingRef.current); setSaveError(reason);
      throw new Error(message);
    }
    try { requireWriteLease(); } catch { refuse('unknown', '本机编辑权已失效，请先核对后继续。', true); }
    if (!hasHydratedRef.current || hydrationInFlightRef.current || hydrationBaseRef.current) {
      refuse('unknown', '活动仍在载入，请稍后重试。');
    }
    if (externalConflictRef.current) refuse('unknown', '另一标签页已更新本地活动，请先核对后继续。');
    if (mainSaveHeldRef.current) refuse('unknown', '原活动存档尚未安全保留，请先处理保存失败。');
    if (verifiedWriteRef.current) refuse('unknown', '任务存档仍待核对，请先重试任务保存。');
    const current = layoutRef.current;
    const sourceEpoch=renderedSourceEpochRef.current;
    const sourceCurrent=()=>!layoutSource||(sourceEpochRef.current===sourceEpoch&&layoutSource.getState().layout===current);
    if(!sourceCurrent())refuse('unknown','活动已变化，请在当前活动重新核对。',true);
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

    try { requireWriteLease(); } catch { refuse('unknown', '本机编辑权已失效，请先核对后继续。', true); }
    const assertCurrent=()=>{requireWriteLease();if(!sourceCurrent())throw new Error('活动已变化。');};
    const result = saveLayout(current, storage, layoutSource||writeLeaseRef.current||capabilityRef.current ? assertCurrent : undefined);
    try { assertCurrent(); } catch { refuse('unknown', '活动或本机编辑权已变化，存档需重新核对。', true); }
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
  }, [layoutSource]);

  const persistVerifiedLayout = useCallback(async (expected: RoomLayout, next: RoomLayout, guard: () => void): Promise<RoomLayout> => {
    const pendingBefore = pendingRef.current;
    const sourceEpoch=renderedSourceEpochRef.current;
    const cancelOlderSave = (preservePending = false): void => { saveEpochRef.current++; if (!preservePending) pendingRef.current = false; setSaving(pendingRef.current); };
    function refuse(reason: SaveFailureReason, message: string): never {
      cancelOlderSave(); setSaveError(reason); throw new Error(message);
    }
    const checkLive = (): void => {
      try { requireWriteLease(); } catch (error) { if (pendingBefore) pendingRef.current = true; cancelOlderSave(true); setSaveError('unknown'); throw error; }
      try { guard(); } catch (error) { cancelOlderSave(); setSaveError('unknown'); throw error; }
      if(layoutSource&&(sourceEpochRef.current!==sourceEpoch||layoutSource.getState().layout!==expected))refuse('unknown','活动内容已变化，请重新核对任务建议。');
      if (layoutRef.current !== expected) refuse('unknown', '活动内容已变化，请重新核对任务建议。');
    };
    checkLive();
    if (!hasHydratedRef.current || hydrationInFlightRef.current || hydrationBaseRef.current) refuse('unknown', '活动仍在载入，请稍后重试。');
    if (externalConflictRef.current) refuse('unknown', '另一标签页已更新本地活动，请先核对后继续。');
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
      checkLive();
      const result = saveLayout(checked, storage, layoutSource||writeLeaseRef.current||capabilityRef.current ? checkLive : undefined);
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
    pendingRef.current = resumeAutosave;
    setSaving(resumeAutosave);
    if (sameLayoutContent(expected, applicationTarget)) {
      verifiedWriteRef.current = null;
      if (resumeAutosave) setAutosaveResume(value => value + 1);
    } else {
      verifiedWriteRef.current = { expected, layout: applicationTarget, json, verified: true, resumeAutosave };
    }
    lastSavedJsonRef.current = json; storedBaselineRef.current = { known: true, json };
    setSaveError(null); setLastSavedAt(Date.now()); setRemoteLayout(null);
    return checked;
  }, [layoutSource]);
  return { lastSavedAt, saving, saveError, remoteLayout, clearRemoteLayout, reopenRemoteLayout, externalConflict, hasRemoteCandidate: deferredRemoteRef.current !== null, acknowledgeRestoredLayout, ensurePersistentIdentity, persistVerifiedLayout,flushPendingBeforeSwitch,interruptedDrafts,downloadInterruptedDraft };
}
