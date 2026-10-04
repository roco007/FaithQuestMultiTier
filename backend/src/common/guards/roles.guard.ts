import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, type RequestUser } from '../decorators/auth.decorators.js';
import { ApiException } from '../exceptions/api.exception.js';
import type { UserRole } from '../../generated/prisma/enums.js';

/**
 * Role gate, run after `JwtAuthGuard` (see `AuthModule` provider order).
 *
 * `ADMIN` satisfies every requirement, so an operator never has to be added to
 * each role list. A route with no `@Roles()` metadata is open to any signed-in
 * user, which is the common case.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    const role = request.user?.role;

    if (!role) {
      throw ApiException.unauthorized(
        'UNAUTHORIZED',
        'Sign in to perform this action.',
      );
    }
    if (role === 'ADMIN' || required.includes(role)) return true;

    throw ApiException.forbidden(
      'INSUFFICIENT_ROLE',
      `This action requires one of: ${required.join(', ')}.`,
      { required, actual: role },
    );
  }
}