import { apiRequest } from './client';
import type { LeaderboardEntry, Paginated } from './types';

/** `GET /leaderboard` (+ `/me`) — standings ranked by total XP. */
export const leaderboardApi = {
  /** Public: works signed-out (rankings are public), uses the token when present. */
  list(query: { page?: number; limit?: number } = {}): Promise<Paginated<LeaderboardEntry>> {
    return apiRequest<Paginated<LeaderboardEntry>>('/leaderboard', { query });
  },

  /** The caller's own standing (`GET /leaderboard/me`) — requires a session. */
  me(): Promise<LeaderboardEntry> {
    return apiRequest<LeaderboardEntry>('/leaderboard/me');
  },
};
