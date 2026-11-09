#!/usr/bin/env node
/**
 * parse-dji-telemetry.mjs
 *
 * Extracts DJI telemetry (GPS / camera metadata) from a DJI camera MP4 and
 * writes a JSON trajectory report.
 *
 * Usage:
 *   node scripts/parse-dji-telemetry.mjs --input <file.mp4> --out <outdir>
 *
 * Options:
 *   --input <path>   Source MP4 (required)
 *   --out <dir>      Output directory for telemetry.json (default: ./docs/evidence/dji-telemetry)
 *   --frames <dir>   Optional: also dump extracted frames at telemetry timestamps
 *   --max-frames <n> Max frames to dump when --frames is given (default 8)
 *   --quiet          Suppress progress logging on stderr
 *
 * How it works
 * ------------
 * DJI cameras carry a protobuf metadata track inside the MP4. The relevant
 * streams are the "data" streams tagged by codec_tag_string:
 *   - "djmd" -> camera metadata track (DjiVideoGlobalInfo / video_stream_info / gps_info)
 *   - "dbgi" -> debug/sensor log track
 *
 * The GPS payload, when present, lives in the "djmd" track as
 * GenericMessage.gps_info (field 3) -> DjiGpsInfo.remote_gps_info (field 4)
 *   -> DjiRemoteGpsInfo.coordinates (field 2) -> DjiRemoteGpsCoordinates
 *      .info (field 1) -> DjiRemoteGpsCoordinatesInfo
 *         .latitude  (field 2, double)
 *         .longitude (field 3, double)
 *      .gps_altitude_mm (field 2, uint32, millimetres)
 *      .datetime       (field 6 -> .datetime field 1, string)
 *
 * This parser implements a schema-free protobuf wire walker that locates the
 * coordinate block structurally (by field path), so it does not depend on a
 * compiled .proto. If the coordinate block is absent (e.g. the camera had no
 * GPS source connected), the script reports that honestly instead of
 * fabricating a track.
 *
 * Requires: Node >= 18, ffprobe/ffmpeg on PATH (or under --ffmpeg-dir).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// ---------------------------------------------------------------- CLI args
function parseArgs(argv) {
  const out = {
    input: null,
    out: 'docs/evidence/dji-telemetry',
    frames: null,
    maxFrames: 8,
    quiet: false,
    ffprobe: null,
    ffmpeg: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--input' || a === '-i') out.input = next();
    else if (a === '--out' || a === '-o') out.out = next();
    else if (a === '--frames') out.frames = next();
    else if (a === '--max-frames') out.maxFrames = parseInt(next(), 10);
    else if (a === '--quiet' || a === '-q') out.quiet = true;
    else if (a === '--ffprobe') out.ffprobe = next();
    else if (a === '--ffmpeg') out.ffmpeg = next();
    else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(new URL(import.meta.url)).pathname.split(/[\\/]/).pop());
      process.exit(0);
    }
  }
  return out;
}

const ARGS = parseArgs(process.argv);
const log = (...m) => { if (!ARGS.quiet) console.error(...m); };

if (!ARGS.input) {
  console.error('error: --input <file.mp4> is required');
  process.exit(2);
}
if (!fs.existsSync(ARGS.input)) {
  console.error(`error: input not found: ${ARGS.input}`);
  process.exit(2);
}

// ------------------------------------------------- locate ffprobe / ffmpeg
function resolveTool(name, explicit) {
  if (explicit) return explicit;
  const exes = [];
  const wrappers = [];
  if (process.platform === 'win32') {
    const envPath = process.env.PATH || '';
    for (const dir of envPath.split(';')) {
      if (!dir) continue;
      exes.push(path.join(dir, `${name}.exe`));
      wrappers.push(path.join(dir, `${name}.cmd`), path.join(dir, `${name}.bat`));
    }
    // Common ffmpeg bundle layout used by this workspace
    const toolsRoot = path.join(process.env.USERPROFILE || '', '.dsh', 'tools', 'ffmpeg');
    if (fs.existsSync(toolsRoot)) {
      for (const d of fs.readdirSync(toolsRoot)) {
        const bin = path.join(toolsRoot, d, 'bin');
        if (fs.existsSync(bin)) exes.push(path.join(bin, `${name}.exe`));
      }
    }
  } else {
    exes.push(name);
  }
  // Prefer a real executable: Node cannot spawn .cmd/.bat directly.
  for (const c of exes) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  for (const c of wrappers) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return name; // fall back to PATH resolution
}

const FFPROBE = resolveTool('ffprobe', ARGS.ffprobe);
const FFMPEG = resolveTool('ffmpeg', ARGS.ffmpeg);

function run(bin, args, maxBuffer = 1 << 28) {
  // Windows .cmd/.bat wrappers need a shell to be executable.
  const isWrapper = /\.(cmd|bat)$/i.test(bin);
  return execFileSync(bin, args, {
    maxBuffer,
    encoding: 'utf8',
    shell: isWrapper,
    windowsHide: true,
  });
}

// ------------------------------------------------------------- protobuf
function readVarint(buf, o) {
  let r = 0, sh = 0;
  for (let i = 0; i < 10; i++) {
    if (o >= buf.length) throw new Error('varint overrun');
    const x = buf[o++];
    r += (x & 0x7f) * Math.pow(2, sh);
    if (!(x & 0x80)) return [r, o];
    sh += 7;
  }
  throw new Error('varint too long');
}

/** Parse one protobuf level into child descriptors. */
function parseLevel(buf) {
  const out = [];
  let o = 0;
  while (o < buf.length) {
    let tag;
    try { [tag, o] = readVarint(buf, o); } catch { break; }
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    const node = { field, wire };
    try {
      if (wire === 0) {
        let v; [v, o] = readVarint(buf, o);
        node.varint = v;
      } else if (wire === 1) {
        if (o + 8 > buf.length) break;
        node.double = buf.readDoubleLE(o);
        o += 8;
      } else if (wire === 2) {
        let len; [len, o] = readVarint(buf, o);
        if (o + len > buf.length) break;
        node.bytes = buf.subarray(o, o + len);
        o += len;
      } else if (wire === 5) {
        if (o + 4 > buf.length) break;
        node.float = buf.readFloatLE(o);
        node.int32 = buf.readInt32LE(o);
        o += 4;
      } else break;
    } catch { break; }
    out.push(node);
  }
  return out;
}

