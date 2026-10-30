// Mock backend server for local testing of the reconstruction flow.
// Run: node mock-server.js
// Then set NEXT_PUBLIC_SUPABASE_URL=http://localhost:3099 and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=mock-key in frontend/.env.local

const crypto = require('crypto');
const http = require('http');

const PORT = 3099;
const MOCK_USER_ID = '11111111-1111-4111-8111-111111111111';
const MOCK_ACCESS_TOKEN = 'mock-access-token';
const MOCK_REFRESH_TOKEN = 'mock-refresh-token';
const MOCK_STUDIO_ID = '22222222-2222-4222-8222-222222222222';
const MOCK_PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const MOCK_SESSION_ID = '44444444-4444-4444-8444-444444444444';
const MOCK_SOURCE_ID = '55555555-5555-4555-8555-555555555555';

// Minimal valid V2 scene
function makeScene() {
  return {
    schemaVersion: 2,
    venue: { shape: 'rectangle', width: 10, depth: 8, height: 3.6, entrances: [] },
    objects: [],
    camera: 'overview',
    lighting: 'neutral',
    structure: { walls: [], openings: [], columns: [] },
    sources: [],
    dimensions: [],
  };
}

// V2 scene with recognized (unconfirmed) structure for the needs_review stage:
// 12x8 venue, 4 exterior walls, 1 door, detected dimensions awaiting confirmation.
function makeReviewScene() {
  const wallIds = [0, 1, 2, 3].map(() => uuid());
  const points = [{ x: 0, z: 0 }, { x: 12, z: 0 }, { x: 12, z: 8 }, { x: 0, z: 8 }];
  const scene = makeScene();
  scene.venue = { shape: 'rectangle', width: 12, depth: 8, height: 3.6, entrances: [] };
  scene.structure = {
    walls: points.map((start, index) => ({
      id: wallIds[index], start, end: points[(index + 1) % 4],
      thickness: 0.16, height: 3.6, kind: 'exterior', status: 'detected',
    })),
    openings: [{ id: uuid(), wallId: wallIds[1], kind: 'door', offset: 2, width: 1.2, height: 2.1, sillHeight: 0, status: 'detected' }],
    columns: [],
  };
  scene.dimensions = [
    { id: uuid(), kind: 'width', valueMeters: 12, status: 'detected', label: '总宽' },
    { id: uuid(), kind: 'depth', valueMeters: 8, status: 'detected', label: '总深' },
    { id: uuid(), kind: 'height', valueMeters: 3.6, status: 'detected', label: '净高' },
  ];
  return scene;
}

function makeProposal(candidate) {
  const baseScene = lastReconstructionScene || makeScene();
  return {
    id: '66666666-6666-4666-8666-666666666666',
    project_id: MOCK_PROJECT_ID,
    user_id: MOCK_USER_ID,
    session_id: currentSessionId,
    generation: currentGeneration,
    base_revision: lastReconstructionRevision,
    local_revision: lastReconstructionLocalRevision,
    base_hash: sceneHash(baseScene),
    base_scene: baseScene,
    candidate: candidate || makeScene(),
    explanation: '根据图纸识别到 10×8 米的矩形场地，已生成基础布置方案。',
    warnings: [],
    expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    applied_at: null,
  };
}

// Reconstruction job state machine
const jobs = new Map();
let jobCounter = 0;
let currentSessionId = MOCK_SESSION_ID;
let currentGeneration = 1;
let currentRevision = 0;
let lastReconstructionScene = null;
let lastReconstructionRevision = 0;
let lastReconstructionLocalRevision = 0;

function sceneHash(scene) {
  const canonical = (value) => {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',') + '}';
    return JSON.stringify(value);
  };
  return crypto.createHash('sha256').update(canonical(scene)).digest('hex');
}

