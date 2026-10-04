import { apiRequest } from './client';
import type { BadgeEntry } from './types';

/** `GET /badges` — full catalogue with the caller's unlock flags (bare array). */
export const badgesApi = {
  list(): Promise<BadgeEntry[]> {
    return apiRequest<BadgeEntry[]>('/badges');
  },
};
