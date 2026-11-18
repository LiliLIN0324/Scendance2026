/**
 * 物料能力标签（生成文件，请勿手改）。
 *
 * 由 `scripts/build-library-capabilities.mjs` 从 `assets/library/merged.json` 生成：
 * - `source: 'curated'` 是人工定稿（OVERRIDES）；
 * - `source: 'rule'` 是按桶 + 名称 + slug 物件段的离线分类。
 *
 * 运行时只查这张表（`prop-capabilities.ts`），不再按 slug 子串猜能力。
 * 新增物料后重跑生成器；要改某件物料，改 OVERRIDES 再生成，别手改本文件。
 */
import type { PropCapabilityEntry } from './prop-capabilities';

export const LIBRARY_CAPABILITIES: Readonly<Record<string, PropCapabilityEntry>> = {
  "beach-surf-and-paddle-kit-folding-beach-chair-68794f97": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "bedroom-and-living-room-furniture-desk-task-chair-e1320da0": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "casino-floor-and-back-rooms-dealer-chair-f39054bd": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "bedroom-and-living-room-furniture-dining-chair-upholst-7ec33345": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "voxel-city-districts-bar-stool-15ad652a": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "indoor-market-hall-and-traders-stall-stool-3c24a76c": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "music-recording-studio-and-instruments-studio-stool-a2c0747a": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "tattoo-and-piercing-studio-artists-stool-4b12a1fb": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "bedroom-and-living-room-furniture-sofa-three-seat-6be9b44b": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "hotel-and-resort-operations-lobby-sofa-79174bf1": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "bedroom-and-living-room-furniture-sofa-two-seat-904fa140": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "clinic-and-veterinary-practice-examination-couch-adjus-ac07fdf2": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "hospital-wards-and-clinic-operations-waiting-bench-row-4a483ebb": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "steampunk-airship-dock-and-workshop-workbench-ed991aad": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "distillery-and-bonded-warehouse-racking-bench-5530b468": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "distillery-and-bonded-warehouse-stencil-bench-92b00a0a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "marina-and-yacht-club-marina-and-yacht-club-terrace-ta-e463ef37": {
    "kind": 'seat-set',
    "actions": ['sit'],
    "source": 'rule'
  },
  "andean-terraces-and-stone-village-terrace-wall-high-54f771ed": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-terrace-tier-d060e188": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "baseball-park-and-batting-cages-bleacher-stand-2ab80b42": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "zombie-quarantine-streets-food-distribution-table-b72c37f7": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "human-anatomy-and-education-kit-bench-table-775888b5": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "steampunk-airship-dock-and-workshop-chart-table-6d4aed38": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "casino-floor-and-back-rooms-cocktail-table-329ca6f8": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "downtown-office-interiors-desk-executive-6ef42aca": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "tv-studio-and-broadcast-gallery-gallery-desk-run-a72b3947": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "downtown-office-interiors-desk-1600-panel-end-9c79542d": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "computers-and-desk-gadgets-desk-1400-c38edf1c": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "distillery-and-bonded-warehouse-tasting-counter-5c8e94aa": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "fast-food-and-drive-thru-holding-cabinet-door-open-1b2f4d59": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "cinema-multiplex-and-foyer-nacho-and-hot-dog-counter-686a7c9e": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'curated'
  },
  "hearing-aid-and-audiology-clinic-appointment-reception-95ca2b14": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "city-courthouse-and-records-office-city-courthouse-and-6bcfd40f": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "griffin-airmail-roost-and-posthouse-route-map-lectern-8634b74f": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "abandoned-cinema-and-projection-booth-abandoned-cinema-dbdc40c1": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "wedding-and-chapel-kit-chapel-lectern-df983527": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "travelling-circus-and-big-top-circus-ticket-booth-428cc272": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'curated'
  },
  "restaurant-kitchen-and-dining-booth-2-cover-accent-5fa7aeaf": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "nightclub-and-dj-booth-lighting-truss-straight-8d2acafa": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "restaurant-kitchen-and-dining-booth-4-cover-31918298": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "harbor-and-tackle-fish-market-stall-d82006ea": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "theme-park-rides-and-coasters-theme-park-rides-and-coa-55e52c8d": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "medieval-mmo-starter-realm-market-stall-e0677cc9": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "canal-town-and-windmill-market-stall-with-awning-a330661e": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "music-recording-studio-and-instruments-electric-guitar-7ef7ab5a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "velodrome-and-track-cycling-bell-on-stand-31ceff7b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "steampunk-airship-dock-and-workshop-flight-gear-stand-b2d883bc": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "music-recording-studio-and-instruments-bass-guitar-on--c2780ecc": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "fresh-produce-and-groceries-greengrocer--86f48b0c-starter-scene": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "modern-rail-and-metro-network-information-display-1f74d599": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "steampunk-airship-dock-and-workshop-gear-stand-1f118594": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "garden-centre-and-florist-fence-panel-display-rack-3d4aa56d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hotel-and-resort-operations-spa-reception-desk-8e1bcf19": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "office-lobby-and-facilities-reception-desk-module-910ee715": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "community-sports-hall-and-changing-rooms-reception-des-ee569bd0": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "factory-conveyor-network-factory-conveyor-network-pipe-cdcbbb64": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-lighting-bar-with--9d1b9fb6": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "orchestra-and-band-instruments-concert-s-8aaba2c3-starter-scene": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-drum-kit-shell-set-a2d5fafe": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-stage-deck-module-b23478f5": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "machine-shop-and-factory-hall-machine-shop-and-factory-8d85e1d0": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "steampunk-airship-dock-and-workshop-shed-roof-truss-cdf34936": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "wedding-and-chapel-kit-chapel-roof-bay-6c89de0c": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "velodrome-and-track-cycling-flood-light-truss-e50be79a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hearing-aid-and-audiology-clinic-free-field-test-speak-86e5beac": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-line-array-speaker-7500d812": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "dog-agility-and-training-field-pa-speaker-post-8d62a208": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "nightclub-and-dj-booth-hanging-speaker-c73e7811": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "music-recording-studio-and-instruments-vocal-mic-with--b6c69c11": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "city-courthouse-and-records-office-city-courthouse-and-53b03ef5": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hearing-aid-and-audiology-clinic-probe-microphone-head-5d89b7c9": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "computers-and-desk-gadgets-microphone-condenser-762c7fa7": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "steampunk-airship-dock-and-workshop-signal-lamp-1a96f759": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "care-home-and-day-room-floor-lamp-d9eec340": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "fps-survival-forest-outpost-floodlight-mast-98fcda0b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "police-station-and-detective-office-swing-arm-lamp-c61b6b30": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "cinema-multiplex-and-foyer-cinema-screen-and-masking-92b7d56f": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hospital-wards-and-clinic-operations-privacy-screen-6adde32a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "museum-conservation-and-art-restoration-museum-conserv-9b435540": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "escape-room-and-puzzle-venue-briefing-screen-on-stand-9d2b7005": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "cruise-ship-deck-and-lounge-cruise-ship-deck-and-loung-73390ffd": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "nightclub-and-dj-booth-backdrop-led-panel-module-831305f2": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "nightclub-and-dj-booth-backdrop-led-panel-module-cyan-4133ef86": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "escape-room-and-puzzle-venue-photo-backdrop-with-frame-0f587850": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "distillery-and-bonded-warehouse-hoop-stack-f2d9b2de": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "basketball-club-and-street-courts-anchored-hoop-380419f7": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "basketball-club-and-street-courts-portable-hoop-df2b2c77": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "wilderness-survival-camp-bivouac-hoop-shelter-1d5a0203": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-mini-goal-b4e93f9b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "community-sports-hall-and-changing-rooms-five-a-side-g-32bd7f98": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-scoreboard-e12a4ed5": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "ice-hockey-arena-and-locker-room-arena-scoreboard-655d2b37": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "dog-agility-and-training-field-scoreboard-post-23b98089": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "laser-tag-arena-and-activity-centre-scoreboard-wall-fr-b2654443": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "vfx-mesh-library-thruster-cone-a2af2dfc": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "steampunk-airship-dock-and-workshop-mooring-bollard-0886a456": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "vfx-mesh-library-hover-jet-cone-0eb53517": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "harbor-and-tackle-harbor-bollard-36ce647e": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "tool-hire-depot-and-plant-yard-tool-hire-depot-and-pla-94a6ecfd": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "alien-biosphere-brush-head-fb434803": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "care-home-and-day-room-potted-plant-tall-e50d9742": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "tool-hire-depot-and-plant-yard-tool-hire-depot-and-pla-f27b6012": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "botanical-glasshouse-and-palm-house-botanical-glasshou-3f717859": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "jelly-friends-playroom-potted-fern-46bf82a5": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "voxel-city-districts-raised-planter-5ebe7904": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "winter-hearth-village-winter-berry-planter-22af2844": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "fantasy-mmo-city-and-townsfolk-city-broadleaf-tree-0328372c": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "wipe-day-survival-island-pine-tree-dfc88d2b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "racecourse-and-parade-ring-paddock-tree-91f358c4": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "turning-seasons-spring-orchard-tree-4f507ab0": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "wipe-day-survival-island-berry-bush-0694adfc": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "safari-camp-and-bush-lodge-folding-camp-chair-20878b9f": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "safari-camp-and-bush-lodge-pole-and-wire-fence-section-5cd9cd73": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "safari-camp-and-bush-lodge-grass-tuft-cluster-8eaa2b17": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "fantasy-mmo-city-and-townsfolk-clipped-hedge-block-ea0b52b0": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "city-park-and-playground-hedge-section-c1ff730d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "pixel-modern-farm-hedge-run-0ee547bc": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "lawn-mowing-simulator-kit-hedge-block-2m-ec0f9b45": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "steampunk-airship-dock-and-workshop-gas-lantern-afc5ebc9": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "turning-seasons-winter-lantern-dc1a8170": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "harbor-and-tackle-camp-lantern-81612db6": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "lantern-watch-courtyard-flame-brazier": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "airport-terminal-and-ground-operations-information-tot-d38d78b4": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "battle-royale-town-and-airfield-road-sign-post-c45b9b7c": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "ski-resort-and-snow-park-trail-sign-post-0fbf6fda": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "theatre-stage-and-backstage-exit-sign-and-door-module-f64fc225": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-festival-flag-pole-6d4f8842": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "bus-station-and-city-transit-bus-stop-pole-with-flag-3071e762": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hot-air-balloon-festival-event-flag-pole-f98bce99": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-festival-flag-pole-a34eab89": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "arena-shooter-map-kit-banner-31542f76": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "velodrome-and-track-cycling-banner-rail-run-4a15542b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "halloween-slasher-street-halloween-pennant-banner-e9003fa9": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "fantasy-mmo-city-and-townsfolk-hanging-guild-banner-67cde01e": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "neon-dispatch-parcel-yard-barrier": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hardware-store-and-diy-warehouse-aisle-safety-barrier-0423d23e": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "laundrette-and-cleaning-caution-barrier-post-75cbf09d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "nightclub-and-dj-booth-rope-barrier-post-with-rope-327c14d3": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "car-park-and-road-vehicle-fleet-bollard-e7119d33": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "bus-station-and-city-transit-street-bollard-7db606aa": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "machine-shop-and-factory-hall-machine-shop-and-factory-eb9d099e": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "voxel-city-districts-bollard-4e19587e": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "car-park-and-road-vehicle-fleet-double-cab-pickup-cano-aa92dedb": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-stage-roof-canopy--f849524b": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "powerboat-racing-and-launch-ramp-cabin-cruiser-canopy-11c4fda1": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "roadside-survival-stops-pump-canopy-corner-4c17359e": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "beach-surf-and-paddle-kit-beach-umbrella-fb839e7d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "harbor-and-tackle-fishing-umbrella-53ccf80c": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "motorcycle-racing-and-street-bikes-umbrella-ef9fbcd7": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "greek-island-village-and-harbour-cafe-parasol-a99c4044": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "almanac-gardens-garden-pergola-36e88395": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "city-park-and-playground-pergola-f44394ba": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "greek-island-village-and-harbour-grape-pergola-with-vi-5a3fe0db": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "greek-island-village-and-harbour-roof-terrace-with-per-a9847509": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "harbor-and-tackle-pier-railing-79e66c86": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "steampunk-airship-dock-and-workshop-dock-railing-panel-e62f5297": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "farm-and-working-animals-hd-fence-straight-abfd7b2a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "harvest-hearth-split-rail-fence": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "tv-studio-and-broadcast-gallery-glass-partition-door-m-bd121cea": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "tv-studio-and-broadcast-gallery-glass-partition-module-bf80147b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "police-station-and-detective-office-partition-wall-pla-eac2cc8e": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "downtown-office-interiors-glazed-partition-door-module-180c4720": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "paranormal-investigation-house-interior-door-3d3cfbcc": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "medieval-monastery-and-scriptorium-monastery-door-bay-a5edad0f": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "restaurant-kitchen-and-dining-upright-fridge-double-06328b60": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "botanical-glasshouse-and-palm-house-botanical-glasshou-3dc62c89": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "japanese-school-and-city-street-classroom-wall-window-7c9dbfa2": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "desert-mosque-and-madrasa-courtyard-iron-window-grille-17aa98e2": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "medieval-monastery-and-scriptorium-monastery-lancet-wi-c0c13950": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "community-sports-hall-and-changing-rooms-hall-wall-mod-275ea046": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "dog-agility-and-training-field-field-litter-bin-eeefea95": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "steampunk-airship-dock-and-workshop-parts-bin-rack-0547387b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "modern-rail-and-metro-network-waste-bin-57f44ea1": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "public-swimming-baths-and-poolside-foyer-bin-7c56238f": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "steampunk-airship-dock-and-workshop-gas-pump-trolley-c02ef62c": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "airport-terminal-and-ground-operations-tray-return-tro-6d84dbed": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "aircraft-fleet-and-airfield-ground-power-cart-69186e50": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "supermarket-operations-shopping-trolley-9248600c": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "machine-shop-and-factory-hall-machine-shop-and-factory-154266a1": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "home-appliances-and-utility-washing-machine-front-load-8cf238bc": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "machine-shop-and-factory-hall-machine-shop-and-factory-416adcb7": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "modern-rail-and-metro-network-ticket-machine-dc3e6a42": {
    "kind": 'operate',
    "actions": [],
    "source": 'curated'
  },
  "robots-and-drones-kit-battery-swap-cabinet-e152705f": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "robots-and-drones-kit-storage-locker-tall-84257c98": {
    "kind": 'operate',
    "actions": [],
    "source": 'rule'
  },
  "casino-floor-and-back-rooms-slot-upright-0689c21c": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "modern-rail-and-metro-network-relay-cabinet-85dc805a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "fire-and-emergency-services-fire-hydrant-09cb0c64": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "voxel-city-districts-fire-hydrant-04ac7d3a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "machine-shop-and-factory-hall-machine-shop-and-factory-d83014ca": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "street-food-market-and-food-trucks-fire-extinguisher-p-1bc646d7": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "computers-and-desk-gadgets-laptop-convertible-flip-068fe56f": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "computers-and-desk-gadgets-laptop-closed-13-ea6b62e9": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "computers-and-desk-gadgets-laptop-gaming-17-976ef973": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "downtown-office-interiors-laptop-riser-2ae46c86": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "downtown-office-interiors-monitor-24-inch-cd110e8d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "computers-and-desk-gadgets-monitor-24-flat-7108a75c": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hospital-wards-and-clinic-operations-patient-monitor-af189b00": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "university-lecture-hall-and-campus-ceiling-projector-m-3875de72": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "police-station-and-detective-office-camera-on-tripod-60d9e444": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "self-storage-facility-and-loading-bay-self-storage-fac-fedf9f45": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "animated-mechanisms-kit-security-camera-yoke-12d335bf": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "robots-and-drones-kit-quadcopter-camera-16e693ab": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "cozy-home-interiors-bath-mat-a5af83c6": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "companion-animals-and-pet-home-rug-3aff2413": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "pets-and-companions-hd-rug-b811e9ad": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "velodrome-and-track-cycling-mat-stack-7fcbe043": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "museum-conservation-and-art-restoration-museum-conserv-9172cc18": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "art-gallery-and-exhibition-rooms-cafe-table-and-chairs-a767551a": {
    "kind": 'seat-set',
    "actions": ['sit'],
    "source": 'rule'
  },
  "museum-conservation-and-art-restoration-museum-conserv-94b0c868": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "museum-conservation-and-art-restoration-museum-conserv-a682cd52": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "fantasy-mmo-city-and-townsfolk-curtain-wall-bay-2d830417": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "medieval-castle-construction-curtain-corner-abc40abb": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hospital-wards-and-clinic-operations-curtain-rail-with-219d2fc4": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "animated-mechanisms-kit-bead-curtain-20e9dbe5": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "voxel-city-districts-abstract-sculpture-eae2dbd2": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "sunken-city-and-underwater-ruins-statue-base-8c3948c9": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "vampire-crypt-and-gothic-cathedral-angel-statue-ea3e1925": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "alpine-snow-village-ice-fox-sculpture-7cef66b3": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "lantern-watch-hanging-wall-lantern": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hot-air-balloon-festival-balloon-basket-with-burner-fr-4d6ec787": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hot-air-balloon-festival-traffic-cone-799bc862": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hero-shooter-harbour-payload-lighthouse-lantern-stage-fea64c17": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "indoor-market-hall-and-traders-bakery-tray-set-13f8fc39": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "car-repair-garage-and-mot-workshop-car-repair-garage-a-7ee8b3f2": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "izakaya-alley-and-ramen-shop-bowl-of-ramen-48b66069": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "cheesemaking-and-dairy-cellar-culture-measuring-tray-a1fce8d4": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "long-haul-trucking-and-truck-stop-long-nose-sleeper-949ae647": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "car-park-and-road-vehicle-fleet-box-truck-4574c765": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "long-haul-trucking-and-truck-stop-cabover-day-cab-2da6af6b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "long-haul-trucking-and-truck-stop-cabover-sleeper-b86f0719": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "car-park-and-road-vehicle-fleet-sports-car-900de487": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "car-park-and-road-vehicle-fleet-city-car-033e3215": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "motorcycle-racing-and-street-bikes-road-sportbike-e1418015": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "car-park-and-road-vehicle-fleet-saloon-ad831b1f": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "theme-park-rides-and-coasters-theme-park-rides-and-coa-d18acb96": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "theme-park-rides-and-coasters-theme-park-rides-and-coa-b3ccf619": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "theme-park-rides-and-coasters-theme-park-rides-and-coa-8af0e6ab": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-backdrop-banner-fr-7ebd4df6": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "airport-terminal-and-ground-operations-check-in-desk-ba7d92dc": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "bedroom-and-living-room-furniture-dining-chair-timber-b8b614f7": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "solar-system-and-astronauts-brochure-stand-167bd36f": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "medieval-mmo-starter-realm-market-stall-blue-f5cbc408": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "indian-bazaar-street-and-temple-speaker-horn-on-pole-4788391b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "japanese-school-and-city-street-lectern-f8b909de": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "medieval-monastery-and-scriptorium-trestle-table-2a0801e0": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "bar-pub-and-brewery-taproom-bar-counter-module-4f0062bc": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-microphone-on-boom-b553a46d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "abandoned-puppet-theatre-and-prop-vault-spotlight-yoke-335ca905": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "abandoned-cinema-and-projection-booth-abandoned-cinema-765a1a5b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-truss-straight-bay-3e0706d1": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "trampoline-park-and-soft-play-basketball-dunk-hoop-58e31467": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "community-sports-hall-and-changing-rooms-hall-scoreboa-1aac26ec": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-full-size-goal-08c07f03": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "beach-surf-and-paddle-kit-warning-flag-pole-04ad1969": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "street-food-market-and-food-trucks-planter-with-shrub-0eedba0e": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "trading-post-and-barter-market-canopy-market-booth-46c6c10f": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "almanac-gardens-terracotta-planter-1472f447": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "airport-terminal-and-ground-operations-queue-barrier-r-0d620e5a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "ferry-terminal-and-harbour-crossing-ferry-terminal-and-4f8d77f5": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "bunker-shelter-construction-waste-bin-foot-pedal-f50124e7": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "zombie-quarantine-streets-chain-fence-bay-014919d4": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "mountaineering-and-summit-expedition-base-camp-dome-te-e93b01ea": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "robots-and-drones-kit-battery-trolley-c1d0113b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hero-shooter-harbour-payload-cafe-parasol-3af84c9f": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "medieval-mmo-starter-realm-rug-5064c4c7": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "pixel-modern-apartments-wall-art-6f3f2e8b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "computers-and-desk-gadgets-laptop-open-14-ad4c2b1d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hotel-and-resort-operations-conference-table-module-a6abb373": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "office-lobby-and-facilities-canteen-stacking-chair-3440c7d8": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "tattoo-and-piercing-studio-studio-plant-pot-7ee5b536": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "village-hall-and-community-events-pa-speaker-on-stand-7ffa787e": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "american-football-stadium-kit-field-microphone-1129c7a5": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hot-air-balloon-festival-pa-speaker-on-stand-43f5125f": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-di-box-63bef201": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-guitar-amp-stack-9d8c42bd": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-guitar-stand-with--12a05ac1": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-guitar-stand-with--e8d04dcb": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-keyboard-rig-c2846152": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "music-recording-studio-and-instruments-mic-stand-empty-3a0d7a1c": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "nightclub-and-dj-booth-dj-headphones-68ba5562": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "nightclub-and-dj-booth-dj-monitor-wedge-78f6b1b0": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "nightclub-and-dj-booth-optics-rail-a5550ac4": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "orchestra-and-band-instruments-flute-8c1f6878": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "racecourse-and-parade-ring-big-screen-frame-9bea9827": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "theatre-stage-and-backstage-tannoy-speaker-efacfc9d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "tv-studio-and-broadcast-gallery-boom-microphone-on-pol-952f926e": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "university-lecture-hall-and-campus-projection-screen-f41396d5": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "low-poly-character-figures-builder-standing-41a26918": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "low-poly-character-figures-chef-standing-107eec87": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "low-poly-character-figures-civilian-arms-crossed-d539191f": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "low-poly-character-figures-civilian-coat-standing-d311fc0b": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "low-poly-character-figures-civilian-coat-walking-52e652ed": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "low-poly-character-figures-civilian-hands-in-pockets-65efe4c2": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "low-poly-character-figures-civilian-leaning-7dd8a161": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "low-poly-character-figures-civilian-on-phone-57698df1": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "low-poly-character-figures-civilian-pushing-trolley-02fba33e": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "low-poly-character-figures-civilian-running-de3617e6": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "low-poly-character-figures-civilian-sitting-f51129df": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "low-poly-character-figures-civilian-standing-idle-514e9033": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "low-poly-character-figures-civilian-walking-06de0354": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "low-poly-character-figures-civilian-waving-a7248cbd": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "low-poly-character-figures-cleaner-with-mop-579c8a9e": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "low-poly-character-figures-courier-with-parcel-9ba10dd9": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "low-poly-character-figures-firefighter-standing-8ded7b6f": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "low-poly-character-figures-medic-standing-c9e96efa": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "low-poly-character-figures-shop-worker-standing-44c74d70": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "low-poly-character-figures-waiter-with-tray-59369bb3": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "american-football-stadium-kit-championship-trophy-6989e4ff": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "art-gallery-and-exhibition-rooms-wall-text-panel-c987f386": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-substitution-board-05e2171f": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-tactics-wall-board-15e2a3e2": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-trophy-plinth-99e2c1de": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-wall-hook-rail-618b9d6b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "go-kart-track-and-pit-lane-trophy-set-7acab0eb": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hot-air-balloon-festival-briefing-board-81a73204": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "indoor-market-hall-and-traders-hanging-trader-sign-b77a654b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "indoor-market-hall-and-traders-hanging-trader-sign-blu-1948335a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "indoor-market-hall-and-traders-information-board-04c099de": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "nightclub-and-dj-booth-fire-exit-sign-b7435ec3": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "public-aquarium-and-marine-centre-tank-interpretive-si-a078150f": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "public-aquarium-and-marine-centre-wall-graphic-panel-a5dfb6e6": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "theatre-stage-and-backstage-wig-block-stand-347eee98": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "abandoned-puppet-theatre-and-prop-vault-gathered-stage-cebd22a1": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "abandoned-puppet-theatre-and-prop-vault-raised-puppet--3ae52a70": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "abandoned-puppet-theatre-and-prop-vault-stage-wing-pan-fad76803": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "art-gallery-and-exhibition-rooms-gallery-floor-tile-8d6d082b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "art-gallery-and-exhibition-rooms-single-room-hang-a32f2fd9": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "chocolate-making-and-confectionery-choco-0bed56f3-starter-scene": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "chocolate-making-and-confectionery-roofed-chocolate-wo-7d76ee5b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "community-sports-hall-and-changing-rooms-changing-room-b2debb51": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "community-sports-hall-and-changing-rooms-cleaning-trol-ae0faab6": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-drink-cooler-e552e4f8": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-laundry-trolley-8899c51b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-shower-column-2aeb12a4": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-wash-basin-3be77db0": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hot-air-balloon-festival-blank-finger-post-5c68f83a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "indoor-market-hall-and-traders-hanging-stock-rail-d052326c": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-ground-support-bas-c4711f51": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-pa-stack-frame-189c8a7c": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-stage-riser-block-0d3aaf5f": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-stage-roof-canopy--543b5fb3": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-stage-step-unit-f141dc1c": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "nightclub-and-dj-booth-cleaning-trolley-58c22c92": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "nightclub-and-dj-booth-cocktail-station-d186e438": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "nightclub-and-dj-booth-glass-washer-d7ae8ae5": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "nightclub-and-dj-booth-laptop-on-stand-6c305e35": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "nightclub-and-dj-booth-riser-platform-module-1e135c35": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "orchestra-and-band-instruments-folding-music-stand-20723b66": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "orchestra-and-band-instruments-stage-platform-module-6be1e985": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "retro-diner-and-roadside-motel-napkin-dispenser-2df9b069": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "rocket-launch-pad-and-gantry-stage-transport-cradle-7c9f60ce": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "storybook-christmas-market-santa-toy-workshop-01bea88e": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "theatre-stage-and-backstage-costume-rail-with-covers-8ed59fc5": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "theatre-stage-and-backstage-dressing-room-mirror-stati-97cf3af1": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "theatre-stage-and-backstage-orchestra-pit-rail-45132244": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "theatre-stage-and-backstage-orchestra-pit-rostrum-8834f48d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "theatre-stage-and-backstage-proscenium-arch-frame-f9dcb7bb": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "theatre-stage-and-backstage-row-letter-plate-160b8d03": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "theatre-stage-and-backstage-scenery-flat-eef5eda8": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "theatre-stage-and-backstage-stage-brace-and-weight-c75020db": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "theatre-stage-and-backstage-stage-trap-section-c946022f": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "tv-studio-and-broadcast-gallery-scenery-brace-and-weig-9e0bb91c": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "village-hall-and-community-events-parquet-floor-tile-b-965c446f": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "village-hall-and-community-events-stage-curtain-rail-20c284fc": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "village-hall-and-community-events-stage-platform-modul-208d60a2": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "american-football-stadium-kit-agility-chute-fecff344": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "american-football-stadium-kit-resistance-parachute-309496f5": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "american-football-stadium-kit-snap-trainer-36159cec": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "american-football-stadium-kit-tackle-wheel-ae0b39f3": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "basketball-club-and-street-courts-sports-duffel-5c80a427": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-agility-ladder-75e84ad2": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-equipment-carry-bag-787b6642": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-soccer-ball-118e3a67": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "nursery-and-primary-classroom-fire-exit-door-module-1f2b7548": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "squash-club-and-racket-workshop-equipment-bag-487e54a5": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "squash-club-and-racket-workshop-resistance-band-statio-854fd051": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "tennis-club-and-courts-sports-bag-73697f1c": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "abandoned-puppet-theatre-and-prop-vault-stage-spotligh-998dc62f": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-moving-head-light-0781fce0": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-truss-corner-block-be643b18": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-truss-vertical-tow-8ea841b9": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "nightclub-and-dj-booth-ceiling-truss-grid-module-49574ae0": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "nightclub-and-dj-booth-disco-ball-on-motor-055bf9ff": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "storybook-christmas-market-festoon-bulb-string-9422da4e": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "village-hall-and-community-events-ceiling-pendant-ligh-7acec826": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "car-park-and-road-vehicle-fleet-payment-kiosk-c5c914df": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "christmas-storybook-christmas-bakery-market-a78eca89": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "christmas-storybook-market-chalet-f8bf72ba": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "christmas-village-christmas-market-stall-4fcc8838": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "fantasy-mmo-city-and-townsfolk-market-stall-5d9f093b": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "football-soccer-club-grounds-concession-kiosk-fc162fe3": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'curated'
  },
  "football-soccer-club-grounds-ticket-booth-e23acd9f": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'curated'
  },
  "hero-shooter-harbour-payload-market-stall-awning-358921d2": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "hot-air-balloon-festival-trestle-table-5be944ba": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "indian-bazaar-street-and-temple-cloth-stall-with-bolt--a2faee3a": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "indian-bazaar-street-and-temple-flower-garland-stall-1de92b5c": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "indian-bazaar-street-and-temple-fruit-and-vegetable-st-280ccd20": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "indian-bazaar-street-and-temple-spice-stall-1b95bd16": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "indian-bazaar-street-and-temple-tea-stall-865b528a": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'curated'
  },
  "indoor-market-hall-and-traders-corner-stall-unit-62d7d118": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "indoor-market-hall-and-traders-lock-up-stall-unit-3085836b": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "indoor-market-hall-and-traders-lock-up-stall-unit-open-83b67308": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "indoor-market-hall-and-traders-lock-up-stall-unit-red-3f955420": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "indoor-market-hall-and-traders-market-hall-floor-bay-d36d1956": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "indoor-market-hall-and-traders-open-stall-unit-5124bc70": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "indoor-market-hall-and-traders-open-stall-unit-blue-7bc77762": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "indoor-market-hall-and-traders-stall-back-shelving-3462e261": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "indoor-market-hall-and-traders-stall-counter-module-0979a957": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "indoor-market-hall-and-traders-stall-price-board-85782807": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "korean-hanok-village-and-street-market-stall-with-awni-064ed223": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-food-stall-unit-da74e65f": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-merch-stall-3fd15894": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "meadow-courier-parcel-market-awning": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "medieval-mmo-starter-realm-market-stall-cream-e095e409": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "medieval-tournament-and-jousting-ground-merchant-stall-9a839369": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "nightclub-and-dj-booth-dj-booth-desk-b052b722": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "pixel-modern-farm-market-stall-acecc44a": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "racecourse-and-parade-ring-bar-and-food-kiosk-7eefd7a3": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'curated'
  },
  "roman-bathhouse-and-palaestra-vendor-stall-42493924": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "storybook-christmas-market-cocoa-market-stall-76043373": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "street-food-market-and-food-trucks-gazebo-stall-with-c-e8a7b705": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "street-food-market-and-food-trucks-market-stall-frame--b7c13845": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "street-food-market-and-food-trucks-stall-number-sign-99e7d623": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "street-food-market-and-food-trucks-trestle-stall-red-a-b0ea3177": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "street-food-market-and-food-trucks-trestle-stall-with--2858ba1d": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "theme-park-rides-and-coasters-theme-park-rides-and-coa-df93cdea": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "village-hall-and-community-events-book-stall-table-11610050": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "community-sports-hall-and-changing-rooms-gym-bench-76cb03bd": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "community-sports-hall-and-changing-rooms-gym-mat-singl-70cf5ea8": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "community-sports-hall-and-changing-rooms-gym-mat-stack-d3bfc381": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-bucket-seat-1a72cd60": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "football-soccer-club-grounds-changing-bench-912e20bc": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "football-soccer-club-grounds-folding-coach-chair-3a02f4ca": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "gym-and-fitness-studio-adjustable-bench-4624177a": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "hot-air-balloon-festival-folding-camp-chair-ba5bb3d0": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "public-aquarium-and-marine-centre-visitor-bench-teal-d3402427": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "street-food-market-and-food-trucks-bar-stool-aed9cea8": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "tennis-club-and-courts-terrace-chair-db8478f6": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "village-hall-and-community-events-stacking-chair-row-fcb22800": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "abandoned-puppet-theatre-and-prop-vault-property-stora-20930b33": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "abandoned-puppet-theatre-and-prop-vault-scenery-track--493f526d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "abandoned-puppet-theatre-and-prop-vault-scenery-track--6838572e": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "abandoned-tidal-model-testing-hall-optical-tracking-ca-5a93f82e": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "aircraft-fleet-and-airfield-fuel-drum-pallet-8abe06a7": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "arable-fields-and-farm-machinery-tracked-tractor-f59c2454": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "art-gallery-and-exhibition-rooms-lighting-track-sectio-c570a9a8": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "art-gallery-and-exhibition-rooms-track-spot-head-44353656": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "art-gallery-and-exhibition-rooms-vitrine-case-ca6b50af": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "basketball-club-and-street-courts-spectator-bin-94bb1439": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "cinema-multiplex-and-foyer-spare-lamp-case-9f73b1ff": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "community-sports-hall-and-changing-rooms-foyer-bin-b2789118": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "community-sports-hall-and-changing-rooms-trophy-cabine-51c36706": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "dog-agility-and-training-field-equipment-store-rack-6c5ec6c3": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-boot-rack-1112eb8f": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-first-aid-cabinet-feff73ae": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-open-kit-locker-d10c9b5a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-towel-shelf-8d7f3ef9": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-waste-bin-15a6b427": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-water-bottle-carrier-3c5028a4": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "gym-and-fitness-studio-water-bottle-97b8b284": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hot-air-balloon-festival-propane-cylinder-rack-b1de839d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "indian-bazaar-street-and-temple-produce-crate-stack-a539d636": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "indian-bazaar-street-and-temple-street-bin-3aeaa2eb": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "indoor-market-hall-and-traders-ceramic-and-homeware-sh-fcd061ca": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "indoor-market-hall-and-traders-fruit-and-veg-crate-set-222d673b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "indoor-market-hall-and-traders-glass-display-case-8f12ea4d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "indoor-market-hall-and-traders-litter-bin-06bd3ac5": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "indoor-market-hall-and-traders-preserve-and-cheese-she-99589905": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "indoor-market-hall-and-traders-vinyl-record-crate-set-672bf283": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "korean-hanok-village-and-street-produce-basket-set-0d57d77d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-drum-riser-fb450f31": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-litter-bin-d65ec1dd": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-multicore-cable-dr-67864f73": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-road-case-large-483e15ad": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-road-case-small-ea804af6": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-subwoofer-cabinet-76be2833": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-water-bottle-crate-0c59da5b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "music-recording-studio-and-instruments-drum-snare-on-s-d42c8c13": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "nightclub-and-dj-booth-speaker-mid-cabinet-2e417753": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "nightclub-and-dj-booth-speaker-stack-sub-cabinet-77151eb8": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "petrol-station-and-forecourt-shop-screen-wash-pallet-e983d54e": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "pixel-modern-farm-produce-crates-c20feab2": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "racecourse-and-parade-ring-divot-fork-rack-c3450a2d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "radio-telescope-array-and-field-station-supply-crate-s-6a5d3508": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "retail-store-fixtures-and-mall-ceiling-track-lighting--9cadd166": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "tennis-club-and-courts-water-bottle-abd2477f": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "theatre-stage-and-backstage-house-lighting-bracket-381e7e7d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "theatre-stage-and-backstage-house-tabs-on-track-2201a546": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "theatre-stage-and-backstage-house-tabs-on-track-open-00c29a91": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "theatre-stage-and-backstage-prop-shelf-unit-791c9034": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "village-hall-and-community-events-crockery-crate-ed80f580": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "abandoned-puppet-theatre-and-prop-vault-lighting-contr-fa7fd39b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "american-football-stadium-kit-tablet-station-ec47a183": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "art-gallery-and-exhibition-rooms-reception-desk-0494fe21": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "art-gallery-and-exhibition-rooms-shop-counter-d42a2ff0": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "butchers-shop-and-deli-counter-stainless-prep-table-7c8a3bb8": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "dog-agility-and-training-field-rosette-and-trophy-tabl-e70911a3": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "downtown-office-interiors-desk-sit-stand-raised-19facdb2": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "downtown-office-interiors-sit-stand-desk-frame-39615259": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "football-soccer-club-grounds-treatment-table-2eeb6a53": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "indian-bazaar-street-and-temple-sweet-counter-3a98de40": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "indoor-market-hall-and-traders-folding-trader-table-c8986b1d": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "indoor-market-hall-and-traders-till-and-card-reader-facdd132": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-front-of-house-mix-ab9b61a6": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "nightclub-and-dj-booth-cloakroom-counter-with-rails-c6d08198": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "nightclub-and-dj-booth-turntable-deck-aa917183": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "parcel-depot-and-sorting-hall-parcel-depot-and-sorting-83979c04": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "recycling-centre-and-material-sorting-sample-sorting-t-453f97fd": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "theatre-stage-and-backstage-counterweight-frame-with-w-65d65714": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "theatre-stage-and-backstage-set-dressing-table-5d0f7164": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "theatre-stage-and-backstage-stage-manager-desk-with-pa-e34d027a": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "village-hall-and-community-events-raffle-table-af0f6485": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "woodworking-workshop-and-joinery-woodworking-workshop--09eae188": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "abandoned-puppet-theatre-and-prop-vault-string-spool-s-43bbc017": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "bakery-and-cafe-grinder-retail-bulk-3668d9ae": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "community-sports-hall-and-changing-rooms-pump-and-whis-2e97e815": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "community-sports-hall-and-changing-rooms-vending-machi-3def4990": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "escape-room-and-puzzle-venue-drinks-vending-machine-d751cf4a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-ball-pump-46d4eaeb": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "laser-tag-arena-and-activity-centre-vending-machine-73e45792": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-cable-ramp-6576a82f": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-generator-trailer-354a33e9": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-haze-machine-f83afacc": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-power-distro-box-28b03233": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "music-recording-studio-and-instruments-tape-machine-680673b8": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "racecourse-and-parade-ring-tractor-harrow-99591e72": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "skate-park-and-street-sports-grind-box-25236bc8": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "textile-weaving-and-dye-workshop-warp-beam-stand-515559b5": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "trampoline-park-and-soft-play-vending-machine-0b02ec87": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "woodworking-workshop-and-joinery-woodworking-workshop--64e716a2": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "woodworking-workshop-and-joinery-woodworking-workshop--87d87bf5": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "woodworking-workshop-and-joinery-woodworking-workshop--af108527": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hot-air-balloon-festival-portable-toilet-block-82a4faf8": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "live-music-venue-and-festival-stage-portable-toilet-bl-309ed26a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "bus-station-and-city-transit-city-bus-single-decker-ddf9a355": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "long-haul-trucking-and-truck-stop-container-20ft-bc3beca3": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "golf-course-and-clubhouse-motorised-golf-cart-b754304d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "fire-and-emergency-services-ambulance-f22ce1a5": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "city-park-and-playground-bike-rack-c73abcbf": {
    "kind": 'none',
    "actions": [],
    "source": 'curated'
  },
  "tool-hire-depot-and-plant-yard-tool-hire-depot-and-pla-fac914d0": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "bus-station-and-city-transit-street-lamp-2c6420cf": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "bus-station-and-city-transit-traffic-light-4b8313ca": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "tool-hire-depot-and-plant-yard-tool-hire-depot-and-pla-b7d1c941": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "street-food-market-and-food-trucks-picnic-bench-0f446ae7": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "retail-store-fixtures-and-mall-back-to-back-bench-8640042d": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "office-lobby-and-facilities-visitor-sofa-three-seat-0919a142": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "cozy-home-interiors-sofa-three-seat-8d2d33f9": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "care-home-and-day-room-high-back-armchair-green-a759c0d7": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "office-lobby-and-facilities-lobby-armchair-b7009456": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "izakaya-alley-and-ramen-shop-folding-chair-dbe1ca77": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "caravan-park-and-campsite-camping-chair-390fe145": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "bakery-and-cafe-bar-stool-counter-ec2e9883": {
    "kind": 'seat-set',
    "actions": ['sit'],
    "source": 'rule'
  },
  "bakery-and-cafe-cafe-table-4-person-bf74a9a9": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "city-park-and-playground-picnic-table-97b71a11": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "village-hall-and-community-events-trestle-table-6cb6b682": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "hotel-and-resort-operations-poolside-table-and-parasol-2a52833a": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "street-food-market-and-food-trucks-stall-counter-modul-2f352fdb": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "street-food-market-and-food-trucks-bar-stall-with-taps-34a0fc7b": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "airport-terminal-and-ground-operations-self-service-ki-70dc7b17": {
    "kind": 'operate',
    "actions": [],
    "source": 'rule'
  },
  "fast-food-and-drive-thru-self-order-kiosk-floor-272961e1": {
    "kind": 'operate',
    "actions": [],
    "source": 'rule'
  },
  "armoured-column-and-field-camp-command-tent-5c85fae1": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "beach-surf-and-paddle-kit-pop-up-changing-tent-5762c0fa": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "theatre-stage-and-backstage-stage-deck-module-5173fe61": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "indian-bazaar-street-and-temple-potted-plant-group-f4a7cda5": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "izakaya-alley-and-ramen-shop-potted-plant-in-can-ca363621": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "botanical-glasshouse-and-palm-house-botanical-glasshou-c857c466": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "greek-island-village-and-harbour-stone-planter-5303d8e8": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "car-park-and-road-vehicle-fleet-entry-barrier-7cb4f555": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "beach-surf-and-paddle-kit-dune-fence-run-cf3f7f77": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "airport-terminal-and-ground-operations-perimeter-fence-f8a14e9f": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hero-shooter-harbour-payload-quay-bollard-f41b9701": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "motorway-services-and-truck-park-traffic-cone-338a0889": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "lawn-mowing-simulator-kit-barbecue-with-lid-2af11b0a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "beach-surf-and-paddle-kit-cooler-box-3c6c2b15": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "theme-park-rides-and-coasters-theme-park-rides-and-coa-024387cb": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "street-food-market-and-food-trucks-ice-cream-van-6da2c4e2": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "bakery-and-cafe-espresso-machine-2-group-60882cf3": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "nightclub-and-dj-booth-beer-tap-font-7c18dba3": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "computers-and-desk-gadgets-speaker-bookshelf-90b50703": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "cinema-multiplex-and-foyer-wall-speaker-on-mount-ac24c00d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hot-air-balloon-festival-event-floodlight-mast-fcfa3f16": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-floodlight-mast-282b2db3": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "wedding-and-chapel-kit-lantern-post-c06e501d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "restaurant-kitchen-and-dining-hand-wash-basin-8a6818d3": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "japanese-school-and-city-street-water-fountain-41607d12": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "halloween-slasher-street-metal-trash-can-7b4be17a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "theme-park-rides-and-coasters-theme-park-rides-and-coa-486efc8a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "caravan-park-and-campsite-bin-and-recycling-store-beed8b68": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "motorcycle-racing-and-street-bikes-trackside-bike-rack-dd2988a6": {
    "kind": 'none',
    "actions": [],
    "source": 'curated'
  },
  "gym-and-fitness-studio-locker-bank-open-door-bd2cea7d": {
    "kind": 'operate',
    "actions": [],
    "source": 'rule'
  },
  "office-lobby-and-facilities-staff-locker-bank-aaf13317": {
    "kind": 'operate',
    "actions": [],
    "source": 'rule'
  },
  "hardware-store-and-diy-warehouse-tool-box-00f4820f": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "car-factory-production-line-pallet-with-parts-crates-631a2a1a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hot-air-balloon-festival-balloon-basket-trolley-a25aabce": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "vertical-farm-and-hydroponics-tower-vertical-farm-and--6e684ade": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "aircraft-fleet-and-airfield-light-turbine-helicopter-d4734be7": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "almanac-gardens-striped-deckchair-1fa5a8cf": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "american-football-stadium-kit-switchback-ramp-943f4dd2": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "amusement-arcade-and-seaside-pier-cctv-dome-fcb4da0d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "bakery-and-cafe-outdoor-heater-f41c88ea": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "bar-pub-and-brewery-taproom-refectory-table-and-benche-172bcbde": {
    "kind": 'seat-set',
    "actions": ['sit'],
    "source": 'rule'
  },
  "battle-royale-town-and-airfield-dumpster-dfad923c": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "beach-surf-and-paddle-kit-recreational-jet-ski-a61d9936": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "beach-surf-and-paddle-kit-rescue-paddleboard-183e649e": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "beach-surf-and-paddle-kit-sit-on-top-kayak-07093469": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "beach-surf-and-paddle-kit-swim-zone-buoy-orange-36e2fd5e": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "bicycle-shop-and-repair-cafe-floor-pump-347171db": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "bus-station-and-city-transit-ticket-office-kiosk-61214dac": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'curated'
  },
  "car-factory-production-line-forklift-4daac5a1": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "car-park-and-road-vehicle-fleet-disabled-bay-tile-22090d5f": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "car-park-and-road-vehicle-fleet-police-car-39c206c9": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "car-park-and-road-vehicle-fleet-taxi-ae3c8ca0": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "caravan-park-and-campsite-bell-tent-d7f74bfd": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "caravan-park-and-campsite-fire-pit-ring-a42e931d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "casino-floor-and-back-rooms-atm-kiosk-ff57e849": {
    "kind": 'operate',
    "actions": [],
    "source": 'curated'
  },
  "christmas-storybook-iced-cookie-plate-e5daee0b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "christmas-storybook-mantel-garland-78cc0731": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "city-park-and-playground-playground-slide-ffdeee73": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "clinic-and-veterinary-practice-defibrillator-wall-unit-077ecfb7": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "cold-war-missile-silo-and-command-bunker-helipad-marki-89cd69b2": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "cold-war-missile-silo-and-command-bunker-perimeter-gat-b683838a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "container-inspection-and-customs-yard-container-inspec-86499dea": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "cricket-ground-and-pavilion-sight-screen-8094a4f3": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "demolition-and-site-clearance-demolition-and-site-clea-e98ff264": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "diving-and-underwater-salvage-twin-scuba-tank-rig-99accfd4": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "downtown-office-interiors-printer-multifunction-0b3b5d41": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "endurance-and-gt-paddock-wide-podium-08d709f4": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "factory-conveyor-network-factory-conveyor-network-logi-10087a40": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-accessible-platform-c28164f3": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-camera-platform-81d16afb": {
    "kind": 'none',
    "actions": [],
    "source": 'curated'
  },
  "football-soccer-club-grounds-dugout-shelter-ea708920": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "football-soccer-club-grounds-tripod-turnstile-b2daf4d7": {
    "kind": 'operate',
    "actions": [],
    "source": 'rule'
  },
  "hollowwick-halloween-footed-candy-bowl-b35f038a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hot-air-balloon-festival-bunting-run-5879a446": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hotel-and-resort-operations-banquet-round-table-10-958b76ee": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "ice-hockey-arena-and-locker-room-penalty-box-057f8942": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "imperial-china-palace-and-garden-hanging-silk-lantern-24c01831": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "liminal-spaces-kit-elevator-car-22251ff7": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "low-poly-character-figures-police-officer-standing-cedbbfb3": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "machine-shop-and-factory-hall-machine-shop-and-factory-df24f11e": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "marina-and-yacht-club-marina-and-yacht-club-dinghy-on--2f3b28ee": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "marina-and-yacht-club-marina-and-yacht-club-pontoon-mo-a1492ae9": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "medieval-mmo-starter-realm-hay-bale-12135bfd": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "modern-rail-and-metro-network-low-floor-tram-orange-li-264c0a52": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "north-pole-village-decorated-christmas-tree-cdf11f72": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "office-lobby-and-facilities-baby-change-unit-9b900116": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "paranormal-investigation-house-handheld-camcorder-0c59e26d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "pickups-and-collectibles-medallion-60e6d081": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "pixel-modern-supermarket-freezer-chest-a5eb2cbd": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "radio-telescope-array-and-field-station-water-tank-on--65a921bb": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "restaurant-kitchen-and-dining-drinks-station-f9484874": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "restaurant-kitchen-and-dining-prep-sink-58aded03": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "retail-store-fixtures-and-mall-mid-floor-gondola-630432ab": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "retro-arcade-and-mall-1989-beanbag-602afbad": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "safari-camp-and-bush-lodge-viewing-platform-4d5346b6": {
    "kind": 'none',
    "actions": [],
    "source": 'curated'
  },
  "self-storage-facility-and-loading-bay-self-storage-fac-18bad828": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "ski-resort-and-snow-park-finish-arch-4c222829": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "street-food-market-and-food-trucks-grill-stall-with-ho-4c48bea1": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "street-food-market-and-food-trucks-hand-wash-station-db419292": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "street-food-market-and-food-trucks-pizza-trailer-with--25e61d41": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "street-food-market-and-food-trucks-portable-generator-a151aacc": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "submarine-interior-and-control-room-life-ring-on-brack-449f02bf": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "survivor-vehicle-maintenance-water-pump-6cdf94b8": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "theme-park-rides-and-coasters-theme-park-rides-and-coa-e7ab6e10": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "tool-hire-depot-and-plant-yard-tool-hire-depot-and-pla-bb7dd131": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "vertical-farm-and-hydroponics-tower-vertical-farm-and--0f0612fa": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "voxel-city-districts-fire-engine-43262943": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "waterpark-and-pool-operations-waterpark-and-pool-opera-46779842": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "wind-and-solar-energy-farm-battery-storage-container-8b8f8557": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "aircraft-fleet-and-airfield-twin-piston-be652abb": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "allotments-and-community-garden-standpipe-and-tap-41356c7e": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "almanac-gardens-footbridge-4de89dc1": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "american-football-stadium-kit-ticket-scan-pedestal-dbcf96cf": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "arable-fields-and-farm-machinery-fuel-bowser-e7e4d22e": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "car-factory-production-line-wheel-fitting-station-3726bd74": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "car-park-and-road-vehicle-fleet-medium-panel-van-9ef397a4": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "caravan-park-and-campsite-touring-caravan-f889a9ff": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "cricket-ground-and-pavilion-pitch-cover-arch-ac1eec67": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "demolition-and-site-clearance-demolition-and-site-clea-016dd84b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "equestrian-yard-and-stables-draft-horse-standing-black-ccf84bdb": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "ferry-terminal-and-harbour-crossing-ferry-terminal-and-31435dc5": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "fps-survival-forest-outpost-radio-mast-cba3b9db": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "go-kart-track-and-pit-lane-start-finish-gantry-cd27d755": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "gym-and-fitness-studio-standing-fan-4a03c434": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "lawn-mowing-simulator-kit-lawn-stripe-roller-867a3ad6": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "lawn-mowing-simulator-kit-wheelie-bin-b3a9ac25": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "mega-weapon-pack-floor-rifle-rack-3a14f603": {
    "kind": 'none',
    "actions": [],
    "source": 'curated'
  },
  "modular-survival-base-builder-access-ramp-a09354b2": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "motorway-services-and-truck-park-ev-charging-post-8ff36140": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "office-lobby-and-facilities-wc-cubicle-accessible-ec78cf34": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "powerboat-racing-and-launch-ramp-rescue-boat-ed671043": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "retail-store-fixtures-and-mall-concourse-info-desk-6e0a0be9": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "ski-resort-and-snow-park-toboggan-sled-47bc0f3c": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "stock-car-oval-speedway-restroom-block-52c62453": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "storybook-christmas-market-stitched-teddy-bear-2f2f23bb": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "survival-food-and-preservation-smoked-sausage-10f9c18c": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "wedding-and-chapel-kit-gift-box-stack-562b6e24": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "zombie-quarantine-streets-concrete-jersey-barrier-fe81cf2f": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "allotments-and-community-garden-timber-greenhouse-20a90a3b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "bicycle-shop-and-repair-cafe-repair-workstand-986907af": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "camera-repair-and-darkroom-laboratory-spiral-film-reel-e756c7b5": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "demolition-and-site-clearance-demolition-and-site-clea-4365708d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "grand-prix-circuit-and-open-wheel-broadcast-camera-cra-82c8e32d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "hot-air-balloon-festival-registration-gazebo-1f36ec9a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "izakaya-alley-and-ramen-shop-gyoza-plate-d9ba6784": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "storybook-christmas-market-chestnut-brazier-5d37224e": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "storybook-christmas-market-moravian-star-lantern-29ab27e3": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "velodrome-and-track-cycling-vip-box-front-df7dd797": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "aircraft-fleet-and-airfield-light-piston-helicopter-829e9bcf": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "aircraft-fleet-and-airfield-medium-twin-helicopter-2fc3750d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "allotments-and-community-garden-deckchair-green-8908dab5": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "alpine-snow-village-slatted-alpine-deckchair-f1c6bffe": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "american-football-stadium-kit-camera-crane-470b66eb": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "animated-mechanisms-kit-scissor-lift-3793b643": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "arable-fields-and-farm-machinery-telehandler-7248dc4b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "armoured-column-and-field-camp-helipad-marker-31007943": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "bank-vault-heist-kit-alley-dumpster-200bf5b7": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "bar-pub-and-brewery-taproom-pub-table-round-pedestal-3936d6f5": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "beach-surf-and-paddle-kit-swim-zone-buoy-ec54d875": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "bunker-shelter-construction-handwash-station-3e410107": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "canal-boats-and-lock-operations-canal-boats-and-lock-o-0ff5b182": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "car-park-and-road-vehicle-fleet-high-roof-van-933a819a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "casino-floor-and-back-rooms-rope-stanchion-4fb93cd2": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "christmas-village-light-garland-cb81cb23": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "christmas-village-star-topped-tree-f0bd90f3": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "cruise-ship-deck-and-lounge-cruise-ship-deck-and-loung-e5791c54": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "dog-agility-and-training-field-shade-gazebo-b25e7ce2": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "downtown-office-interiors-meeting-table-round-4-f0e7c30f": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "downtown-office-interiors-printer-desktop-a228d16a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "endurance-and-gt-paddock-campsite-gazebo-52bc263d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "endurance-and-gt-paddock-start-finish-gantry-bccfbd22": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "home-appliances-and-utility-chest-freezer-stainless-755fe206": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "home-appliances-and-utility-pedestal-fan-786af6d8": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "machine-shop-and-factory-hall-machine-shop-and-factory-78651fdd": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "medieval-siege-and-castle-defence-bell-tent-open-88cc714a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "nuclear-power-station-and-control-room-diesel-backup-g-2bfffe1f": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "paranormal-investigation-house-tripod-video-camera-9aec57b5": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "party-obstacle-course-party-obstacle-course-celebratio-e1340d69": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "petrol-station-and-forecourt-shop-cctv-dome-57449d14": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "public-swimming-baths-and-poolside-entrance-turnstile-d81fae1c": {
    "kind": 'operate',
    "actions": [],
    "source": 'rule'
  },
  "restaurant-kitchen-and-dining-upright-freezer-333c5973": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "retro-arcade-and-mall-1989-glass-elevator-1bf8a428": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "road-car-showroom-lineup-saloon-taxi-0bf6e890": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "rural-scavenging-settlements-bus-stop-timber-shelter-51267faf": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "safari-camp-and-bush-lodge-fire-pit-and-stone-ring-bc4f9a35": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "ski-resort-and-snow-park-fire-pit-1c08ca20": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "steam-era-railway-and-rolling-stock-footbridge-59be8b67": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "storybook-christmas-market-grand-christmas-tree-7f114b50": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "tool-hire-depot-and-plant-yard-tool-hire-depot-and-pla-933c55a3": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "travelling-circus-and-big-top-hay-bale-round-afda6e9d": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "tv-studio-and-broadcast-gallery-shoulder-camera-on-tri-31dde6ba": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "ufo-crash-site-and-recovery-facility-forklift-7a7056c4": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "waterpark-and-pool-operations-waterpark-and-pool-opera-cfdc507a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "zoo-and-safari-park-builder-viewing-platform-d4e7e669": {
    "kind": 'none',
    "actions": [],
    "source": 'curated'
  },
  "cozy-home-interiors-bean-bag-c28c5060": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "pixel-modern-office-bean-bag-d3c1aa76": {
    "kind": 'seat',
    "actions": ['sit'],
    "source": 'rule'
  },
  "scendance-plan-emergency-access-point": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-evacuation-meeting-point": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-pedestrian-access": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-vehicle-access": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-information-point": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'curated'
  },
  "scendance-plan-lost-property": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-missing-persons-point": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-wristband-collection": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-welfare-point": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-load-zone": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-park-and-ride": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-cycle-parking": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-km-marker": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-5km": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-parking": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-car-park-closed": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-national-speed-limit": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-stop": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-go": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-no-entry": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-no-parking": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-no-u-turn": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-danger": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-hazard": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-bumps": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-flood": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-lollypop-crossing": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-merge": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-queues": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-road-narrows": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-roadworks": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-school-children": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-slippery": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-towaway": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-detour": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-diversion": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-reduce-speed-now": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-road-ahead-closed": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-road-closed": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-straight": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-turn-left": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-turn-right": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-traffic-lights-ahead": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-aid-station-200m": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-penalty-box-200m": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-repair-200m": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-littering-start": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-littering-end": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-no-aero-start": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-no-aero-end": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-no-draft-start": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-no-draft-end": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-bike-in": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-bike-out": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-run-out": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-swim-in": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-swim-out": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-p1": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-p2": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-p3": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-p4": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-aluminum-trackway": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-ground-protection-mats": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-plastic-trackway": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-training-wickets": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-alternate-wickets": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-cn-lantern": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-cn-lantern-riddle": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-cn-round-fan": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-cn-firecracker": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-cn-candied-hawthorn": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-cn-mooncake": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-cn-zongzi": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-cn-red-envelope": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-balloon-arch": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-balloons": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-inflatable-arch": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-truss-arch": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-bouncy-castle": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-yurt": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-warming-dome": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-stretch-tent": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-feather-flag": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-pull-up-banner": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-lamp-post-banner": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-signage-frame-2": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-signage-frame-4": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-crossing-point": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-vms-fixed": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-vms-mobile": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-water-refill-station": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-feed-station": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-cn-couplet": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-cn-wish-tablet": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-cn-tangyuan": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-cn-mugwort": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-cn-firework": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-cn-dragon-boat": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-cn-opera-stage": {
    "kind": 'stage',
    "actions": ['wave', 'emote'],
    "source": 'rule'
  },
  "scendance-plan-targets-control": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-lan-socket": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-wifi": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-charity": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-chuck-wagon": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-round-table-and-chairs": {
    "kind": 'seat-set',
    "actions": ['sit'],
    "source": 'curated'
  },
  "scendance-plan-accessible-portable-toilet": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-gender-neutral-toilet": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-accessible-ramp": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-ramp-turning": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-evacuation-chair": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-cn-jade-rabbit": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-cn-chinese-knot": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-fondue": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-mulled-wine": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-event-control": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-changing-room": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-security-checkpoint": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-toilet-trailer": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-large-screen-truck": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-satellite-van": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-hb-van": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-team-wax-truck": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-swat-police-vehicle": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-heavy-roller": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-mens-urinal-pod": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-time-trial-ramp": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-duck-pond-booth": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "scendance-plan-milk-bottle-toss": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-bungee-trampoline": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-outside-broadcast-truck": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-first-aid-point": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-aid-station-electrolyte": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-ada-low-profile-cable-matting": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-course-crossroad-a": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-course-crossroad-b": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-ski-paramedic": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-tunnel-entry-exit": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-candied-fruits": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-crokicurl": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-elf": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-ice-skating": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-inflatable-santa": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-nativity-scene": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-wooden-rudolf": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-boundary-calculator-men": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-boundary-calculator-women": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-slips": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-stroller-storage": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-mixed-relay-zone": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-paramedic-motorbike": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-relay-handover": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-special-needs": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-swim-evacuation-point": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-transition-zone": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-tv-boat": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-water-crossing": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-agricultural-competition": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-barrel-racing": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-bull-riding": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-clay-pigeon-shooting": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-floriculture": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-hedgelaying": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-horse-racing": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-mirror-maze": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-paratrooper": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-ploughing": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-rodeo-clown": {
    "kind": 'person',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-stickmakers-guild": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-young-farmers-club": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-shooting-range": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-airport": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-bus-coach-station": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-train-station": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-lifeguard-kayak": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-arts-and-crafts": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-carnival": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-fireworks": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-hospital": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-multi-faith-room": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-relax-zone": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-themepark": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-timing-point": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-vintage-display": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-zoo": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-changing-places-toilet": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-fire-towers": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-risk-assessment-pin": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-firewall": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-generator-point": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-permanent-power": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-coach": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-spitfire-aircraft": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-camera-boat": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-skycam": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-prosecco-bar": {
    "kind": 'table',
    "actions": ['talk'],
    "source": 'rule'
  },
  "scendance-plan-chequered-circ": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-chequered-rect": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-circle": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-ellipse": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-overlayimage": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-rectangle": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-route-dash": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-route-dot": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-route-solid": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-textbox": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-transparent": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-triangle": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-triangle-equilateral": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-first-aid-point-compact": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-food-trailer-coffee": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-camera-boat-catamaran": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-security-checkpoint-dual": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-water-refill-station-dual": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-ev-charge-point-dual": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-round-table-and-chairs-parasol": {
    "kind": 'seat-set',
    "actions": ['sit'],
    "source": 'curated'
  },
  "scendance-plan-information-point-booth": {
    "kind": 'booth',
    "actions": ['talk'],
    "source": 'rule'
  },
  "scendance-plan-relax-zone-lounge": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-accessible-ramp-dual": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-bouncy-castle-roofed": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  },
  "scendance-plan-cn-lantern-round": {
    "kind": 'none',
    "actions": [],
    "source": 'rule'
  }
};
