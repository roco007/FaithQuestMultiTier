import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import type { JwtPayload, RequestUser } from '../common/decorators/auth.decorators.js';

/**
 * Issues and rotates the token pair.
 *
 * Access tokens are short-lived JWTs signed with `JWT_SECRET` and are *not*
 * stored. Refresh tokens are longer-lived JWTs signed with `JWT_REFRESH_SECRET`,
 * and only their SHA-256 hash is persisted (`RefreshSession`) — so a database
 * dump cannot be turned into a working session, and a rotation can revoke the
 * previous token by hash.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /** Seconds until the access token expires (used by the client to refresh early). */
  get accessTtlSeconds(): number {
    return parseDurationToSeconds(this.config.get<string>('jwt.accessTtl') ?? '15m');
  }

  private get refreshTtlSeconds(): number {
    return parseDurationToSeconds(this.config.get<string>('jwt.refreshTtl') ?? '30d');
  }

  private async signPair(user: RequestUser): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    const base = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { ...base, type: 'access' } satisfies JwtPayload,
        {
          secret: this.config.get<string>('jwt.accessSecret'),
          expiresIn: this.accessTtlSeconds,
        },
      ),
      this.jwt.signAsync(
        { ...base, type: 'refresh', jti: randomUUID() } satisfies JwtPayload & {
          jti: string;
        },
        {
          secret: this.config.get<string>('jwt.refreshSecret'),
          expiresIn: this.refreshTtlSeconds,
        },
      ),
    ]);

    await this.prisma.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTtlSeconds * 1000),
      },
    });

    return { accessToken, refreshToken, expiresIn: this.accessTtlSeconds };
  }

  /** Issues a fresh pair for a known user. */
  issue(user: RequestUser) {
    return this.signPair(user);
  }

  /**
   * Verifies a refresh token, confirms its session is still live, then rotates:
   * the presented token is revoked and a new pair is issued. Rotation means a
   * stolen refresh token is usable at most once, and only until the real client
   * refreshes.
   */
  async rotate(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: RequestUser;
  }> {
    const payload = await this.verifyRefreshToken(refreshToken);
    const hash = hashToken(refreshToken);

    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash: hash },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
      throw new Error('refresh session is not usable');
    }

    const user: RequestUser = {
      id: session.user.id,
      email: session.user.email,
      username: session.user.username,
      role: session.user.role,
    };

    // Revoke first, then mint: a crash between the two leaves the caller with a
    // dead token rather than two live ones.
    await this.prisma.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const pair = await this.signPair(user);
    return { ...pair, user };
  }

  /** Verifies signature/expiry; throws when the token is not a refresh token. */
  async verifyRefreshToken(refreshToken: string): Promise<JwtPayload> {
    const payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
      secret: this.config.get<string>('jwt.refreshSecret'),
    });
    if (payload.type !== 'refresh') {
      throw new Error('not a refresh token');
    }
    return payload;
  }

  /** Revokes one refresh token, or every live session when none is supplied. */
  async revoke(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await this.prisma.refreshSession.updateMany({
        where: { tokenHash: hashToken(refreshToken), userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return;
    }
    await this.prisma.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

/** SHA-256 hex digest — refresh tokens are never stored in the clear. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Parses a duration such as `15m`, `30d`, `900` or `12h` into seconds.
 * `jsonwebtoken` accepts these strings too; this mirror exists only so the API
 * can report `expiresIn` numerically.
 */
export function parseDurationToSeconds(value: string): number {
  const match = /^(\d+)([smhd])?$/.exec(value.trim());
  if (!match) return 900; // Unparseable → the 15-minute default.
  const amount = Number(match[1]);
  switch (match[2]) {
    case 'd':
      return amount * 86400;
    case 'h':
      return amount * 3600;
    case 'm':
      return amount * 60;
    case 's':
    default:
      return amount;
  }
}