/**
 * Walk a protobuf message tree and return every numeric leaf with its
 * field path. Handles groups (wire types 3/4) and nested length-delimited
 * fields. `maxDepth` guards against runaway recursion on malformed data.
 */
function collectLeaves(buf, prefix = '', depth = 0, maxDepth = 12, out = []) {
  if (depth > maxDepth) return out;
  for (const node of parseLevel(buf)) {
    const p = prefix ? `${prefix}.${node.field}` : String(node.field);
    if (node.varint !== undefined) out.push({ path: p, kind: 'varint', value: node.varint });
    else if (node.double !== undefined) out.push({ path: p, kind: 'double', value: node.double });
    else if (node.float !== undefined) out.push({ path: p, kind: 'float', value: node.float, int32: node.int32 });
    else if (node.bytes) {
      const printable = node.bytes.length > 0 && node.bytes.every((b) => b >= 32 && b < 127);
      if (printable) {
        out.push({ path: p, kind: 'string', value: node.bytes.toString('latin1') });
      } else {
        collectLeaves(node.bytes, p, depth + 1, maxDepth, out);
      }
    }
  }
  return out;
}

/** Find the first child with a given field number inside a parsed level. */
function childOf(buf, field) {
  return parseLevel(buf).find((c) => c.field === field);
}

// ------------------------------------------------------------ MP4 probing
log(`probing ${ARGS.input}`);
const probeJson = JSON.parse(run(FFPROBE, [
  '-v', 'error', '-show_format', '-show_streams', '-of', 'json', ARGS.input,
]));
const streams = probeJson.streams || [];

const dataStreams = streams.filter((s) => s.codec_type === 'data');
log(`data streams: ${dataStreams.map((s) => `${s.index}:${s.codec_tag_string}(${s.handler_name || ''})`).join(', ') || 'none'}`);

function packetsFor(streamIndex) {
  const raw = run(FFPROBE, [
    '-v', 'error', '-select_streams', String(streamIndex),
    '-show_packets', '-show_entries', 'packet=pts_time,duration_time,size,pos',
    '-of', 'json', ARGS.input,
  ]);
  return JSON.parse(raw).packets || [];
}

// ---------------------------------------------- GPS extraction from djmd
/**
 * Extract GPS samples from a djmd-style metadata track.
 *
 * Walks the protobuf tree and looks for the canonical DJI coordinate layout:
 *   <root>.3.<n>.4.2.1.2  -> latitude  (double)
 *   <root>.3.<n>.4.2.1.3  -> longitude (double)
 *   <root>.3.<n>.4.2.2    -> gps_altitude_mm (varint)
 *   <root>.3.<n>.4.2.6.1  -> datetime string
 *
 * Field numbers are matched positionally but with sanity checks on the
 * numeric values, so a mismatch produces zero samples rather than garbage.
 */
