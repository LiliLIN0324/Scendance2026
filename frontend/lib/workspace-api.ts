import { sceneSchema, type Scene } from '../../supabase/functions/_shared/domain';
import type { BackendSession, Studio, ProjectSummary } from './backend-session';

export interface StudioMember { userId: string; role: 'owner' | 'editor'; displayName: string }

export function emptyProjectScene(width: number, depth: number, height: number): Scene {
  return sceneSchema.parse({ schemaVersion: 1, venue: { shape: 'rectangle', width, depth, height, entrances: [] },
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
