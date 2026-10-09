// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement, StrictMode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backendSceneToLayout } from "../components/room-organizer/lib/backend-adapter";
import { BackendSession, getBackendConfig, useBackendSession, type Scene } from "./backend-session";
import { geometryWorkbenchBindingKey, type GeometryWorkbenchBinding } from "./geometry-workbench-binding";

const bindingStore = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  read: vi.fn<(key: unknown) => Promise<unknown>>(),
  update: vi.fn<(key: unknown, update: (value: unknown) => unknown) => Promise<unknown>>(),
}));
vi.mock("./source-storage", () => ({ readSourceRecord: bindingStore.read, updateSourceForm: bindingStore.update }));

const projectId = "10000000-0000-4000-8000-000000000001";
const studioId = "20000000-0000-4000-8000-000000000001";
const base = "https://example.supabase.co";
const scene: Scene = { schemaVersion: 1, venue: { width: 12, depth: 10, height: 3, shape: "rectangle", entrances: [] }, objects: [], camera: "overview", lighting: "neutral" };
const project = { id: projectId, studio_id: studioId, name: "活动布置", revision: 4, scene };
const auth = { access_token: "access-test-only", refresh_token: "refresh-test-only", expires_in: 3600, user: { id: "user-a", email: "test@example.com" } };
const assetId = "60000000-0000-4000-8000-000000000001";
const assetScene: Scene = { ...scene, objects: [{ id: "50000000-0000-4000-8000-000000000001", materialId: "asset", assetId, position: { x: 2, z: 3 }, rotation: 0, size: { width: 1, depth: 1, height: 1 }, color: "#ffffff", locked: false, notes: "" }] };
const authorizedAsset = { id: assetId, name: "公共模型椅子", format: "glb", url: `${base}/storage/v1/object/sign/scene-assets/chair.glb?token=temporary-test`, expiresIn: 300, metadata: { sourceSize: { width: 1, depth: 1, height: 1 }, groundOffset: [0, 0, 0] } };
const mockFetch = vi.fn<typeof fetch>();
const sessions: BackendSession[] = [];
function browserStorage(): Storage {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, clear: () => values.clear(),
    getItem: key => values.get(String(key)) ?? null, key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(String(key)); }, setItem: (key, value) => { values.set(String(key), String(value)); } };
}

function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
function queue(body: unknown, status = 200) { mockFetch.mockResolvedValueOnce(response(body, status)); }
function session() {
  const controller = new BackendSession(getBackendConfig({ url: base, anonKey: "sb_publishable_test" }));
  sessions.push(controller);
  return controller;
}
function request(index: number) {
  const call = mockFetch.mock.calls[index]!;
  return { url: String(call[0]), options: call[1]!, body: call[1]?.body ? JSON.parse(String(call[1].body)) : null };
}
async function editing() {
  const controller = session();
  queue(auth);
  await controller.signIn("test@example.com", "password-test-only");
  queue(project);
  await controller.getProject(projectId);
  queue({ sessionId: controller.getSnapshot().sessionId, generation: 3, expiresAt: new Date(Date.now() + 90_000).toISOString(), revision: 4, scene });
  await controller.acquireLease(projectId);
  return controller;
}

