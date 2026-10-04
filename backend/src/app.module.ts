import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { QuestsModule } from './quests/quests.module.js';
import { HuntsModule } from './hunts/hunts.module.js';
import { ProgressModule } from './progress/progress.module.js';
import { BadgesModule } from './badges/badges.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { LeaderboardModule } from './leaderboard/leaderboard.module.js';
import { HealthModule } from './health/health.module.js';
import { ShortLinksModule } from './links/short-links.module.js';

/**
 * The application root — a modular monolith (rule #5).
 *
 * One Nest process, one MySQL database, and modules that map onto the
 * domain rather than onto deployment units. `ConfigModule` is global so any
 * module can inject `ConfigService`; `PrismaModule` is global for the same
 * reason.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      // `.env` is git-ignored; `.env.example` documents every key.
      envFilePath: ['.env'],
      cache: true,
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    QuestsModule,
    HuntsModule,
    ProgressModule,
    BadgesModule,
    InventoryModule,
    LeaderboardModule,
    HealthModule,
    ShortLinksModule,
  ],
})
export class AppModule {}