import { apiRequest } from './client';
import type { Paginated, QuestCompletionResult, QuestNodeDto } from './types';
import type { ChurchNode, LandmarkCategory, NodeReward, Puzzle } from '../types/node';

/** The coordinates a device measured — the only thing a completion may send. */
export interface DevicePosition {
  latitude: number;
  longitude: number;
  /** GPS accuracy in meters, when the device reports it (widens the radius server-side). */
  accuracy?: number;
}

export type ListQuestsQuery = {
  type?: string;
  category?: string;
  page?: number;
  limit?: number;
};

/**
 * `GET | POST /quests*` — the authoritative quest catalogue and completion.
 *
 * Completion is POSTed with coordinates only: XP, badges, items and the
 * "already completed" decision are all the server's to make (plan §7).
 */
export const questsApi = {
  list(query: ListQuestsQuery = {}): Promise<Paginated<QuestNodeDto>> {
    return apiRequest<Paginated<QuestNodeDto>>('/quests', { query });
  },

  /** Accepts the catalogue id (`node_01_chapel`) or the UUID. */
  get(questId: string): Promise<QuestNodeDto> {
    return apiRequest<QuestNodeDto>(`/quests/${encodeURIComponent(questId)}`);
  },

  complete(questId: string, position: DevicePosition): Promise<QuestCompletionResult> {
    return apiRequest<QuestCompletionResult>(
      `/quests/${encodeURIComponent(questId)}/complete`,
      { method: 'POST', body: position },
    );
  },
};

/**
 * Maps a server `QuestNodeDto` into the UI's `ChurchNode` shape (the contract
 * `GameMap`, `RadarHUD`, the puzzle screens and `data/church_nodes.json` use).
 *
 * The casts are safe because the catalogue rows were seeded from that same
 * JSON file; `category`/`iconName` fall back to the nearest neutral defaults
 * in case a row was authored without them. The server remains authoritative
 * for completion — this is presentation only.
 */
export function toChurchNode(dto: QuestNodeDto): ChurchNode {
  return {
    id: dto.id,
    title: dto.title,
    subtitle: dto.subtitle,
    latitude: dto.latitude,
    longitude: dto.longitude,
    radiusMeters: dto.radiusMeters,
    description: dto.description,
    clueHint: dto.clueHint,
    category: (dto.category ?? 'chapel') as LandmarkCategory,
    iconName: dto.iconName ?? 'map-pin',
    puzzle: dto.puzzle as Puzzle,
    reward: dto.reward as NodeReward,
  };
}
