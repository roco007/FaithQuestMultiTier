import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/**
 * Global so feature modules can inject `PrismaService` without importing this
 * module everywhere. Global modules are still dependency-injected normally —
 * this is the standard Nest pattern for a single shared database client.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}