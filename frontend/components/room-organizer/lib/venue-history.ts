import type { RoomLayout } from './types';

type VenueIdentity = { assetId: string; name: string };

/** Preserve the venue association when the layout reducer creates a fresh snapshot object. */
export function applyVenueHistorySnapshot(
  snapshot: RoomLayout,
  associations: WeakMap<RoomLayout, VenueIdentity>,
  currentLayout: () => RoomLayout,
  applyLayout: (value: RoomLayout) => void,
  currentVenue: () => string | undefined,
  restoreVenue: (venue: VenueIdentity, previousLayout: RoomLayout) => void,
): void {
  const previousLayout = currentLayout();
  const venue = associations.get(snapshot) ?? snapshot.venueScan;
  applyLayout(snapshot);
  if (!venue) return;
  associations.set(currentLayout(), venue);
  if (venue.assetId !== currentVenue()) restoreVenue(venue, previousLayout);
}