function advanceJob(job) {
  // review flow: first pass stops at needs_review with a recognized structure;
  // continue flow (after the user confirms scale/structure): runs to ready.
  const states = job.flow === 'continue'
    ? ['planning', 'validating', 'ready']
    : ['queued', 'recognizing', 'needs_review'];
  const idx = states.indexOf(job.state);
  if (idx < 0 || idx >= states.length - 1) return;
  job.state = states[idx + 1];
  if (job.state === 'needs_review') {
    job.candidate = makeReviewScene();
    job.issues = [];
  }
  if (job.state === 'ready') {
    job.candidate = job.reviewedScene || makeScene();
    job.proposal = makeProposal(job.candidate);
    latestProposal = job.proposal;
  }
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Minimal valid GLB containing a unit cube, so asset-backed materials render as a placeholder box.
let cachedGlb = null;
function makeCubeGlb() {
  if (cachedGlb) return cachedGlb;
  const v = 0.5;
  const positions = new Float32Array([
    -v, -v, -v, v, -v, -v, v, v, -v, -v, v, -v,
    -v, -v, v, v, -v, v, v, v, v, -v, v, v,
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 4, 5, 1, 4, 1, 0,
    7, 3, 2, 7, 2, 6, 5, 6, 2, 5, 2, 1, 7, 4, 0, 7, 0, 3,
  ]);
  const posBuf = Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength);
  const idxBuf = Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength);
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-v, -v, -v], max: [v, v, v] },
      { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 96 },
      { buffer: 0, byteOffset: 96, byteLength: 72 },
    ],
    buffers: [{ byteLength: 168 }],
  };
  const json = Buffer.from(JSON.stringify(gltf));
  const jsonPad = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat([posBuf, idxBuf]);
  const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const total = 12 + 8 + jsonPad.length + 8 + binPad.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPad.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPad.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  cachedGlb = Buffer.concat([header, jsonHeader, jsonPad, binHeader, binPad]);
  return cachedGlb;
}

// Public-library assets ship with the frontend as static GLBs; map assetId → dev-server path so
// placed materials render the real model locally instead of the placeholder cube.
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
const assetIds = require('./assets/library/asset-ids.json');
const localModelByAssetId = new Map(
  Object.entries(assetIds)
    .filter(([url]) => url.startsWith('/showcase/assets/library/model/'))
    .map(([url, id]) => [id, url])
);

let uploadedSources = [];
let latestProposal = null;

// --- 工作室与项目（管理页读的是 /studios/:id/projects 与 /members，字段按前端的小驼峰）---
const mockMembers = [
  { userId: MOCK_USER_ID, role: 'owner', displayName: '负责人 A' },
  { userId: 'aaaaaaaa-0000-4000-8000-000000000001', role: 'editor', displayName: '设计师 A' },
];
const mockProjects = [
  { id: MOCK_PROJECT_ID, studio_id: MOCK_STUDIO_ID, name: '周末共创工作坊', revision: 3, updated_at: new Date(Date.now() - 864e5).toISOString() },
  {
    id: '33333333-3333-4333-8333-333333333334', studio_id: MOCK_STUDIO_ID, name: '秋季新品发布会', revision: 7,
    updated_at: new Date().toISOString(), current_editor: '设计师 A', lease_expires: new Date(Date.now() + 3e5).toISOString(),
  },
];

