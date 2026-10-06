import { apiRequest, getApiBaseUrl, API_PREFIX } from './client';
import type { HealthResponse } from './types';

/**
 * Health check API pointing to the backend's `/api/v1/health` endpoint.
 *
 * Target: https://faithquestmultitier.onrender.com/api/v1/health
 */
export const healthApi = {
  /**
   * Hits `GET /api/v1/health` on the backend.
   */
  check(): Promise<HealthResponse> {
    return apiRequest<HealthResponse>('/health', {
      method: 'GET',
      refreshOn401: false,
    });
  },

  /**
   * Resolves the full backend health check URL.
   */
  getUrl(): string {
    const base =
      getApiBaseUrl() ||
      process.env.NEXT_PUBLIC_API_URL ||
      'https://faithquestmultitier.onrender.com';
    return `${base.replace(/\/+$/, '')}${API_PREFIX}/health`;
  },
};
