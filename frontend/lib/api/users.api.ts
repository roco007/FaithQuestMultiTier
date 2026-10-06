import { apiRequest } from './client';
import type { UpdateProfileInput, UserProfile } from './types';

/** `GET | PATCH /users/me` — profile plus the embedded progress summary. */
export const usersApi = {
  getProfile(): Promise<UserProfile> {
    return apiRequest<UserProfile>('/users/me');
  },

  updateProfile(patch: UpdateProfileInput): Promise<UserProfile> {
    return apiRequest<UserProfile>('/users/me', {
      method: 'PATCH',
      body: patch,
    });
  },
};