// --- Generation (Lux3D/HY3) mock state ---
const genJobs = new Map();
function makeGenJob(body) {
  return {
    id: uuid(),
    owner_id: MOCK_USER_ID,
    prompt: body?.prompt || 'mock 物件',
    kind: body?.kind ?? 'text',
    state: 'queued',
    asset_id: null,
    source_asset_id: null,
    reference_image_asset_id: null,
    provider_job_id: `mock-${Date.now()}`,
    provider_mode: body?.provider === 'aholo' ? 'aholo' : 'tokenhub',
    provider_model: body?.provider === 'aholo' ? 'lux3d' : 'hy-3d-3.0',
    next_poll_at: new Date().toISOString(),
    attempts: 0,
    error_code: null,
    provider_usage: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    reused: false,
  };
}
function advanceGenJob(job) {
  const states = ['queued', 'submitting', 'submitted', 'processing', 'ready'];
  const idx = states.indexOf(job.state);
  if (idx < 0 || idx >= states.length - 1) return;
  job.state = states[idx + 1];
  if (job.state === 'ready') job.asset_id = uuid();
  job.updated_at = new Date().toISOString();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  console.log(`[${new Date().toISOString()}] ${method} ${path}`);

  // Placeholder GLB for asset-backed materials.
  if (path.startsWith('/mock-assets/')) {
    res.writeHead(200, { 'Content-Type': 'model/gltf-binary' });
    res.end(makeCubeGlb());
    return;
  }

  // Parse body
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    let json = null;
    if (body && !path.includes('/assets/sources')) {
      try { json = JSON.parse(body); } catch { json = body; }
    }

    // --- Supabase Auth ---
    if (path === '/auth/v1/signup' || path.endsWith('/auth/v1/signup')) {
      const resp = {
        access_token: MOCK_ACCESS_TOKEN,
        refresh_token: MOCK_REFRESH_TOKEN,
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'bearer',
        user: { id: MOCK_USER_ID, email: 'guest@mock.local', is_anonymous: true, role: 'authenticated', app_metadata: {}, user_metadata: { display_name: '访客' }, aud: 'authenticated', created_at: new Date().toISOString() },
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resp));
      return;
    }

    if (path === '/auth/v1/token' || path.endsWith('/auth/v1/token')) {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const cred = json || {};
        if (!cred.email || !cred.password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }));
          return;
        }
        const resp = {
          access_token: MOCK_ACCESS_TOKEN,
          refresh_token: MOCK_REFRESH_TOKEN,
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          token_type: 'bearer',
          user: { id: MOCK_USER_ID, email: cred.email, is_anonymous: false, role: 'authenticated', app_metadata: {}, user_metadata: { display_name: cred.email.split('@')[0] }, aud: 'authenticated', created_at: new Date().toISOString() },
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resp));
        return;
      }
      if (grant === 'refresh_token') {
        const resp = {
          access_token: MOCK_ACCESS_TOKEN,
          refresh_token: MOCK_REFRESH_TOKEN,
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          token_type: 'bearer',
          user: { id: MOCK_USER_ID, email: 'guest@mock.local', is_anonymous: true, role: 'authenticated', aud: 'authenticated', created_at: new Date().toISOString() },
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resp));
        return;
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unsupported_grant_type', error_description: `grant_type ${grant} not supported by mock` }));
      return;
    }

    if (path === '/auth/v1/user' || path.endsWith('/auth/v1/user')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ user: { id: MOCK_USER_ID, email: 'guest@mock.local', is_anonymous: true, role: 'authenticated', aud: 'authenticated', created_at: new Date().toISOString() } }));
      return;
    }

    if (path === '/auth/v1/logout' || path.endsWith('/auth/v1/logout')) {
      res.writeHead(204); res.end(); return;
    }

    // --- Scene API ---
    if (path.includes('/functions/v1/scene-api') || path.startsWith('/studios') || path.startsWith('/projects') || path.startsWith('/assets')) {
      // Strip prefix if present
      const apiPath = path.replace('/functions/v1/scene-api', '');

      // Studios
      if (apiPath === '/studios') {
        if (method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify([{ id: MOCK_STUDIO_ID, name: '我的工作室', role: 'owner', displayName: '我的工作室' }]));
          return;
        }
        if (method === 'POST') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: MOCK_STUDIO_ID, name: json?.name || '我的工作室', role: 'owner', displayName: json?.name || '我的工作室' }));
          return;
        }
      }

      // Projects list
      if (apiPath === '/projects' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mockProjects));
        return;
      }

      // 工作室维度的列表与成员（管理页进的就是这两条）
      const studioProjectsMatch = apiPath.match(/^\/studios\/([^/]+)\/projects$/);
      if (studioProjectsMatch && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mockProjects.filter(project => project.studio_id === studioProjectsMatch[1])));
        return;
      }
      const studioMembersMatch = apiPath.match(/^\/studios\/([^/]+)\/members$/);
      if (studioMembersMatch && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mockMembers));
        return;
      }

      // Create project
      if (apiPath === '/projects' && method === 'POST') {
        const project = {
          id: MOCK_PROJECT_ID,
          name: json?.name || '未命名项目',
          studio_id: MOCK_STUDIO_ID,
          revision: 0,
          updated_at: new Date().toISOString(),
          scene: json?.scene || makeScene(),
          materials: [],
        };
        mockProjects.push({ id: project.id, studio_id: MOCK_STUDIO_ID, name: project.name, revision: project.revision, updated_at: project.updated_at });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(project));
        return;
      }

      // Get project
      const projectMatch = apiPath.match(/^\/projects\/([^/]+)$/);
      if (projectMatch && method === 'GET') {
        const project = {
          id: projectMatch[1],
          name: mockProjects.find((p) => p.id === projectMatch[1])?.name || '未命名项目',
          studio_id: MOCK_STUDIO_ID,
          revision: mockProjects.find((p) => p.id === projectMatch[1])?.revision ?? 0,
          updated_at: new Date().toISOString(),
          scene: makeScene(),
          materials: [],
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(project));
        return;
      }

      // Update project (PATCH)
      if (projectMatch && method === 'PATCH') {
        const project = {
          id: projectMatch[1],
          name: json?.name || '未命名项目',
          studio_id: MOCK_STUDIO_ID,
          revision: json?.revision ?? 0,
          updated_at: new Date().toISOString(),
          scene: json?.scene || makeScene(),
          materials: [],
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(project));
        return;
      }

      // Lease acquire
      const leaseAcquireMatch = apiPath.match(/^\/projects\/([^/]+)\/lease\/acquire$/);
      if (leaseAcquireMatch && method === 'POST') {
        const reqSessionId = json?.sessionId || MOCK_SESSION_ID;
        currentSessionId = reqSessionId;
        currentGeneration = 1;
        currentRevision = 0;
        const resp = {
          sessionId: reqSessionId,
          generation: currentGeneration,
          expectedRevision: 0,
          revision: currentRevision,
          expiresAt: new Date(Date.now() + 60 * 1000).toISOString(),
          scene: makeScene(),
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resp));
        return;
      }

      // Lease renew
      const leaseRenewMatch = apiPath.match(/^\/projects\/([^/]+)\/lease\/renew$/);
      if (leaseRenewMatch && method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sessionId: json?.sessionId || MOCK_SESSION_ID, generation: json?.generation ?? 1, expectedRevision: 0, revision: 0, expiresAt: new Date(Date.now() + 60 * 1000).toISOString() }));
        return;
      }

      // Lease release
      const leaseReleaseMatch = apiPath.match(/^\/projects\/([^/]+)\/lease\/release$/);
      if (leaseReleaseMatch && method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ released: true }));
        return;
      }

      // Sources list
      const sourcesMatch = apiPath.match(/^\/projects\/([^/]+)\/sources$/);
      if (sourcesMatch && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(uploadedSources));
        return;
      }

      // Upload source (multipart)
      if (apiPath === '/assets/sources' && method === 'POST') {
        // Parse multipart to get kind
        const boundary = req.headers['content-type']?.split('boundary=')[1];
        const source = {
          assetId: uuid(),
          kind: 'floorplan',
          name: 'uploaded-image.png',
          width: 800,
          height: 600,
        };
        uploadedSources.push(source);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(source));
        return;
      }

      // Create reconstruction
      const reconCreateMatch = apiPath.match(/^\/projects\/([^/]+)\/reconstructions$/);
      if (reconCreateMatch && method === 'POST') {
        const jobId = uuid();
        lastReconstructionScene = json?.scene || makeScene();
        lastReconstructionRevision = json?.expectedRevision ?? 0;
        lastReconstructionLocalRevision = json?.localRevision ?? 0;
        console.log('[RECON CREATE] scene schemaVersion:', lastReconstructionScene.schemaVersion, 'hash:', sceneHash(lastReconstructionScene).slice(0,16), 'localRevision:', lastReconstructionLocalRevision, 'continue:', !!json?.reviewedScene);
        const continuing = !!json?.reviewedScene;
        const job = {
          id: jobId,
          state: continuing ? 'planning' : 'queued',
          flow: continuing ? 'continue' : 'review',
          reviewedScene: json?.reviewedScene || null,
          candidate: null,
          proposal: null,
          issues: [],
          error_code: null,
          created_at: new Date().toISOString(),
        };
        jobs.set(jobId, job);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(job));
        return;
      }

      // Get reconstruction job
      const reconGetMatch = apiPath.match(/^\/projects\/([^/]+)\/reconstructions\/([^/]+)$/);
      if (reconGetMatch && method === 'GET') {
        const job = jobs.get(reconGetMatch[2]);
        if (job) {
          advanceJob(job);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(job));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'NOT_FOUND' } }));
        }
        return;
      }

      // Apply proposal
      const applyProposalMatch = apiPath.match(/^\/projects\/([^/]+)\/proposals\/apply$/);
      if (applyProposalMatch && method === 'POST') {
        const applyScene = json?.currentScene;
        const applyHash = applyScene ? sceneHash(applyScene).slice(0, 16) : 'none';
        const baseHash = lastReconstructionScene ? sceneHash(lastReconstructionScene).slice(0, 16) : 'none';
        console.log('[APPLY] scene schemaVersion:', applyScene?.schemaVersion, 'hash:', applyHash, 'baseHash:', baseHash, 'match:', applyHash === baseHash);
        const applied = latestProposal || makeProposal();
        currentRevision += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: applyProposalMatch[1],
          revision: currentRevision,
          scene: applied.candidate,
          updatedAt: new Date().toISOString(),
          previousScene: applied.base_scene,
          undoGroup: applied.id,
        }));
        return;
      }

      // Proposals create (for agent runs / other)
      if (apiPath.match(/^\/projects\/[^/]+\/proposals$/) && method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(makeProposal()));
        return;
      }

      // Asset URL
      const assetUrlMatch = apiPath.match(/^\/assets\/([^/]+)\/url$/);
      if (assetUrlMatch && method === 'POST') {
        const localPath = localModelByAssetId.get(assetUrlMatch[1].toLowerCase());
        const url = localPath ? `${FRONTEND_ORIGIN}${localPath}` : `http://localhost:${PORT}/mock-assets/${assetUrlMatch[1]}.glb`;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: assetUrlMatch[1], format: 'glb', name: 'mock-asset', url, expiresIn: 300 }));
        return;
      }

      // Generation capabilities (Aholo Lux3D advertised so the UI entry is exercisable in dev)
      if (apiPath === '/generation/capabilities' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ model: 'hy-3d-3.0', textToModel: true, imageToModel: true, texture: false, textureRequiresImage: true, aholoTextToModel: true, aholoImageToModel: true }));
        return;
      }

      // Generation jobs lifecycle: one step per poll so the UI shows intermediate states.
      if (apiPath === '/jobs' && method === 'POST') {
        console.log('[GEN CREATE] provider:', json?.provider ?? 'default', 'kind:', json?.kind ?? 'text', 'prompt:', json?.prompt);
        const job = makeGenJob(json);
        genJobs.set(job.id, job);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(job));
        return;
      }
      if (apiPath === '/jobs' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([...genJobs.values()]));
        return;
      }
      const genJobMatch = apiPath.match(/^\/jobs\/([^/]+)(\/added)?$/);
      if (genJobMatch) {
        const job = genJobs.get(genJobMatch[1]);
        if (!job) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'NOT_FOUND' } }));
          return;
        }
        if (genJobMatch[2]) { job.state = 'added'; job.updated_at = new Date().toISOString(); }
        else advanceGenJob(job);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(job));
        return;
      }

      // History restore
      const restoreMatch = apiPath.match(/^\/projects\/[^/]+\/history\/restore$/);
      if (restoreMatch && method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: uuid(), revision: 1, scene: makeScene(), updatedAt: new Date().toISOString(), previousScene: makeScene(), undoGroup: uuid() }));
        return;
      }

      // Scene save (PUT)
      const sceneSaveMatch = apiPath.match(/^\/projects\/[^/]+\/scene$/);
      if (sceneSaveMatch && method === 'PUT') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ revision: (json?.expectedRevision ?? 0) + 1, scene: json?.scene || makeScene() }));
        return;
      }

      console.log(`UNHANDLED: ${method} ${apiPath}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: `No handler for ${method} ${apiPath}` } }));
      return;
    }

    console.log(`UNMATCHED: ${method} ${path}`);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'NOT_FOUND' } }));
  });
});

server.listen(PORT, () => {
  console.log(`Mock backend server running on http://localhost:${PORT}`);
});
