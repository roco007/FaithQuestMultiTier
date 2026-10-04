import { apiRequest } from './client';
import type { AuthResponse, AuthUser, LoginInput, RegisterInput } from './types';

/**
 * `/auth/*` endpoints.
 *
 * Register/login/refresh never run the 401→refresh→retry dance (a rejected
 * credential must surface as a plain 401 `ApiError`), and none of them send
 * the stored access token — they are public routes.
 */
export const authApi = {
  register(input: RegisterInput): Promise<AuthResponse> {
    return apiRequest<AuthResponse>('/auth/register', {
      method: 'POST',
      body: input,
      refreshOn401: false,
    });
  },

  login(input: LoginInput): Promise<AuthResponse> {
    return apiRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      body: input,
      refreshOn401: false,
    });
  },

  refresh(refreshToken: string): Promise<AuthResponse> {
    return apiRequest<AuthResponse>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
      refreshOn401: false,
    });
  },

  /**
   * Revokes the stored refresh token (server side). The caller clears the
   * session afterwards even if the network call fails — sign-out must succeed
   * locally regardless.
   */
  logout(refreshToken?: string): Promise<void> {
    return apiRequest<void>('/auth/logout', {
      method: 'POST',
      body: refreshToken ? { refreshToken } : {},
      refreshOn401: false,
    });
  },

  /** The current user from the access token (`GET /auth/me`). */
  me(): Promise<AuthUser> {
    return apiRequest<AuthUser>('/auth/me');
  },
};