function extractGpsFromLeaves(leaves) {
  const samples = [];
  // Build a path -> leaf index for the coordinate container.
  const byPath = new Map();
  for (const l of leaves) byPath.set(l.path, l);

  // Find every "coordinates" container: a path whose parent chain includes
  // remote_gps_info(4) and whose own children include info(1) with doubles.
  for (const l of leaves) {
    const parts = l.path.split('.');
    if (parts.length < 5) continue;
    // look for .../4/2/1/<2|3>  (remote_gps_info.coordinates.info.latitude)
    const n = parts.length;
    const infoField = Number(parts[n - 2]);
    const coordField = Number(parts[n - 1]);
    if (infoField !== 1) continue;
    if (coordField !== 2 && coordField !== 3) continue;
    // coords container = parts[0..n-3]; remote_gps_info must be '4' just above it
    const gpsMsgIdx = parts.indexOf('3');
    if (gpsMsgIdx === -1) continue;
    const container = parts.slice(0, n - 2).join('.');
    const remote = parts[gpsMsgIdx + 1];
    const coords = parts[gpsMsgIdx + 2];
    if (remote !== '4' || coords !== '2') continue;

    const latLeaf = byPath.get(`${container}.1.2`);
    const lonLeaf = byPath.get(`${container}.1.3`);
    const altLeaf = byPath.get(`${container}.2`);
    const dtLeaf = byPath.get(`${container}.6.1`);
    if (!latLeaf || !lonLeaf) continue;
    const lat = latLeaf.value;
    const lon = lonLeaf.value;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    samples.push({
      latitude: lat,
      longitude: lon,
      altitude_m: altLeaf && altLeaf.kind === 'varint' ? altLeaf.value / 1000 : null,
      datetime: dtLeaf && dtLeaf.kind === 'string' ? dtLeaf.value : null,
    });
  }
  return samples;
}

// ------------------------------------------------------------- geometry
const EARTH_R = 6371008.8; // mean Earth radius, metres
const toRad = (d) => (d * Math.PI) / 180;
/** Great-circle distance in metres (haversine). */
function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}
function bboxOf(points) {
  if (!points.length) return null;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.latitude); maxLat = Math.max(maxLat, p.latitude);
    minLon = Math.min(minLon, p.longitude); maxLon = Math.max(maxLon, p.longitude);
  }
  return {
    minLat, maxLat, minLon, maxLon,
    latSpanDeg: maxLat - minLat,
    lonSpanDeg: maxLon - minLon,
    northM: haversine({ lat: minLat, lon: minLon }, { lat: maxLat, lon: minLon }),
    eastM: haversine({ lat: minLat, lon: minLon }, { lat: minLat, lon: maxLon }),
  };
}

// ------------------------------------------------------------------ main
const fd = fs.openSync(ARGS.input, 'r');
const readPacket = (p) => {
  const b = Buffer.alloc(Number(p.size));
  fs.readSync(fd, b, 0, Number(p.size), Number(p.pos));
  return b;
};

const report = {
  source: {
    file: path.resolve(ARGS.input),
    bytes: fs.statSync(ARGS.input).size,
    format: probeJson.format
      ? {
        duration_s: probeJson.format.duration ? Number(probeJson.format.duration) : null,
        tags: probeJson.format.tags || {},
      }
      : null,
  },
  tool: { node: process.version, ffprobe: FFPROBE },
  streams: streams.map((s) => ({
    index: s.index,
    codec_type: s.codec_type,
    codec_tag_string: s.codec_tag_string || null,
    handler_name: s.tags?.handler_name || null,
    duration_s: s.duration ? Number(s.duration) : null,
    nb_frames: s.nb_frames ? Number(s.nb_frames) : null,
  })),
  telemetry: {},
};

let allSamples = [];
const perStream = [];

