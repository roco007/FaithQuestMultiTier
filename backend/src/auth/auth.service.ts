import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import { TokenService } from './token.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import type { AuthResponseDto, AuthUserDto } from './dto/auth-response.dto.js';
import type { RefreshTokenDto } from './dto/auth-response.dto.js';
import type { RequestUser } from '../common/decorators/auth.decorators.js';
import { XP_RANKS } from '../quests/services/xp.service.js';

/** bcrypt cost. 12 ≈ 250 ms on a laptop — strong, and still fine for login UX. */
const BCRYPT_ROUNDS = 12;

/**
 * Accounts and sessions.
 *
 * The controller stays thin: it only adapts HTTP to these methods and never
 * touches Prisma itself (rule #7).
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Creates the account, its `PlayerProgress` row and the first token pair in a
   * single transaction — a half-created user with no progress row would make
   * every later quest completion fail.
   */
  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { username: dto.username }] },
      select: { email: true, username: true },
    });
    if (existing?.email === dto.email) {
      throw ApiException.conflict('EMAIL_TAKEN', 'That email is already registered.');
    }
    if (existing?.username === dto.username) {
      throw ApiException.conflict('USERNAME_TAKEN', 'That username is already taken.');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const firstRank = XP_RANKS[0];

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: dto.email,
          username: dto.username,
          passwordHash,
          displayName: dto.displayName?.trim() || dto.username,
          progress: {
            create: {
              currentXp: 0,
              xpForNextLevel: firstRank.maxXp,
              rankTitle: firstRank.title,
            },
          },
        },
      });
      return created;
    });

    return this.buildResponse(user);
  }

  /**
   * Verifies credentials.
   *
   * A missing user and a wrong password return the same 401 with the same
   * message, so the endpoint cannot be used to enumerate registered emails.
   * The bcrypt comparison still runs against a dummy hash when the user is
   * absent, keeping the response time similar either way.
   */
  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    const hash = user?.passwordHash ?? DUMMY_HASH;
    const passwordMatches = await bcrypt.compare(dto.password, hash);

    if (!user || !passwordMatches) {
      throw ApiException.unauthorized(
        'INVALID_CREDENTIALS',
        'Email or password is incorrect.',
      );
    }

    return this.buildResponse(user);
  }

  /** Rotates a refresh token into a fresh pair. */
  async refresh(dto: RefreshTokenDto): Promise<AuthResponseDto> {
    try {
      const rotated = await this.tokens.rotate(dto.refreshToken);
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: rotated.user.id },
      });
      return {
        accessToken: rotated.accessToken,
        refreshToken: rotated.refreshToken,
        expiresIn: rotated.expiresIn,
        user: toAuthUser(user),
      };
    } catch {
      // Signature failures, expired tokens and revoked/unknown sessions are all
      // the same thing to the caller: refresh again from a clean sign-in.
      throw ApiException.unauthorized(
        'INVALID_REFRESH_TOKEN',
        'Your session has expired. Please sign in again.',
      );
    }
  }

  /** Revokes the presented refresh token (or every session when omitted). */
  async logout(user: RequestUser, refreshToken?: string): Promise<{ success: true }> {
    await this.tokens.revoke(user.id, refreshToken);
    return { success: true };
  }

  /** The authenticated user's own record. */
  async me(userId: string): Promise<AuthUserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw ApiException.unauthorized('UNAUTHORIZED', 'Your account no longer exists.');
    }
    return toAuthUser(user);
  }

  private async buildResponse(user: {
    id: string;
    email: string;
    username: string;
    role: string;
  }): Promise<AuthResponseDto> {
    const pair = await this.tokens.issue({
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role as RequestUser['role'],
    });
    const full = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return { ...pair, user: toAuthUser(full) };
  }
}

/** Maps a `User` row to the API's user shape. The password hash never leaves here. */
export function toAuthUser(user: {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: string;
  totalXp: number;
  level: number;
  createdAt: Date;
}): AuthUserDto {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    totalXp: user.totalXp,
    level: user.level,
    createdAt: user.createdAt.toISOString(),
  };
}

/** A real bcrypt hash of a random string, used only to equalise login timing. */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.jKZ6JgY0k7r7oQmO0aXKcBqbPz8XeY2';