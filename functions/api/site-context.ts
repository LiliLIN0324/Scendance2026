import { wgs84ToGcj02 } from "./geo-gcj.ts";
const ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];
const MAX_BYTES = 2_000_000,
  MAX_ELEMENTS = 300;
/** Numerical inverse of the same offset function used by plan anchors. No keys/provider credentials. */
export function siteWgsCenter(lng: number, lat: number) {
  let x = lng,
    y = lat;
  for (let i = 0; i < 8; i++) {
    const p = wgs84ToGcj02(x, y);
    x += lng - p.lng;
    y += lat - p.lat;
  }
  return { lng: x, lat: y };
}
function response(
  elements: unknown[],
  complete: boolean,
  warnings: string[],
  status = 200,
) {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      crs: "wgs84",
      elements,
      complete,
      warnings,
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
async function boundedBody(res: Response) {
  if (Number(res.headers.get("content-length")) > MAX_BYTES)
    throw new Error("oversize");
  if (!res.body) throw new Error("empty");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error("oversize");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function handleSiteContext(
  request: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url),
    lng = Number(url.searchParams.get("lng")),
    lat = Number(url.searchParams.get("lat")),
    radius = Number(url.searchParams.get("radius") ?? 350);
  if (
    !url.searchParams.has("lng") ||
    !url.searchParams.has("lat") ||
    !Number.isFinite(lng) ||
    Math.abs(lng) > 180 ||
    !Number.isFinite(lat) ||
    Math.abs(lat) > 85 ||
    !Number.isFinite(radius) ||
    radius < 50 ||
    radius > 750
  )
    return response([], false, ["invalid_gcj_center_or_radius_50_750m"], 400);
  const center = siteWgsCenter(lng, lat),
    dy = radius / 111132.92,
    dx = radius / (Math.cos((center.lat * Math.PI) / 180) * 111319.49);
  const bbox = `${(center.lat - dy).toFixed(7)},${(center.lng - dx).toFixed(7)},${(center.lat + dy).toFixed(7)},${(center.lng + dx).toFixed(7)}`;
  const selectors = [
    'way["highway"]',
    'way["building"]',
    'way["leisure"]',
    'way["landuse"]',
    'way["barrier"]',
    'node["entrance"]',
    'node["barrier"]',
    'node["highway"="crossing"]',
    'relation["type"="multipolygon"]',
  ];
  const query = `[out:json][timeout:6][maxsize:2097152];(${selectors.map((s) => `${s}(${bbox});`).join("")});out geom ${MAX_ELEMENTS + 1};`;
  const deadline = Date.now() + 15000;
  for (const endpoint of ENDPOINTS) {
    if (request.signal.aborted)
      return response([], false, ["request_cancelled"], 499);
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const control = new AbortController();
    const cancel = () => control.abort();
    request.signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, Math.min(6500, remaining));
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "ScendancePages/site-context",
        },
        body: "data=" + encodeURIComponent(query),
        signal: control.signal,
      });
      if (!res.ok) continue;
      const body = (await boundedBody(res)) as {
        elements?: unknown[];
        remark?: unknown;
      };
      if (!Array.isArray(body.elements)) continue;
      const elements = body.elements.slice(0, MAX_ELEMENTS),
        truncated = body.elements.length > MAX_ELEMENTS;
      const warnings = [
        "OSM structured data; map pixels are not read; buildings are not event authorization; untagged entrances/indoor passages remain unknown.",
      ];
      if (truncated) warnings.push("element_limit_reached");
      if (body.remark) warnings.push("upstream_query_incomplete");
      return response(elements, !truncated && !body.remark, warnings);
    } catch {
      /* Public bounded map source unavailable: report unknown, never synthesize features. */
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", cancel);
    }
  }
  return response(
    [],
    false,
    [
      "structured_map_source_unavailable; entrances/buildings/indoor data unknown",
    ],
    503,
  );
}
export const onRequestGet = (context: { request: Request }) =>
  handleSiteContext(context.request);
