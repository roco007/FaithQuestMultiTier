import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
// The Prisma 7 `prisma-client` generator emits TypeScript into `src/generated`,
// so the compiled client is part of the Nest build (see prisma/schema.prisma).
import { PrismaClient } from '../generated/prisma/client.js';
import { mariadbPoolConfig } from './mariadbConfig.js';

/**
 * Single Prisma client for the whole process.
 *
 * Prisma 7 uses driver adapters: the connection pool belongs to the MariaDB
 * driver (which speaks the MySQL protocol), and the pool it is handed must point
 * at the same database as the CLI's `DATABASE_URL` in `prisma.config.ts`. One
 * instance per process is the documented rule (prisma-orm-setup/v7-client-setup,
 * step 5).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    const connectionString = config.get<string>('databaseUrl');
    super({
      adapter: new PrismaMariaDb(mariadbPoolConfig(connectionString)),
      log: config.get<string>('nodeEnv') === 'development'
        ? ['warn', 'error']
        : ['error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to MySQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}