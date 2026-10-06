import { apiRequest } from './client';
import type { ProgressSummary } from './types';

/** `GET /progress` — level, XP, rank, streaks and completion counters. */
export const progressApi = {
  get(): Promise<ProgressSummary> {
    return apiRequest<ProgressSummary>('/progress');
  },
};
