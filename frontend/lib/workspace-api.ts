import { sceneSchema, type Scene } from '../../supabase/functions/_shared/domain';
import type { BackendSession } from './backend-session';

export interface StudioMember { userId: string; role: 'owner' | 'editor'; displayName: string }

export function emptyProjectScene(width: number, depth: number, height: number): Scene {
  return sceneSchema.parse({ schemaVersion: 1, venue: { shape: 'rectangle', width, depth, height, entrances: [] },
    objects: [], camera: 'overview', lighting: 'neutral' });
}

export function listMembers(controller: BackendSession, studioId: string): Promise<StudioMember[]> {
  return controller.businessRequest(`/studios/${encodeURIComponent(studioId)}/members`);
}
