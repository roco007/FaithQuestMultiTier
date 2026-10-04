import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { UserRole } from '../../generated/prisma/enums.js';

/** Authenticated principal attached to the request by `JwtStrategy`. */
export interface RequestUser {
  id: string;
  email: string;
  username: string;
  role: UserRole;
}

/** JWT payload shape (what `JwtStrategy.validate` receives). */
export interface JwtPayload {
  sub: string;
  email: string;
  username: string;
  role: UserRole;
  /** Distinguishes an access token from a refresh token. */
  type: 'access' | 'refresh';
}

/**
 * `@CurrentUser()` — resolves the authenticated user, or `undefined` on a route
 * that allows anonymous access (see `OptionalJwtAuthGuard`).
 */
export const CurrentUser = createParamDecorator(
  (data: keyof RequestUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: RequestUser }>();
    const user = request.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);

export const IS_PUBLIC_KEY = 'faithquest:isPublic';
/** Marks a route as reachable without a token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const OPTIONAL_AUTH_KEY = 'faithquest:optionalAuth';
/**
 * Marks a route as usable with *or* without a token: the guard still tries to
 * authenticate, but an absent/expired token is not an error. Used by the read
 * endpoints (`GET /quests`, `GET /badges`, `GET /leaderboard`) so the catalogue
 * renders on the map before anyone signs in.
 */
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH_KEY, true);

export const ROLES_KEY = 'faithquest:roles';
/** Restricts a route to the given roles (`@Roles('ADMIN')`). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);