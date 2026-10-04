import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import { toAuthUser } from '../auth/auth.service.js';
import { ProgressService, type ProgressSummary } from '../progress/progress.service.js';

/**
 * The player's own account.
 *
 * `GET /users/me` returns the account *plus* its progress summary in one call —
 * that is what the frontend's boot sequence needs (HUD + profile), and one round
 * trip is materially better than two on a phone.
 */
export interface UserProfileDto {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: string;
  totalXp: number;
  level: number;
  createdAt: string;
  progress: ProgressSummary;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly progress: ProgressService,
  ) {}

  async findMe(userId: string): Promise<UserProfileDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw ApiException.unauthorized('UNAUTHORIZED', 'Your account no longer exists.');
    }

    return {
      ...toAuthUser(user),
      progress: await this.progress.getSummary(userId),
    };
  }

  /** Partial update; `undefined` fields are left untouched. */
  async updateMe(
    userId: string,
    dto: { displayName?: string; avatarUrl?: string; username?: string },
  ): Promise<UserProfileDto> {
    if (dto.username) {
      const taken = await this.prisma.user.findFirst({
        where: { username: dto.username, NOT: { id: userId } },
        select: { id: true },
      });
      if (taken) {
        throw ApiException.conflict('USERNAME_TAKEN', 'That username is already taken.');
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
        ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl } : {}),
        ...(dto.username !== undefined ? { username: dto.username } : {}),
      },
    });

    return this.findMe(userId);
  }
}