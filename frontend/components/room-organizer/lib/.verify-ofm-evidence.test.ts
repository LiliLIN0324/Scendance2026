import { describe, it } from "vitest";
import { fetchOpenFreeMapRoads } from "./openfreemap-roads";
import { fetchOpenFreeMapBuildings } from "./openfreemap-buildings";
import { fetchOfmEvidence } from "./openfreemap-evidence";
import { loadOfmTileSource } from "./openfreemap-tiles";

const anchor = { lng: 120.163749, lat: 30.25283 };

describe("OFM live diagnosis（临时，跑完删除）", () => {
  it("live fetch roads/buildings/evidence", async () => {
    const source = await loadOfmTileSource();
    console.log("tile template:", source.template, "maxzoom:", source.maxzoom);

    const radius = 342.9;
    const halfLat = radius / 111132.92;
    const halfLng = radius / (Math.cos((anchor.lat * Math.PI) / 180) * 111319.49);
    const bbox = {
      west: anchor.lng - halfLng,
      south: anchor.lat - halfLat,
      east: anchor.lng + halfLng,
      north: anchor.lat + halfLat,
    };

    const roads = await fetchOpenFreeMapRoads(bbox);
    console.log("roads:", roads.length, "first:", roads[0]?.highway, roads[0]?.points?.length);

    const rings = await fetchOpenFreeMapBuildings(bbox);
    console.log("buildings:", rings.length, "first ring pts:", rings[0]?.lngLat?.length);

    const ev = await fetchOfmEvidence(anchor, radius);
    console.log("evidence features:", ev?.features.length ?? null, "status:", ev?.status);
    const kinds = ev?.features.map((f) => f.kind) ?? [];
    console.log("kinds:", kinds.slice(0, 20));
  }, 30000);
});
