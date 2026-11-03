import { sceneSchema, type Scene } from '../../supabase/functions/_shared/domain';
import type { BackendSession, Studio, ProjectSummary } from './backend-session';

export interface StudioMember { userId: string; role: 'owner' | 'editor'; displayName: string; email?: string }

/** 一块能改尺寸的空地：新项目的默认壳体与编辑器「空白场地」共用这三个米数，真实尺寸留给对话①。 */
export const BLANK_VENUE_SIZE = { width: 12, depth: 8, height: 3 } as const;

export function emptyProjectScene(): Scene {
  return sceneSchema.parse({ schemaVersion: 1, venue: { shape: 'rectangle', ...BLANK_VENUE_SIZE, entrances: [] },
    objects: [], camera: 'overview', lighting: 'neutral' });
}

export function listMembers(controller: BackendSession, studioId: string): Promise<StudioMember[]> {
  return controller.businessRequest(`/studios/${encodeURIComponent(studioId)}/members`);
}

export function listStudioProjects(controller: BackendSession, studioId: string): Promise<ProjectSummary[]> {
  return controller.businessRequest(`/studios/${encodeURIComponent(studioId)}/projects`);
}

export function preferredStudio(userId: string, studios: Studio[], fallback = ''): string {
  let saved = '';
  try { saved = localStorage.getItem(`scendance:studio:${userId}`) ?? ''; } catch { /* Storage is optional. */ }
  return [saved, fallback].find(id => studios.some(studio => studio.id === id)) ?? studios[0]?.id ?? '';
}

export function rememberStudio(userId: string, studioId: string): void {
  try { localStorage.setItem(`scendance:studio:${userId}`, studioId); } catch { /* Storage is optional. */ }
}

/** 无感挂云自己写入 ?project= 的标记：CloudPanel 读到该参数时凭标记跳过「重开项目」，画布与撤销历史不动。 */
const selfAttachedProjects = new Set<string>();
export function markSelfAttachedProject(userId: string, projectId: string): void {
  selfAttachedProjects.add(`${userId}:${projectId}`);
}
/** 一次性消费：命中即移除，不影响之后真正的链接打开。 */
export function consumeSelfAttachedProject(userId: string, projectId: string): boolean {
  const key = `${userId}:${projectId}`;
  const marked = selfAttachedProjects.delete(key);
  return marked;
}

/** 左轨头像点开的一对一私信。消息在云端，所以换台设备接着聊还在。 */
export interface TeamMessage {
  id: string;
  fromUserId: string;
  toUserId: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface TeamUnread { userId: string; count: number }

export function listTeamMessages(controller: BackendSession, studioId: string, peerId: string): Promise<TeamMessage[]> {
  return controller.businessRequest(`/studios/${encodeURIComponent(studioId)}/messages?peerId=${encodeURIComponent(peerId)}`);
}

export function sendTeamMessage(controller: BackendSession, studioId: string, input: { requestId: string; peerId: string; body: string }): Promise<TeamMessage> {
  return controller.businessRequest(`/studios/${encodeURIComponent(studioId)}/messages`, 'POST', input);
}

export function markTeamMessagesRead(controller: BackendSession, studioId: string, peerId: string): Promise<{ marked: number }> {
  return controller.businessRequest(`/studios/${encodeURIComponent(studioId)}/messages/read`, 'POST', { peerId });
}

export function listTeamUnread(controller: BackendSession, studioId: string): Promise<TeamUnread[]> {
  return controller.businessRequest(`/studios/${encodeURIComponent(studioId)}/messages/unread`);
}