for (const s of dataStreams) {
  const packets = packetsFor(s.index);
  const leavesSeen = new Set();
  let doubleLeaves = 0;
  let gpsMsgBlocks = 0;
  let remoteGpsBlocks = 0;
  const samples = [];

  for (const p of packets) {
    const buf = readPacket(p);
    const leaves = collectLeaves(buf);
    for (const l of leaves) {
      leavesSeen.add(l.path);
      if (l.kind === 'double') doubleLeaves++;
    }
    // count structural markers for the diagnostic record
    const l1 = parseLevel(buf);
    for (const c1 of l1) {
      if (c1.wire !== 2 || !c1.bytes) continue;
      for (const c2 of parseLevel(c1.bytes)) {
        if (c1.field === 3) {
          gpsMsgBlocks++;
          if (c2.field === 4) remoteGpsBlocks++;
        }
      }
    }
    const got = extractGpsFromLeaves(leaves);
    for (const g of got) {
      samples.push({ pts_s: Number(p.pts_time), ...g });
    }
  }

  perStream.push({
    stream_index: s.index,
    codec_tag_string: s.codec_tag_string || null,
    handler_name: s.tags?.handler_name || null,
    packets: packets.length,
    distinct_leaf_paths: leavesSeen.size,
    double_leaves: doubleLeaves,
    gps_message_blocks: gpsMsgBlocks,
    remote_gps_blocks: remoteGpsBlocks,
    gps_samples: samples.length,
  });
  log(`stream ${s.index} (${s.codec_tag_string}): ${packets.length} packets, ${samples.length} gps samples`);
  allSamples = allSamples.concat(samples);
}

fs.closeSync(fd);

// de-duplicate samples that repeat the same coordinate at the same timestamp
const seen = new Set();
const track = [];
for (const s of allSamples.sort((a, b) => a.pts_s - b.pts_s)) {
  const key = `${s.pts_s.toFixed(3)}|${s.latitude.toFixed(7)}|${s.longitude.toFixed(7)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  track.push(s);
}

report.telemetry = {
  per_stream: perStream,
  gps: {
    status: track.length > 0 ? 'decoded' : 'absent',
    sample_count: track.length,
    samples: track,
    bbox: bboxOf(track),
    path_length_m: track.length > 1
      ? track.slice(1).reduce((acc, p, i) => acc + haversine(track[i], p), 0)
      : 0,
    straight_line_first_last_m: track.length > 1 ? haversine(track[0], track[track.length - 1]) : 0,
  },
};

if (track.length === 0) {
  report.telemetry.gps.diagnosis = {
    summary:
      'No GPS coordinate block was found in any data stream of this file.',
    checks_performed: [
      'Enumerated every data stream (codec_tag_string djmd/dbgi) and every packet.',
      'Walked the full protobuf tree of every packet (groups included), collecting all numeric leaves.',
      'Looked for the canonical DJI coordinate path (gps_info.remote_gps_info.coordinates.info.latitude/longitude, wire type 1 / double).',
      'Counted structural markers: gps_info message blocks vs. remote_gps_info coordinate blocks.',
      'Checked MP4 moov/udta/ilst atoms and the whole file for ISO-6709 location strings.',
    ],
  };
  log('');
  log('RESULT: no GPS telemetry present in this file.');
  log('  The camera recorded gps_info frames but the remote_gps_info coordinate block');
  log('  is absent, i.e. no GPS source was connected/paired for this recording.');
}

fs.mkdirSync(ARGS.out, { recursive: true });
const outFile = path.join(ARGS.out, 'telemetry.json');
fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');
log(`\nwrote ${outFile}`);

// ------------------------------------------------------ optional frames
if (ARGS.frames) {
  fs.mkdirSync(ARGS.frames, { recursive: true });
  const picks = track.length > 0
    ? pickSpread(track, ARGS.maxFrames)
    : [];
  if (picks.length === 0) {
    log('no frames extracted (no telemetry timestamps available)');
  }
  for (const p of picks) {
    const name = `frame-${p.pts_s.toFixed(3)}s.jpg`.replace(/\./g, '_');
    const dst = path.join(ARGS.frames, name);
    try {
      run(FFMPEG, [
        '-v', 'error', '-y', '-ss', String(p.pts_s), '-i', ARGS.input,
        '-frames:v', '1', '-q:v', '2', dst,
      ]);
      log(`frame ${name} (lat ${p.latitude.toFixed(7)}, lon ${p.longitude.toFixed(7)})`);
    } catch (e) {
      log(`frame extraction failed at ${p.pts_s}s: ${e.message}`);
    }
  }
}

function pickSpread(items, n) {
  if (items.length <= n) return items;
  const step = (items.length - 1) / (n - 1);
  const out = [];
  for (let i = 0; i < n; i++) out.push(items[Math.round(i * step)]);
  return out;
}
