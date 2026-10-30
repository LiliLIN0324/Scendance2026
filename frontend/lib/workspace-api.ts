import { sceneSchema, type Scene } from '../../supabase/functions/_shared/domain';
import type { BackendSession, Studio, ProjectSummary } from './backend-session';

export interface StudioMember { userId: string; role: 'owner' | 'editor'; displayName: string }

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
