import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ApiException } from '../../common/exceptions/api.exception.js';
import type { JwtPayload, RequestUser } from '../../common/decorators/auth.decorators.js';

/**
 * Verifies the `Authorization: Bearer <access token>` header.
 *
 * The access token carries the identity directly (no database read per request),
 * which keeps the hot path cheap; anything security-sensitive re-reads the user
 * from MySQL inside the service that needs it.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    // Read before `super()` (allowed — it touches no `this`). The config
    // validator already insists the secret exists, so this only guards against
    // a strategy being constructed without it; `secretOrKey` is typed `string`,
    // never `undefined`.
    const secret = config.get<string>('jwt.accessSecret');
    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET is missing — see config/validation.ts.');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * Whatever is returned here becomes `request.user` (and therefore
   * `@CurrentUser()`). A refresh token presented as an access token is rejected:
   * the two are signed with different secrets, so this is belt-and-braces.
   */
  validate(payload: JwtPayload): RequestUser {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Expected an access token.');
    }
    if (!payload.sub) {
      throw ApiException.unauthorized('UNAUTHORIZED', 'Malformed token.');
    }
    return {
      id: payload.sub,
      email: payload.email,
      username: payload.username,
      role: payload.role,
    };
  }
}