import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import {
  IS_PUBLIC_KEY,
  OPTIONAL_AUTH_KEY,
} from '../../common/decorators/auth.decorators.js';
import { ApiException } from '../../common/exceptions/api.exception.js';

/**
 * Application-wide authentication guard.
 *
 * Registered globally in `AuthModule`, so *every* route is protected unless it
 * says otherwise — the safe default, and the reason a new controller cannot
 * accidentally ship an unprotected write endpoint.
 *
 *   @Public()       → no token required at all
 *   @OptionalAuth() → token used when present, absent token is fine
 *   (neither)       → a valid access token is required
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  /**
   * On an optional-auth route a missing/expired token yields `undefined` instead
   * of a 401, so public reads work before sign-in. A *malformed* token is still
   * rejected — silently ignoring it would hide a real client bug.
   */
  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    info: unknown,
    context: ExecutionContext,
  ): TUser | undefined {
    const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!user) {
      if (info instanceof Error && info.name === 'JsonWebTokenError') {
        throw ApiException.unauthorized(
          'UNAUTHORIZED',
          'That access token is not valid.',
        );
      }
      if (optional) return undefined;
      // No token at all, an expired one, or a strategy failure on a route that
      // demands auth — and a 401, never a fall-through `undefined` that would
      // make controllers crash with a 500.
      throw ApiException.unauthorized(
        'UNAUTHORIZED',
        'Sign in to continue.',
      );
    }

    if (err) {
      throw err;
    }

    return user;
  }
}