beforeEach(() => {
  const local = browserStorage(), tab = browserStorage();
  vi.stubGlobal("localStorage", local);vi.stubGlobal("sessionStorage", tab);
  Object.defineProperty(window, "localStorage", { configurable: true, value: local });
  Object.defineProperty(window, "sessionStorage", { configurable: true, value: tab });
  sessionStorage.clear(); localStorage.clear();
  bindingStore.values.clear();
  bindingStore.read.mockReset().mockImplementation(async key => bindingStore.values.get(JSON.stringify(key)));
  bindingStore.update.mockReset().mockImplementation(async (key, update) => {
    const storedKey = JSON.stringify(key), value = structuredClone(update(bindingStore.values.get(storedKey)));
    bindingStore.values.set(storedKey, value); return value;
  });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-02T08:00:00Z"));
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});
afterEach(() => {
  cleanup();
  for (const controller of sessions.splice(0)) controller.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("local activity geometry bindings", () => {
  const localId = "house-local-activity";
  const otherId = "10000000-0000-4000-8000-000000000002";
  const studio = { id: studioId, name: "工作室", role: "owner", displayName: "负责人" };
  const mapping = (id = localId, cloudProjectId = projectId, userId = auth.user.id, apiUrl = `${base}/functions/v1/scene-api`): GeometryWorkbenchBinding =>
    ({ version: 1, localActivityId: id, cloudProjectId, userId, apiUrl });
  function stored(binding: GeometryWorkbenchBinding): void {
    bindingStore.values.set(JSON.stringify(geometryWorkbenchBindingKey(binding)), binding);
  }
  async function login(controller: BackendSession, value = auth): Promise<void> {
    queue(value); await controller.signIn(value.user.email, "test-password-only");
  }
  function grant(controller: BackendSession, generation = 1, currentScene = scene) {
    return { sessionId: controller.getSnapshot().sessionId, generation, expiresAt: new Date(Date.now() + 90_000).toISOString(), revision: 4, scene: currentScene };
  }
  async function bind(controller: BackendSession, id = localId, remote = project): Promise<void> {
    queue([studio]); queue(remote); queue(grant(controller));
    await controller.ensureGeometryWorkbenchReady(scene, "本地活动", id);
  }
  const creates = () => mockFetch.mock.calls.filter(call => String(call[0]).endsWith("/scene-api/projects") && call[1]?.method === "POST");

  it("keeps the local ID distinct and persists only the authenticated identity mapping", async () => {
    const controller = session(); await login(controller);
    await bind(controller, projectId, { ...project, id: otherId });
    expect(controller.isGeometryBound(projectId)).toBe(true);
    expect(controller.isGeometryBound(otherId)).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ geometryBinding: mapping(projectId, otherId), project: { id: otherId }, writeBlocked: false });
    expect([...bindingStore.values.values()]).toEqual([mapping(projectId, otherId)]);
    expect(JSON.stringify([...bindingStore.values.values()])).not.toMatch(/access|refresh|lease|sessionId|generation/);
    expect(creates()).toHaveLength(1);
    expect(JSON.parse(String(creates()[0]![1]!.body))).toEqual({ studioId, name: "本地活动", scene });
  });

  it("deduplicates first-time preparation even after guest authentication becomes visible", async () => {
    const controller = session();queue({ ...auth, user: { id: "guest-a", is_anonymous: true } });
    let finish!: (value: Response) => void;
    mockFetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    queue(project);queue(grant(controller));
    const first = controller.ensureGeometryWorkbenchReady(scene, "本地活动", localId);
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(controller.getSnapshot().user?.id).toBe("guest-a");
    const second = controller.ensureGeometryWorkbenchReady(scene, "本地活动", localId);
    finish(response([studio]));expect(await first).toEqual(await second);
    expect(creates()).toHaveLength(1);expect(controller.isGeometryBound(localId)).toBe(true);
  });

  it("resumes a reopened activity with a fresh lease without creating or dispatching a task", async () => {
    const first = session(); await login(first); await bind(first);first.dispose();
    const reopened = session(); await login(reopened);
    const changed = { ...scene, lighting: "cool" as const };
    queue(project); queue(grant(reopened, 8));
    const result = await reopened.resumeGeometryWorkbench(changed, "本地活动", localId);
    expect(result?.id).toBe(projectId);expect(reopened.isGeometryBound(localId)).toBe(true);
    expect(reopened.getSnapshot()).toMatchObject({ draft: changed, dirty: true, lease: { generation: 8 } });
    expect(reopened.getSnapshot().sessionId).not.toBe(first.getSnapshot().sessionId);
    expect(creates()).toHaveLength(1);
    expect(mockFetch.mock.calls.some(call => String(call[0]).includes("agent-runs"))).toBe(false);
  });

  it("requires authentication for resume and returns null for an absent mapping without creating anything", async () => {
    const controller = session();
    await expect(controller.resumeGeometryWorkbench(scene, "本地活动", localId)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(mockFetch).not.toHaveBeenCalled();
    await login(controller);const calls = mockFetch.mock.calls.length;
    expect(await controller.resumeGeometryWorkbench(scene, "本地活动", localId)).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(calls);expect(bindingStore.update).not.toHaveBeenCalled();
  });

  it.each(["invalid", "unreadable"] as const)("does not create a replacement for a %s mapping", async reason => {
    const controller = session();await login(controller);
    if (reason === "invalid") bindingStore.values.set(JSON.stringify(geometryWorkbenchBindingKey(mapping())), { ...mapping(), userId: "wrong-user" });
    else bindingStore.read.mockRejectedValueOnce(new Error("storage unavailable"));
    const calls = mockFetch.mock.calls.length;
    await expect(controller.ensureGeometryWorkbenchReady(scene, "本地活动", localId)).rejects.toMatchObject({
      code: reason === "invalid" ? "GEOMETRY_BINDING_INVALID" : "GEOMETRY_BINDING_READ_FAILED",
    });
    expect(mockFetch).toHaveBeenCalledTimes(calls);expect(creates()).toHaveLength(0);
    expect(controller.getSnapshot().draft).toEqual(scene);
  });

  it.each([403, 404])("retains a mapped project rejected with %s and never creates another", async status => {
    const controller = session();await login(controller);stored(mapping());
    queue({ error: { code: status === 403 ? "FORBIDDEN" : "PROJECT_NOT_FOUND", details: {} } }, status);
    await expect(controller.ensureGeometryWorkbenchReady(scene, "本地活动", localId)).rejects.toMatchObject({ status });
    expect([...bindingStore.values.values()]).toEqual([mapping()]);expect(creates()).toHaveLength(0);
    queue({ error: { code: "FORBIDDEN", details: {} } }, 403);
    await expect(controller.ensureGeometryWorkbenchReady(scene, "本地活动", localId)).rejects.toMatchObject({ status: 403 });
    expect(creates()).toHaveLength(0);
  });

  it("remembers a newly created mirror after binding persistence fails and retries that same project", async () => {
    const controller = session();await login(controller);
    bindingStore.update.mockRejectedValueOnce(new Error("write refused"));
    queue([studio]);queue(project);
    await expect(controller.ensureGeometryWorkbenchReady(scene, "本地活动", localId)).rejects.toMatchObject({ code: "GEOMETRY_BINDING_WRITE_FAILED" });
    expect(controller.getSnapshot()).toMatchObject({ project, geometryBinding: mapping(), writeBlocked: true, error: { code: "GEOMETRY_BINDING_WRITE_FAILED" } });
    queue(grant(controller));await controller.ensureGeometryWorkbenchReady(scene, "本地活动", localId);
    expect(creates()).toHaveLength(1);expect([...bindingStore.values.values()]).toEqual([mapping()]);
    expect(controller.getSnapshot().writeBlocked).toBe(false);
  });

  it("disconnects even a blocked live mirror lease while preserving draft and the mapping", async () => {
    const controller = session();await login(controller);await bind(controller);
    queue({ error: { code: "LEASE_LOST", details: {} } }, 409);
    await expect(controller.saveScene(assetScene)).rejects.toMatchObject({ code: "LEASE_LOST" });
    expect(controller.isGeometryBound(localId)).toBe(true);
    queue({});await controller.disconnectGeometryWorkbench();
    expect(controller.getSnapshot()).toMatchObject({ geometryBinding: null, project: null, lease: null, draft: assetScene });
    expect([...bindingStore.values.values()]).toEqual([mapping()]);
    queue(project);queue(grant(controller, 5));
    await controller.resumeGeometryWorkbench(assetScene, "本地活动", localId);
    expect(controller.isGeometryBound(localId)).toBe(true);expect(creates()).toHaveLength(1);
  });

  it("keeps binding identity valid after lease expiry while AI writes remain blocked", async () => {
    const controller = session();await login(controller);await bind(controller);
    vi.setSystemTime(new Date(Date.now() + 100_000));
    await expect(controller.saveScene(scene)).rejects.toMatchObject({ code: "LEASE_LOST" });
    expect(controller.isGeometryBound(localId)).toBe(true);expect(controller.getSnapshot().writeBlocked).toBe(true);
  });

  it("isolates accounts and API endpoints, clearing only geometry cloud context on account changes", async () => {
    const controller = session();await login(controller);await bind(controller);
    await login(controller, { ...auth, user: { id: "user-b", email: "other@example.com" } });
    expect(controller.getSnapshot()).toMatchObject({ project: null, geometryBinding: null, lease: null, draft: scene });
    expect(await controller.resumeGeometryWorkbench(scene, "本地活动", localId)).toBeNull();
    expect(creates()).toHaveLength(1);
    const other = new BackendSession(getBackendConfig({ url: "https://other.supabase.co", anonKey: "sb_publishable_test" }));sessions.push(other);await login(other);
    expect(await other.resumeGeometryWorkbench(scene, "本地活动", localId)).toBeNull();
    expect(creates()).toHaveLength(1);expect([...bindingStore.values.values()]).toEqual([mapping()]);
  });

  it("clears a geometry project on sign-out or revoked auth without changing ordinary cloud sign-out", async () => {
    const controller = session();await login(controller);await bind(controller);
    queue({});queue({});await controller.signOut();
    expect(controller.getSnapshot()).toMatchObject({ project: null, geometryBinding: null, lease: null, user: null, draft: scene });
    expect([...bindingStore.values.values()]).toEqual([mapping()]);
    await login(controller);queue(project);queue(grant(controller));await controller.resumeGeometryWorkbench(scene, "本地活动", localId);
    queue({ error: { code: "UNAUTHENTICATED", details: {} } }, 401);
    await expect(controller.listStudios()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(controller.getSnapshot()).toMatchObject({ project: null, geometryBinding: null, user: null, draft: scene });
    const ordinary = await editing();queue({});queue({});await ordinary.signOut();
    expect(ordinary.getSnapshot().project?.id).toBe(projectId);
  });

  it("switches local activities using each saved mapping without reusing another activity's mirror", async () => {
    const controller = session();await login(controller);await bind(controller);
    queue({});queue([studio]);queue({ ...project, id: otherId });queue(grant(controller, 2));
    await controller.ensureGeometryWorkbenchReady(scene, "另一个本地活动", "house-other-activity");
    expect(controller.isGeometryBound(localId)).toBe(false);expect(controller.isGeometryBound("house-other-activity")).toBe(true);
    queue({});queue(project);queue(grant(controller, 3));
    await controller.resumeGeometryWorkbench(scene, "本地活动", localId);
    expect(controller.isGeometryBound(localId)).toBe(true);expect(creates()).toHaveLength(2);
  });

  it("leaves geometry mode for an ordinary project or ordinary workbench request", async () => {
    const controller = session();await login(controller);await bind(controller);
    queue({});await controller.releaseLease();queue({ ...project, id: otherId });
    await controller.getProject(otherId);
    expect(controller.getSnapshot().geometryBinding).toBeNull();expect(controller.isGeometryBound(localId)).toBe(false);
    queue(grant(controller));await controller.ensureWorkbenchReady(scene, "完整云方案", otherId);
    expect(controller.getSnapshot().geometryBinding).toBeNull();expect(controller.getSnapshot().project?.id).toBe(otherId);
    expect([...bindingStore.values.values()]).toEqual([mapping()]);
  });

  it.each(["open", "create", "prepare"] as const)("keeps the geometry workspace accessible after an ordinary %s fails", async action => {
    const controller = session();await login(controller);await bind(controller);
    queue({});await controller.releaseLease();
    const draft = { ...scene, lighting: "cool" as const };controller.setDraft(draft);
    if (action === "prepare") queue([studio]);
    queue({ error: { code: "FORBIDDEN", details: {} } }, 403);
    const failed = action === "open" ? controller.getProject(otherId) : action === "create"
      ? controller.createProject(studioId, "完整云项目", scene) : controller.ensureWorkbenchReady(scene, "完整云项目", "new-full-project");
    await expect(failed).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(controller.getSnapshot()).toMatchObject({ geometryBinding: mapping(), project: { id: projectId }, draft, writeBlocked: true });
    expect(controller.isGeometryBound(localId)).toBe(true);expect([...bindingStore.values.values()]).toEqual([mapping()]);
  });

  it("can explicitly resume the same saved mirror after it was opened as a complete cloud project", async () => {
    const controller = session();await login(controller);await bind(controller);
    queue({});await controller.releaseLease();queue(project);await controller.getProject(projectId);
    queue(grant(controller, 2));await controller.acquireLease(projectId);
    expect(controller.isGeometryBound(localId)).toBe(false);
    const calls = mockFetch.mock.calls.length;
    await controller.resumeGeometryWorkbench(scene, "本地活动", localId);
    expect(controller.isGeometryBound(localId)).toBe(true);expect(mockFetch).toHaveBeenCalledTimes(calls);
  });

  it.each(["create", "acquire", "prepare"] as const)("exits projection mode only after an ordinary %s succeeds", async action => {
    const controller = session();await login(controller);await bind(controller);
    if (action !== "prepare") { queue({});await controller.releaseLease(); }
    if (action === "create") { queue({ ...project, id: otherId });await controller.createProject(studioId, "完整云项目", scene); }
    else if (action === "acquire") { queue(grant(controller, 2));await controller.acquireLease(projectId); }
    else await controller.ensureWorkbenchReady(scene, "完整云项目", projectId);
    expect(controller.getSnapshot().geometryBinding).toBeNull();expect(controller.isGeometryBound(localId)).toBe(false);
    expect(controller.getSnapshot().project?.id).toBe(action === "create" ? otherId : projectId);
    expect([...bindingStore.values.values()]).toEqual([mapping()]);
  });

  it("rejects an old binding read after another complete project was selected", async () => {
    const controller = session();await login(controller);
    let finish!: (value: unknown) => void;
    bindingStore.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = controller.resumeGeometryWorkbench(scene, "本地活动", localId);void pending.catch(() => {});
    queue({ ...project, id: otherId });await controller.getProject(otherId);finish(mapping());
    await expect(pending).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(controller.getSnapshot()).toMatchObject({ project: { id: otherId }, geometryBinding: null, error: null });
    expect(creates()).toHaveLength(0);
  });

  it("does not let a late mapped-project response restore a disconnected geometry context", async () => {
    const controller = session();await login(controller);stored(mapping());
    let finish!: (value: Response) => void;
    mockFetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = controller.resumeGeometryWorkbench(scene, "本地活动", localId);void pending.catch(() => {});
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    await expect(controller.disconnectGeometryWorkbench()).rejects.toMatchObject({ code: "CLOUD_OPERATION_BUSY" });
    finish(response(project));await expect(pending).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(controller.getSnapshot()).toMatchObject({ project: null, geometryBinding: null, lease: null, error: null });
  });

  it("releases a late acquired geometry grant without committing it after disconnect", async () => {
    const controller = session();await login(controller);stored(mapping());queue(project);
    let finish!: (value: Response) => void;
    mockFetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = controller.resumeGeometryWorkbench(scene, "本地活动", localId);void pending.catch(() => {});
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
    await expect(controller.disconnectGeometryWorkbench()).rejects.toMatchObject({ code: "CLOUD_OPERATION_BUSY" });
    queue({});finish(response(grant(controller, 7)));
    await expect(pending).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(request(3)).toMatchObject({ url: `${base}/functions/v1/scene-api/projects/${projectId}/lease/release`, body: { sessionId: controller.getSnapshot().sessionId, generation: 7 } });
    expect(controller.getSnapshot()).toMatchObject({ lease: null, error: null });
    await controller.disconnectGeometryWorkbench();expect(controller.getSnapshot().project).toBeNull();
  });

  it("preserves local edits made during binding reads and remote lease acquisition", async () => {
    const controller = session();await login(controller);stored(mapping());
    let read!: (value: unknown) => void, finish!: (value: Response) => void;
    bindingStore.read.mockImplementationOnce(() => new Promise(resolve => { read = resolve; }));
    queue(project);mockFetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = controller.resumeGeometryWorkbench(scene, "本地活动", localId);
    const firstEdit = { ...scene, lighting: "cool" as const };controller.setDraft(firstEdit);read(mapping());
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
    const later = { ...scene, lighting: "warm" as const };controller.setDraft(later);
    finish(response(grant(controller)));await pending;
    expect(controller.getSnapshot()).toMatchObject({ draft: later, dirty: true, writeBlocked: false });
  });
});

describe("backend session contract", () => {
  it("shares a verified guest session through cookies and keeps a fresh lease identity", async () => {
    const config=getBackendConfig({url:base,anonKey:'sb_publishable_test'});
    const guest={id:'guest-a',is_anonymous:true};
    const first=new BackendSession(config);sessions.push(first);
    queue({...auth,access_token:'guest-access-test',refresh_token:'guest-refresh-test',user:guest});
    await first.signInAsGuest();
    const originalSessionId=first.getSnapshot().sessionId;
    expect(document.cookie).toContain('sb-example-auth-token');
    first.dispose();mockFetch.mockClear();
    const reopened=new BackendSession(config);sessions.push(reopened);
    queue(guest);await reopened.restoreSession();
    expect(request(0).url).toBe(`${base}/auth/v1/user`);
    expect(reopened.getSnapshot()).toMatchObject({user:guest,lease:null,project:null,writeBlocked:true});
    expect(reopened.getSnapshot().sessionId).not.toBe(originalSessionId);
    queue(authorizedAsset);await reopened.authorizeAsset(assetId);
    expect(request(1).options.headers).toMatchObject({Authorization:'Bearer guest-access-test'});
  });

  it("shares an account cookie across controllers and clears it on explicit sign-out", async () => {
    const config=getBackendConfig({url:base,anonKey:'sb_publishable_test'});
    const account=new BackendSession(config);sessions.push(account);
    queue(auth);await account.signIn('test@example.com','password-test-only');
    const reopened=new BackendSession(config);sessions.push(reopened);
    queue(auth.user);await reopened.restoreSession();
    expect(reopened.getSnapshot().user).toEqual(auth.user);
    queue({});await reopened.signOut();
    expect(document.cookie).not.toContain('sb-example-auth-token');
    expect(reopened.getSnapshot().user).toBeNull();
  });

  it("rejects a revoked cookie session after server verification", async () => {
    const config=getBackendConfig({url:base,anonKey:'sb_publishable_test'});
    const first=new BackendSession(config);sessions.push(first);
    queue(auth);await first.signIn('test@example.com','password-test-only');
    mockFetch.mockClear();
    const reopened=new BackendSession(config);sessions.push(reopened);
    queue({message:'invalid token'},401);await reopened.restoreSession();
    expect(request(0).url).toBe(`${base}/auth/v1/user`);
    expect(reopened.getSnapshot()).toMatchObject({user:null,writeBlocked:true});
  });

  it("prepares a real guest workspace and lease from the current local scene in one action", async () => {
    const controller = session();
    queue({ ...auth, user: { id: 'guest-a', is_anonymous: true } });
    queue([]);
    queue({ id: studioId, name: '我的工作室', role: 'owner', displayName: '访客' });
    queue(project);
    queue({ sessionId: controller.getSnapshot().sessionId, generation: 1, expiresAt: new Date(Date.now() + 90_000).toISOString(), revision: 4, scene });
    const first = controller.ensureWorkbenchReady(scene, '本地草稿', 'local-layout');
    const second = controller.ensureWorkbenchReady(scene, '本地草稿', 'local-layout');
    expect(await first).toEqual(await second);
    expect(request(0)).toMatchObject({ url: `${base}/auth/v1/signup`, body: { data: { display_name: '访客' } } });
    expect(request(3)).toMatchObject({ body: { studioId, name: '本地草稿', scene } });
    expect(controller.getSnapshot()).toMatchObject({ user: { id: 'guest-a' }, project, draft: scene, writeBlocked: false });
    await controller.ensureWorkbenchReady(scene, '本地草稿', projectId);
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it("keeps local edits while automatically reacquiring the existing project's lease", async () => {
    const controller = await editing();
    queue({ released: true }); await controller.releaseLease();
    const changed = { ...scene, lighting: 'cool' as const };
    queue({ sessionId: controller.getSnapshot().sessionId, generation: 4, expiresAt: new Date(Date.now() + 90_000).toISOString(), revision: 4, scene });
    await controller.ensureWorkbenchReady(changed, '本地草稿', projectId);
    expect(controller.getSnapshot()).toMatchObject({ draft: changed, dirty: true, writeBlocked: false });
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it("preserves local draft when guest startup fails and never starts an AI request", async () => {
    const controller = session();
    controller.setDraft(assetScene);
    queue({ error_code: 'anonymous_provider_disabled' }, 422);
    await expect(controller.ensureWorkbenchReady(assetScene, '草稿', 'local-layout')).rejects.toThrow();
    expect(controller.getSnapshot()).toMatchObject({ user: null, draft: assetScene, dirty: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("deletes the idle bound project while preserving its local draft", async () => {
    const controller = session(); queue(auth); await controller.signIn('test@example.com', 'test');
    queue(project); await controller.getProject(projectId);
    controller.setDraft(assetScene);
    const draft = controller.getSnapshot().draft;
    queue({ deleted: true }); await controller.deleteProject(projectId, 4);
    expect(request(2)).toMatchObject({ options: { method: 'DELETE' }, body: { expectedRevision: 4 } });
    expect(controller.getSnapshot()).toMatchObject({ project: null, revision: null, draft, writeBlocked: true, dirty: true });
  });

  it("does not remove the bound project on a failed deletion or bypass a held lease", async () => {
    const controller = await editing();
    await expect(controller.deleteProject(projectId, 4)).rejects.toMatchObject({ code: 'PROJECT_SWITCH_REQUIRES_RELEASE' });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    queue({ released: true }); await controller.releaseLease();
    queue({ error: { code: 'PROJECT_BUSY' } }, 429);
    await expect(controller.deleteProject(projectId, 4)).rejects.toMatchObject({ code: 'PROJECT_BUSY' });
    expect(controller.getSnapshot().project?.id).toBe(projectId);
  });
  it("requires public configuration and rejects secrets before any request", async () => {
    expect(getBackendConfig({ url: "", anonKey: "" }).configured).toBe(false);
    expect(getBackendConfig({ url: base, anonKey: "sb_secret_do-not-use" }).configured).toBe(false);
    expect(getBackendConfig({ url: "http://outside.example", anonKey: "public" }).configured).toBe(false);
    expect(getBackendConfig({ url: "http://127.0.0.1:54321", anonKey: "public" }).configured).toBe(true);
    const jwt = `a.${btoa(JSON.stringify({ role: "service_role" }))}.b`;
    expect(getBackendConfig({ url: base, anonKey: jwt }).configured).toBe(false);
    const controller = new BackendSession(getBackendConfig({ url: "", anonKey: "" }));
    sessions.push(controller);
    await expect(controller.signIn("x", "y")).rejects.toMatchObject({ code: "CONFIGURATION_MISSING" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("signs in through Auth REST and uses only the access token for business requests", async () => {
    const controller = session();
    queue(auth);
    await controller.signIn(" test@example.com ", "password-test-only");
    expect(request(0)).toMatchObject({ url: `${base}/auth/v1/token?grant_type=password`, body: { email: "test@example.com", password: "password-test-only" }, options: { method: "POST", headers: { apikey: "sb_publishable_test" } } });
    queue([{ id: studioId, name: "工作室", role: "owner", displayName: "A" }]);
    await controller.listStudios();
    queue([project]);
    await controller.listProjects();
    expect(request(1)).toMatchObject({ url: `${base}/functions/v1/scene-api/studios`, options: { method: "GET", headers: { Authorization: `Bearer ${auth.access_token}` } } });
    expect(request(2).url).toBe(`${base}/functions/v1/scene-api/projects`);
    expect(JSON.stringify(controller.getSnapshot())).not.toContain("test-only");
    expect(controller.getSnapshot().user?.email).toBe("test@example.com");
  });

  it("creates and loads projects with the exact v1 scene structure", async () => {
    const controller = session();
    queue(auth);
    await controller.signIn("test@example.com", "pass");
    queue(project, 201);
    await controller.createProject(studioId, project.name, scene);
    expect(request(1)).toMatchObject({ url: `${base}/functions/v1/scene-api/projects`, options: { method: "POST" }, body: { studioId, name: project.name, scene } });
    queue(project);
    await controller.getProject(projectId);
    expect(request(2)).toMatchObject({ url: `${base}/functions/v1/scene-api/projects/${projectId}`, options: { method: "GET" } });
    expect(controller.getSnapshot()).toMatchObject({ project, draft: scene, revision: 4, writeBlocked: true, dirty: false });
  });

  it("uses a distinct editor session per controller and sends lease/save/handoff fields", async () => {
    const controller = await editing();
    expect(controller.getSnapshot().sessionId).not.toBe(session().getSnapshot().sessionId);
    const sessionId = controller.getSnapshot().sessionId;
    expect(request(2)).toMatchObject({ url: `${base}/functions/v1/scene-api/projects/${projectId}/lease/acquire`, body: { sessionId }, options: { method: "POST" } });
    queue({ sessionId, generation: 3, expiresAt: new Date(Date.now() + 120_000).toISOString(), revision: 4 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(request(3)).toMatchObject({ url: `${base}/functions/v1/scene-api/projects/${projectId}/lease/renew`, body: { sessionId, generation: 3 }, options: { method: "POST" } });
    const changed = { ...scene, lighting: "warm" as const };
    queue({ id: projectId, revision: 8, scene: changed, updatedAt: new Date().toISOString(), warnings: [] });
    await controller.saveScene(changed);
    expect(request(4)).toMatchObject({ url: `${base}/functions/v1/scene-api/projects/${projectId}/scene`, options: { method: "PUT" }, body: { sessionId, generation: 3, expectedRevision: 4, scene: changed } });
    expect(Object.keys(request(4).body).sort()).toEqual(["expectedRevision", "generation", "scene", "sessionId"]);
    expect(controller.getSnapshot()).toMatchObject({ revision: 8, dirty: false, draft: changed });
    queue({ sessionId, generation: 3, expiresAt: new Date().toISOString(), revision: 8 });
    await controller.releaseLease();
    expect(request(5)).toMatchObject({ url: `${base}/functions/v1/scene-api/projects/${projectId}/lease/release`, body: { sessionId, generation: 3 }, options: { method: "POST" } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockFetch).toHaveBeenCalledTimes(6);
    expect(controller.getSnapshot()).toMatchObject({ lease: null, writeBlocked: true, revision: 8, draft: changed });
  });

  it.each([[409, "REVISION_CONFLICT"], [409, "LEASE_LOST"], [401, "UNAUTHENTICATED"]])("preserves draft on %s %s and blocks further writes", async (status, code) => {
    const controller = await editing();
    const changed = { ...scene, lighting: "cool" as const };
    queue({ error: { code, details: {} } }, status);
    await expect(controller.saveScene(changed)).rejects.toMatchObject({ code, status });
    expect(controller.getSnapshot()).toMatchObject({ draft: changed, dirty: true, revision: 4, project, status: "blocked", writeBlocked: true, error: { code, status } });
    await expect(controller.saveScene(changed)).rejects.toMatchObject({ code: "CLOUD_WRITE_BLOCKED" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("preserves the draft and does not retry after an uncertain network save", async () => {
    const controller = await editing();
    const changed = { ...scene, camera: "top" as const };
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(controller.saveScene(changed)).rejects.toThrow("Failed to fetch");
    expect(controller.getSnapshot()).toMatchObject({ draft: changed, revision: 4, writeBlocked: true, error: { code: "NETWORK_ERROR" } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("keeps edits made during a pending save as an unsaved local draft", async () => {
    const controller = await editing();
    const submitted = { ...scene, lighting: "warm" as const };
    const later = { ...submitted, camera: "top" as const };
    let finish!: (value: Response) => void;
    mockFetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const saving = controller.saveScene(submitted);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    controller.setDraft(later);
    finish(response({ id: projectId, revision: 5, scene: submitted, updatedAt: new Date().toISOString(), warnings: [] }));
    await saving;
    expect(controller.getSnapshot()).toMatchObject({ draft: later, dirty: true, revision: 5, project: { scene: submitted } });
  });

  it("rejects an expired lease locally without sending another save", async () => {
    const controller = await editing();
    vi.setSystemTime(new Date(Date.now() + 91_000));
    await expect(controller.saveScene(scene)).rejects.toMatchObject({ code: "LEASE_LOST" });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot()).toMatchObject({ dirty: true, writeBlocked: true, error: { code: "LEASE_LOST" } });
  });

  it("survives the StrictMode effect cleanup/setup and disposes only on real unmount", async () => {
    const controller = await editing();
    function Probe() {
      const state = useBackendSession(controller);
      useEffect(() => controller.retain(), []);
      return createElement("output", { "data-testid": "session" }, `${state.user?.email ?? "signed out"}/${state.status}`);
    }
    let rendered!: ReturnType<typeof render>;
    await act(async () => { rendered = render(createElement(StrictMode, null, createElement(Probe))); });
    expect(screen.getByTestId("session").textContent).toBe("test@example.com/editing");
    const lease = controller.getSnapshot().lease!;
    queue({ sessionId: lease.sessionId, generation: lease.generation, revision: 4, expiresAt: new Date(Date.now() + 120_000).toISOString() });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(mockFetch).toHaveBeenCalledTimes(4);
    await act(async () => { rendered.unmount(); });
    expect(controller.getSnapshot()).toMatchObject({ user: null, lease: null, writeBlocked: true, draft: scene });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("keeps the original project and canvas draft when the editor rejects another project", async () => {
    const controller = session();
    queue(auth);
    await controller.signIn("test@example.com", "pass");
    queue(project);
    await controller.getProject(projectId);
    const local = { ...scene, lighting: "warm" as const };
    controller.setDraft(local);
    const polygon: Scene = { ...scene, venue: { ...scene.venue, shape: "polygon", polygon: [{ x: 0, z: 0 }, { x: 12, z: 0 }, { x: 12, z: 10 }] } };
    const otherId = "10000000-0000-4000-8000-000000000002";
    queue({ ...project, id: otherId, scene: polygon });
    await expect(controller.getProject(otherId, incoming => { backendSceneToLayout(incoming.scene); })).rejects.toMatchObject({ code: "POLYGON_NOT_SUPPORTED" });
    expect(controller.getSnapshot()).toMatchObject({ project, draft: local, revision: 4, dirty: true, writeBlocked: true, error: { code: "POLYGON_NOT_SUPPORTED" } });
    await expect(controller.saveScene(local)).rejects.toMatchObject({ code: "CLOUD_WRITE_BLOCKED" });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("releases a just-acquired unsupported cloud scene without replacing the original draft", async () => {
    const controller = session();
    queue(auth);
    await controller.signIn("test@example.com", "pass");
    queue(project);
    await controller.getProject(projectId);
    const local = { ...scene, camera: "top" as const };
    controller.setDraft(local);
    const unsupported: Scene = { ...scene, venue: { ...scene.venue, floorplanAssetId: "30000000-0000-4000-8000-000000000001" } };
    const sessionId = controller.getSnapshot().sessionId;
    queue({ sessionId, generation: 5, expiresAt: new Date(Date.now() + 90_000).toISOString(), revision: 9, scene: unsupported });
    queue({ sessionId, generation: 5, expiresAt: new Date().toISOString(), revision: 9 });
    await expect(controller.acquireLease(projectId, incoming => { backendSceneToLayout(incoming); })).rejects.toMatchObject({ code: "FLOORPLAN_NOT_SUPPORTED" });
    expect(request(3)).toMatchObject({ url: `${base}/functions/v1/scene-api/projects/${projectId}/lease/release`, body: { sessionId, generation: 5 }, options: { method: "POST" } });
    expect(controller.getSnapshot()).toMatchObject({ project, draft: local, revision: 4, dirty: true, writeBlocked: true, error: { code: "FLOORPLAN_NOT_SUPPORTED" } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("does not clear a lost-lease warning when a concurrent save response arrives", async () => {
    const controller = await editing();
    let finishRenew!: (value: Response) => void;
    let finishSave!: (value: Response) => void;
    mockFetch.mockImplementationOnce(() => new Promise(resolve => { finishRenew = resolve; }));
    const renewing = controller.renewLease().catch(error => error);
    await vi.waitFor(() => expect(finishRenew).toBeTypeOf("function"));
    mockFetch.mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }));
    const saving = controller.saveScene(scene);
    await vi.waitFor(() => expect(finishSave).toBeTypeOf("function"));
    finishRenew(response({ error: { code: "LEASE_LOST" } }, 409));
    await renewing;
    finishSave(response({ id: projectId, revision: 5, scene, updatedAt: new Date().toISOString(), warnings: [] }));
    await saving;
    expect(controller.getSnapshot()).toMatchObject({ revision: 5, status: "blocked", writeBlocked: true, error: { code: "LEASE_LOST" } });
    await expect(controller.saveScene(scene)).rejects.toMatchObject({ code: "CLOUD_WRITE_BLOCKED" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it("authorizes each referenced asset once without fetching floorplans or persisting signed URLs", async () => {
    const controller = session();
    queue(auth);
    await controller.signIn("test@example.com", "pass");
    const duplicate: Scene = { ...assetScene, venue: { ...scene.venue, floorplanAssetId: "70000000-0000-4000-8000-000000000001" }, objects: [...assetScene.objects, { ...assetScene.objects[0]!, id: "50000000-0000-4000-8000-000000000002" }] };
    controller.setDraft(duplicate);
    queue(authorizedAsset);
    await expect(controller.authorizeAssets(duplicate)).resolves.toEqual({ assetUrls: { [assetId]: authorizedAsset.url }, assetNames: { [assetId]: authorizedAsset.name } });
    expect(request(1)).toMatchObject({ url: `${base}/functions/v1/scene-api/assets/${assetId}/url`, options: { method: "POST", headers: { Authorization: `Bearer ${auth.access_token}` } }, body: null });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().draft).toEqual(duplicate);
    expect(JSON.stringify(controller.getSnapshot())).not.toContain("temporary-test");
  });

  it("requires no asset request for an entirely builtin scene", async () => {
    await expect(session().authorizeAssets(scene)).resolves.toEqual({ assetUrls: {}, assetNames: {} });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("accepts a local HTTP signed asset URL", async () => {
    const controller = session();
    queue(auth);
    await controller.signIn("test@example.com", "pass");
    const url = "http://127.0.0.1:54321/storage/v1/object/sign/assets/test.glb?token=test";
    queue({ ...authorizedAsset, url });
    await expect(controller.authorizeAssets(assetScene)).resolves.toMatchObject({ assetUrls: { [assetId]: url } });
  });

  it.each([
    { url: "javascript:alert(1)" },
    { url: "http://outside.example/model.glb" },
    { url: "https://user:password@example.com/model.glb" },
    { format: "png" },
    { id: "60000000-0000-4000-8000-000000000002" },
    { expiresIn: 0 },
  ])("rejects invalid asset authorization without replacing the draft: %j", async invalid => {
    const controller = await editing();
    controller.setDraft(assetScene);
    queue({ ...authorizedAsset, ...invalid });
    await expect(controller.authorizeAssets(assetScene)).rejects.toMatchObject({ code: "ASSET_AUTHORIZATION_INVALID" });
    expect(controller.getSnapshot()).toMatchObject({ draft: assetScene, dirty: true, project, revision: 4, writeBlocked: true, error: { code: "ASSET_AUTHORIZATION_INVALID" } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("rejects the whole asset batch when any referenced asset is unavailable", async () => {
    const controller = await editing();
    const secondId = "60000000-0000-4000-8000-000000000002";
    const twoAssets: Scene = { ...assetScene, objects: [...assetScene.objects, { ...assetScene.objects[0]!, id: "50000000-0000-4000-8000-000000000002", assetId: secondId }] };
    controller.setDraft(twoAssets);
    queue(authorizedAsset);
    queue({ error: { code: "ASSET_NOT_FOUND" } }, 404);
    await expect(controller.authorizeAssets(twoAssets)).rejects.toMatchObject({ code: "ASSET_NOT_FOUND", status: 404 });
    expect(controller.getSnapshot()).toMatchObject({ draft: twoAssets, dirty: true, revision: 4, writeBlocked: true, error: { code: "ASSET_NOT_FOUND" } });
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });
});

describe('private reconstruction transport',()=>{
  const source={assetId,kind:'floorplan' as const,name:'图纸.png',width:1024,height:768};
  const jobId='70000000-0000-4000-8000-000000000001';
  it('uploads binary multipart source bytes with project-scoped authentication',async()=>{
    const controller=await editing();queue(source);
    const result=await controller.uploadSource(new Blob(['image'],{type:'image/png'}),'图纸.png','floorplan');
    const [url,options]=mockFetch.mock.calls[3]!;
    expect(String(url)).toBe(`${base}/functions/v1/scene-api/assets/sources`);
    expect(options?.headers).toEqual({Authorization:'Bearer access-test-only'});
    const form=options?.body as FormData;expect(form).toBeInstanceOf(FormData);expect(form.get('projectId')).toBe(projectId);expect(form.get('kind')).toBe('floorplan');expect(form.get('file')).toBeInstanceOf(Blob);expect(result).toEqual(source);
  });
  it('submits measured sources with stable lease/version context and preserves state on status reads',async()=>{
    const controller=await editing();queue({id:jobId,state:'queued',issues:[]});
    const input={scene,sources:[source],dimensions:[{id:crypto.randomUUID(),kind:'width' as const,label:'总宽',valueMeters:12,status:'confirmed' as const}],instruction:'还原场地',mode:'restore' as const,selectedIds:[],requestId:crypto.randomUUID()};
    expect((await controller.createReconstruction(input)).state).toBe('queued');
    const submitted=request(3);expect(submitted.body).toMatchObject({...input,expectedRevision:4,generation:3,sessionId:controller.getSnapshot().sessionId});
    const previous=controller.getSnapshot().draft;queue({id:jobId,state:'needs_review',issues:[{code:'UNSEEN',message:'确认不可见墙'}]});
    await controller.getReconstruction(jobId);expect(controller.getSnapshot().draft).toBe(previous);expect(request(4).options.method).toBe('GET');
  });
  it('unlinks a source without deleting scene snapshots',async()=>{
    const controller=await editing();queue({removed:true});await controller.removeSource(assetId);expect(request(3)).toMatchObject({url:`${base}/functions/v1/scene-api/projects/${projectId}/sources/${assetId}`,options:{method:'DELETE'}});expect(controller.getSnapshot().draft).toEqual(scene);
  });
});

describe("workspace business requests", () => {
  it("keeps the editing lease on a generation idempotency conflict", async () => {
    const controller = await editing();
    const lease = controller.getSnapshot().lease;
    queue({ error: { code: "IDEMPOTENCY_CONFLICT" } }, 409);
    await expect(controller.businessRequest('/jobs', 'POST', { requestId: crypto.randomUUID(), prompt: '灯' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(controller.getSnapshot()).toMatchObject({ writeBlocked: false, lease, revision: 4 });
    queue({ ...lease, expiresAt: new Date(Date.now() + 120_000).toISOString() });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(request(4).url).toContain('/lease/renew');
  });

  it("renames with the current lease and revision while preserving unsaved draft", async () => {
    const controller = await editing();
    const draft = { ...scene, lighting: 'warm' as const };
    controller.setDraft(draft);
    queue({ ...project, name: '新名称', revision: 5 });
    await controller.renameProject('新名称');
    expect(request(3)).toMatchObject({ options: { method: 'PATCH' }, body: { name: '新名称', expectedRevision: 4, generation: 3, sessionId: controller.getSnapshot().sessionId } });
    expect(controller.getSnapshot()).toMatchObject({ draft, dirty: true, revision: 5, project: { name: '新名称' } });
  });

  it("still blocks cloud writes when a business request discovers expired authentication", async () => {
    const controller = await editing();
    controller.setDraft({ ...scene, lighting: 'warm' });
    queue({ error: { code: 'UNAUTHENTICATED' } }, 401);
    await expect(controller.businessRequest('/assets')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(controller.getSnapshot()).toMatchObject({ writeBlocked: true, dirty: true, draft: { lighting: 'warm' } });
  });
});

describe('Agent run client contract',()=>{
  const requestId='70000000-0000-4000-8000-000000000001',runId='70000000-0000-4000-8000-000000000002';
  const run={id:runId,projectId,requestId,state:'running',progress:'查找物料',callCount:1,candidates:[],evaluation:null,executionMode:'preview',jevEnabled:false,expiresAt:'2026-10-02T08:10:00Z'};
  it('sends current unsaved scene with real lease context and recovers solely through GET',async()=>{
    const controller=await editing();
    queue(run,202);
    await controller.startAgentRun({requestId,scene:assetScene,selectedIds:[assetScene.objects[0]!.id],instruction:'移动选中物料',context:{brief:'完整需求',acceptedDecisions:[],recentMessages:[]},jevEnabled:false,executionMode:'preview'});
    expect(request(3)).toMatchObject({url:`${base}/functions/v1/scene-api/projects/${projectId}/agent-runs`,options:{method:'POST'},body:{requestId,scene:assetScene,sessionId:controller.getSnapshot().sessionId,generation:3,expectedRevision:4,localRevision:controller.getSnapshot().localRevision}});
    queue(run);await controller.getAgentRunByRequest(requestId);
    queue(run);await controller.getAgentRun(runId);
    queue({...run,state:'cancelled'});await controller.cancelAgentRun(runId);
    expect(request(4)).toMatchObject({options:{method:'GET'},url:`${base}/functions/v1/scene-api/projects/${projectId}/agent-runs/by-request/${requestId}`});
    expect(request(5).options.method).toBe('GET');
    expect(request(6)).toMatchObject({options:{method:'POST'},url:`${base}/functions/v1/scene-api/projects/${projectId}/agent-runs/${runId}/cancel`});
    expect(controller.getSnapshot().draft).toEqual(assetScene);
  });
  it('rejects a run belonging to another request and never automatically retries a failed dispatch',async()=>{
    const controller=await editing();
    const input={requestId,scene,selectedIds:[],instruction:'摆放桌子',context:{brief:'',acceptedDecisions:[],recentMessages:[]},jevEnabled:false,executionMode:'preview' as const};
    queue({...run,requestId:runId},202);
    await expect(controller.startAgentRun(input)).rejects.toMatchObject({code:'INVALID_RESPONSE'});
    expect(mockFetch).toHaveBeenCalledTimes(4);
    queue({...run,projectId:studioId});
    await expect(controller.getAgentRun(runId)).rejects.toMatchObject({code:'INVALID_RESPONSE'});
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });
});
