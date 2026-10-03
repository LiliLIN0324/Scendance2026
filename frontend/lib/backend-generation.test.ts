import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sceneHash, type Scene } from "../../supabase/functions/_shared/domain";
import { BackendSession, getBackendConfig, type GenerationJob, type SceneProposal } from "./backend-session";

const projectId = "10000000-0000-4000-8000-000000000001";
const otherProjectId = "10000000-0000-4000-8000-000000000002";
const userId = "20000000-0000-4000-8000-000000000001";
const proposalId = "30000000-0000-4000-8000-000000000001";
const assetId = "40000000-0000-4000-8000-000000000001";
const requestId = "50000000-0000-4000-8000-000000000001";
const objectId = "60000000-0000-4000-8000-000000000001";
const scene: Scene = { schemaVersion: 1, venue: { width: 12, depth: 10, height: 3, shape: "rectangle", entrances: [] }, objects: [], camera: "overview", lighting: "neutral" };
const candidate: Scene = { ...scene, objects: [{ id: objectId, materialId: "chair", position: { x: 2, z: 3 }, rotation: 0, size: { width: 0.5, depth: 0.5, height: 0.85 }, color: "#ffffff", locked: false, notes: "" }] };
const auth = { access_token: "test-access", refresh_token: "test-refresh", expires_in: 3600, user: { id: userId } };
const fetchMock = vi.fn<typeof fetch>();
let controller: BackendSession;
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status }); }
function queue(body: unknown, status = 200) { fetchMock.mockResolvedValueOnce(json(body, status)); }
function body(index = fetchMock.mock.calls.length - 1) { return JSON.parse(String(fetchMock.mock.calls[index]![1]?.body)); }
function pending() {
  let resolve!: (value: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  return { finish: (value: unknown, status = 200) => resolve(json(value, status)), ready: () => vi.waitFor(() => expect(resolve).toBeTypeOf("function")) };
}
async function login() { queue(auth); await controller.signIn("user@example.com", "test"); }
async function editing() {
  await login();
  queue({ id: projectId, name: "Workshop", studio_id: userId, revision: 4, scene });
  await controller.getProject(projectId);
  queue({ sessionId: controller.getSnapshot().sessionId, generation: 3, expiresAt: new Date(Date.now() + 90_000).toISOString(), revision: 4, scene });
  await controller.acquireLease(projectId);
}
async function handoff(nextProjectId = otherProjectId, generation = 8) {
  queue({}); await controller.releaseLease();
  if (nextProjectId !== controller.getSnapshot().project?.id) {
    queue({ id: nextProjectId, name: "Second", studio_id: userId, revision: 1, scene: candidate });
    await controller.getProject(nextProjectId);
  }
  queue({ sessionId: controller.getSnapshot().sessionId, generation, expiresAt: new Date(Date.now() + 90_000).toISOString(), revision: 1, scene: candidate });
  await controller.acquireLease(nextProjectId);
}
async function expectCurrentLeaseStillRenews(nextProjectId = otherProjectId, generation = 8) {
  expect(controller.getSnapshot()).toMatchObject({ status: "editing", writeBlocked: false, error: null,
    user: { id: userId }, project: { id: nextProjectId }, lease: { projectId: nextProjectId, generation } });
  queue({ sessionId: controller.getSnapshot().sessionId, generation, expiresAt: new Date(Date.now() + 120_000).toISOString(), revision: 1 });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(String(fetchMock.mock.calls.at(-1)![0])).toContain(`/projects/${nextProjectId}/lease/renew`);
  expect(body().generation).toBe(generation);
}
async function proposal(overrides: Partial<SceneProposal> = {}): Promise<SceneProposal> {
  const state = controller.getSnapshot();
  return { id: proposalId, project_id: projectId, user_id: userId, session_id: state.sessionId,
    generation: 3, base_revision: 4, local_revision: state.localRevision, base_hash: await sceneHash(state.draft ?? scene),
    base_scene: state.draft ?? scene, candidate, explanation: "加入一把椅子", warnings: [],
    expires_at: new Date(Date.now() + 600_000).toISOString(), applied_at: null, ...overrides };
}
function applied() { return { id: projectId, revision: 5, scene: candidate, updatedAt: new Date().toISOString(), previousScene: scene, undoGroup: proposalId }; }
function job(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return { id: proposalId, owner_id: userId, prompt: "A tent", state: "queued", provider_job_id: null, asset_id: null,
    next_poll_at: new Date().toISOString(), attempts: 0, error_code: null, provider_usage: {},
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), reused: false, ...overrides };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-02T08:00:00Z"));
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset();
  controller = new BackendSession(getBackendConfig({ url: "https://example.supabase.co", anonKey: "sb_publishable_test" }));
});
afterEach(() => { controller.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("AI proposal contract and paid request protection", () => {
  it.each([[429, "DAILY_BUDGET_EXCEEDED"], [429, "BUDGET_EXCEEDED"], [503, "SERVICE_NOT_CONFIGURED"], [422, "AI_INVALID_PROPOSAL"], [409, "AI_IN_PROGRESS"], [409, "AI_PREVIOUS_REQUEST_FAILED"]])("keeps editing available after AI-only %s %s", async (status, code) => {
    await editing(); queue({ error: { code } }, status as number);
    await expect(controller.requestProposal({ mode: "layout", prompt: "安排沙龙", scene })).rejects.toMatchObject({ code });
    expect(controller.getSnapshot()).toMatchObject({ writeBlocked: false, draft: scene, revision: 4 });
    queue({ sessionId: controller.getSnapshot().sessionId, generation: 3, revision: 4, expiresAt: new Date(Date.now() + 120_000).toISOString() });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/lease/renew');
  });
  it("sends the real proposal contract and leaves the draft unchanged for preview", async () => {
    await editing(); const before = controller.getSnapshot(); const result = await proposal(); queue(result);
    await expect(controller.requestProposal({ mode: "layout", prompt: "  Add one chair  ", scene, requestId })).resolves.toEqual(result);
    expect(body()).toEqual({ projectId, sessionId: before.sessionId, generation: 3, expectedRevision: 4,
      localRevision: before.localRevision, scene, instruction: "Add one chair", mode: "layout", selectedIds: [], requestId });
    expect(controller.getSnapshot()).toBe(before);
  });
  it('retains structured HY3 suggestions alongside an unchanged scene', async () => {
    await editing();
    const result=await proposal({candidate:scene,modelSuggestions:[{name:'花形拱门',reason:'资源库缺少该造型',prompt:'单件花形拱门，无背景'}]});
    queue(result);
    await expect(controller.requestProposal({mode:'modify',prompt:'加入花形拱门',scene})).resolves.toEqual(result);
    expect(controller.getSnapshot().revision).toBe(4);
  });
  it('rejects malformed suggestions instead of passing them to a paid generation form', async () => {
    await editing();
    queue({...await proposal(),modelSuggestions:[{name:'拱门',reason:'缺少',prompt:'x'.repeat(1025)}]});
    await expect(controller.requestProposal({mode:'modify',prompt:'加入拱门',scene})).rejects.toThrow('modelSuggestions');
  });
  it("rejects nonempty initial layouts before spending a request", async () => {
    await editing();
    await expect(controller.requestProposal({ mode: "layout", prompt: "Plan", scene: candidate })).rejects.toMatchObject({ code: "LAYOUT_REQUIRES_EMPTY_SCENE" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot().draft).toEqual(scene);
  });
  it("validates selected objects and prompt before sending", async () => {
    await editing();
    await expect(controller.requestProposal({ mode: "modify", prompt: "Move", scene, selectedIds: [objectId] })).rejects.toMatchObject({ code: "OBJECT_NOT_FOUND" });
    await expect(controller.requestProposal({ mode: "modify", prompt: " ", scene })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("coalesces double clicks with one stable request ID and lets leases renew", async () => {
    await editing(); const result = await proposal(); const call = pending();
    const first = controller.requestProposal({ mode: "layout", prompt: "Plan", scene }); await call.ready();
    const second = controller.requestProposal({ mode: "layout", prompt: "Plan", scene });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    queue({ sessionId: controller.getSnapshot().sessionId, generation: 3, revision: 4, expiresAt: new Date(Date.now() + 120_000).toISOString() });
    await controller.renewLease(); expect(String(fetchMock.mock.calls[4]![0])).toContain("/lease/renew");
    call.finish(result); await expect(first).resolves.toEqual(result); await expect(second).resolves.toEqual(result);
    expect(body(3).requestId).toMatch(/^[\da-f-]{36}$/);
  });
  it("rejects late previews after a local edit without replacing the draft", async () => {
    await editing(); const result = await proposal(); const call = pending();
    const generating = controller.requestProposal({ mode: "layout", prompt: "Plan", scene }); await call.ready();
    const changed = { ...scene, lighting: "warm" as const }; controller.setDraft(changed); call.finish(result);
    await expect(generating).rejects.toMatchObject({ code: "STALE_PROPOSAL" });
    expect(controller.getSnapshot()).toMatchObject({ draft: changed, dirty: true, writeBlocked: false, revision: 4 });
  });
  it("keeps the request ID after a lost response and never retries automatically", async () => {
    await editing(); fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await expect(controller.requestProposal({ mode: "layout", prompt: "Plan", scene })).rejects.toThrow("offline");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(controller.getSnapshot()).toMatchObject({ writeBlocked: true, draft: scene });
    await vi.advanceTimersByTimeAsync(60_000); expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("rejects reuse of a request ID for a different paid instruction", async () => {
    await editing(); queue(await proposal());
    await controller.requestProposal({ mode: "layout", prompt: "Plan", scene, requestId });
    await expect(controller.requestProposal({ mode: "layout", prompt: "Another plan", scene, requestId })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("invalidates previews after session disposal", async () => {
    await editing(); const result = await proposal(); const call = pending();
    const generating = controller.requestProposal({ mode: "layout", prompt: "Plan", scene }); await call.ready();
    controller.dispose(); call.finish(result);
    await expect(generating).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(controller.getSnapshot().draft).toEqual(scene);
  });
  it("rejects late previews after releasing the lease and opening another project", async () => {
    await editing(); const result = await proposal(); const call = pending();
    const generating = controller.requestProposal({ mode: "layout", prompt: "Plan", scene }); await call.ready();
    queue({}); await controller.releaseLease();
    queue({ id: otherProjectId, name: "Second", studio_id: userId, revision: 1, scene: candidate });
    await controller.getProject(otherProjectId); call.finish(result);
    await expect(generating).rejects.toMatchObject({ code: "STALE_PROPOSAL" });
    expect(controller.getSnapshot()).toMatchObject({ project: { id: otherProjectId }, draft: candidate, revision: 1 });
  });
  it.each([["LEASE_LOST", 409], ["UNAUTHENTICATED", 401]] as const)("does not let an old proposal %s block another project's editor", async (code, status) => {
    await editing(); const call = pending();
    const generating = controller.requestProposal({ mode: "layout", prompt: "Plan", scene }); await call.ready();
    await handoff(); call.finish({ error: { code } }, status);
    await expect(generating).rejects.toMatchObject({ code });
    await expectCurrentLeaseStillRenews();
    expect(controller.getSnapshot().draft).toEqual(candidate);
  });
  it("does not let an old generation of the same lease block its replacement", async () => {
    await editing(); const call = pending();
    const generating = controller.requestProposal({ mode: "layout", prompt: "Plan", scene }); await call.ready();
    await handoff(projectId, 4); call.finish({ error: { code: "LEASE_LOST" } }, 409);
    await expect(generating).rejects.toMatchObject({ code: "LEASE_LOST" });
    await expectCurrentLeaseStillRenews(projectId, 4);
  });
  it("does not let an old proposal's asset authorization error block the next project", async () => {
    await editing(); const call = pending();
    const generated: Scene = { ...scene, objects: [{ ...candidate.objects[0]!, materialId: "asset", assetId }] };
    const authorizing = controller.authorizeAssets(generated); await call.ready();
    await handoff(); call.finish({ error: { code: "ASSET_NOT_FOUND" } }, 404);
    await expect(authorizing).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
    await expectCurrentLeaseStillRenews();
  });
  it("generates a new logical request when the user requests the same expired preview again", async () => {
    await editing(); queue(await proposal({ expires_at: new Date(Date.now() + 1_000).toISOString() }));
    await controller.requestProposal({ mode: "layout", prompt: "Plan", scene });
    const firstRequestId = body().requestId;
    vi.setSystemTime(new Date(Date.now() + 2_000));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const regenerated = await proposal({ id: "30000000-0000-4000-8000-000000000002" }); queue(regenerated);
    await expect(controller.requestProposal({ mode: "layout", prompt: "Plan", scene })).resolves.toEqual(regenerated);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(body().requestId).not.toBe(firstRequestId);
    expect(body().instruction).toBe("Plan");
    await expect(controller.requestProposal({ mode: "layout", prompt: "Plan", scene })).resolves.toEqual(regenerated);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
  it("starts a new logical request for a known applied proposal even if its old key is supplied", async () => {
    await editing(); const first = await proposal(); queue(first);
    await controller.requestProposal({ mode: "layout", prompt: "Plan", scene, requestId });
    queue(applied()); await controller.applySceneProposal(first, scene);
    const next = await proposal({ id: "30000000-0000-4000-8000-000000000002", base_revision: 5 }); queue(next);
    await expect(controller.requestProposal({ mode: "modify", prompt: "Plan", scene: candidate, requestId })).resolves.toEqual(next);
    expect(body().requestId).not.toBe(requestId);
    expect(body().expectedRevision).toBe(5);
  });
  it("rejects expired leases and expired proposals before applying", async () => {
    await editing(); const expired = await proposal({ expires_at: new Date(Date.now() - 1).toISOString() });
    await expect(controller.applySceneProposal(expired, scene)).rejects.toMatchObject({ code: "STALE_PROPOSAL" });
    expect(controller.getSnapshot().writeBlocked).toBe(false);
    vi.setSystemTime(new Date(Date.now() + 91_000));
    await expect(controller.requestProposal({ mode: "layout", prompt: "Plan", scene })).rejects.toMatchObject({ code: "LEASE_LOST" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("applies through one atomic endpoint and returns the server undo scene", async () => {
    await editing(); const next = await proposal(); const previousRevision = controller.getSnapshot().localRevision; queue(applied());
    await expect(controller.applySceneProposal(next, scene)).resolves.toMatchObject({ ...applied(), acceptedLocally: true });
    expect(String(fetchMock.mock.calls[3]![0])).toContain(`/projects/${projectId}/proposals/apply`);
    expect(body()).toEqual({ proposalId, sessionId: next.session_id, generation: 3, expectedRevision: 4, localRevision: previousRevision, currentScene: scene });
    expect(controller.getSnapshot()).toMatchObject({ revision: 5, draft: candidate, dirty: false, localRevision: previousRevision + 1 });
    await expect(controller.applySceneProposal(next, candidate)).rejects.toMatchObject({ code: "STALE_PROPOSAL" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("preserves edits made during apply and tells UI not to replace its canvas", async () => {
    await editing(); const next = await proposal(); const call = pending();
    const saving = controller.applySceneProposal(next, scene); await call.ready();
    const changed = { ...scene, camera: "top" as const }; controller.setDraft(changed); call.finish(applied());
    await expect(saving).resolves.toMatchObject({ acceptedLocally: false, revision: 5 });
    expect(controller.getSnapshot()).toMatchObject({ draft: changed, dirty: true, revision: 5, project: { scene: candidate } });
  });
});

describe("single object generation jobs", () => {
  it("keeps the draft and lease while a background job-list refresh is unavailable", async () => {
    await editing();
    const draft = { ...scene, lighting: "warm" as const };
    controller.setDraft(draft);
    fetchMock.mockRejectedValueOnce(new TypeError("connection reset"));
    await expect(controller.listGenerationJobs()).rejects.toThrow("connection reset");
    expect(controller.getSnapshot()).toMatchObject({ writeBlocked: false, dirty: true, draft, revision: 4 });
    queue({ sessionId: controller.getSnapshot().sessionId, generation: 3, revision: 4, expiresAt: new Date(Date.now() + 120_000).toISOString() });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/lease/renew');
  });

  it.each(["create", "get", "list", "added"] as const)("isolates a late job %s failure from a new project lease", async operation => {
    await editing(); const call = pending();
    const jobRequest = operation === "create" ? controller.createGenerationJob("A tent", requestId)
      : operation === "get" ? controller.getGenerationJob(proposalId)
        : operation === "list" ? controller.listGenerationJobs()
          : controller.markGenerationAdded(proposalId, projectId);
    await call.ready(); await handoff(); call.finish({ error: { code: "JOB_NOT_FOUND" } }, 404);
    await expect(jobRequest).rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
    await expectCurrentLeaseStillRenews();
  });
  it("does not block the current project when marking an asset in a different project fails", async () => {
    await editing(); queue({ error: { code: "ASSET_NOT_IN_SAVED_SCENE" } }, 409);
    await expect(controller.markGenerationAdded(proposalId, otherProjectId)).rejects.toMatchObject({ code: "ASSET_NOT_IN_SAVED_SCENE" });
    expect(controller.getSnapshot()).toMatchObject({ project: { id: projectId }, writeBlocked: false, status: "editing", error: null });
  });
  it("uses real task states and requires saving before marking an asset added", async () => {
    await login(); queue(job(), 202);
    await expect(controller.createGenerationJob("  A tent  ", requestId)).resolves.toMatchObject({ state: "queued", asset_id: null });
    expect(body()).toEqual({ prompt: "A tent", requestId });
    const ready = job({ state: "ready", asset_id: assetId }); queue([ready]);
    await expect(controller.listGenerationJobs()).resolves.toEqual([ready]); queue(ready);
    await expect(controller.getGenerationJob(proposalId)).resolves.toEqual(ready);
    queue({ error: { code: "ASSET_NOT_IN_SAVED_SCENE" } }, 409);
    await expect(controller.markGenerationAdded(proposalId, projectId)).rejects.toMatchObject({ code: "ASSET_NOT_IN_SAVED_SCENE" });
    queue(job({ state: "added", asset_id: assetId }));
    await expect(controller.markGenerationAdded(proposalId, projectId)).resolves.toMatchObject({ state: "added" });
    expect(body()).toEqual({ projectId });
  });
  it("coalesces paid task creation and rejects prompt changes under the same key", async () => {
    await login(); const call = pending(); const first = controller.createGenerationJob("A tent", requestId); await call.ready();
    const second = controller.createGenerationJob("A tent", requestId);
    await expect(controller.createGenerationJob("A lamp", requestId)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    call.finish(job(), 202); await first; await second; expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("does not turn unsupported or failed generation into a success", async () => {
    await login(); queue({ error: { code: "BILLING_NOT_CONFIGURED" } }, 503);
    await expect(controller.createGenerationJob("A tent", requestId)).rejects.toMatchObject({ code: "BILLING_NOT_CONFIGURED" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    queue(job({ state: "submit_unknown", error_code: "SUBMIT_RESULT_UNKNOWN" }));
    await expect(controller.getGenerationJob(proposalId)).resolves.toMatchObject({ state: "submit_unknown", asset_id: null });
    await vi.advanceTimersByTimeAsync(60_000); expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("reuses the same paid request key for an explicit retry after an unknown response", async () => {
    await login(); fetchMock.mockRejectedValueOnce(new TypeError("connection reset"));
    await expect(controller.createGenerationJob("A tent", requestId)).rejects.toThrow("connection reset");
    queue(job({ reused: true }));
    await expect(controller.createGenerationJob("A tent", requestId)).resolves.toMatchObject({ reused: true });
    expect(body(1)).toEqual(body(2));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("rejects malformed ready jobs without an asset instead of fabricating a model", async () => {
    await login(); queue(job({ state: "ready", asset_id: null }));
    await expect(controller.getGenerationJob(proposalId)).rejects.toThrow();
  });
});
