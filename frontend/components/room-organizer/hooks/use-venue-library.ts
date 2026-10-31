'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  VENUE_LIBRARY_EVENT,
  emptyVenueLibrary,
  publishVenueLibrary,
  readVenueLibrary,
  saveVenueFromTemplate,
  type SavedVenue,
  type VenueLibraryState,
} from '../lib/venue-library';

export interface VenueLibraryController {
  lit: boolean;
  venues: readonly SavedVenue[];
  saveFailed: boolean;
  saveTemplate(templateId: string): void;
}

/**
 * 场地库的本机读写。开局读空库；3D 意图或「用作模板」通过同一事件把各处入口刷齐。
 */
export function useVenueLibrary(): VenueLibraryController {
  const [state, setState] = useState<VenueLibraryState>(emptyVenueLibrary);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    const sync = () => setState(readVenueLibrary());
    sync();
    window.addEventListener(VENUE_LIBRARY_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(VENUE_LIBRARY_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const saveTemplate = useCallback((templateId: string) => {
    const next = saveVenueFromTemplate(readVenueLibrary(), templateId, Date.now());
    setSaveFailed(!publishVenueLibrary(next));
  }, []);

  return { lit: state.lit, venues: state.venues, saveFailed, saveTemplate };
}
