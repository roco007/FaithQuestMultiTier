import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service.js';
import { Public } from '../common/decorators/auth.decorators.js';

/** `GET /api/v1/health` — liveness plus a real database round-trip. */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Service and database health' })
  async check(): Promise<{ status: string; database: string }> {
    let database = 'connected';
    try {
      // A real query, not just a pool check: `$connect` alone would report
      // healthy while the schema is missing or the credentials are wrong.
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'disconnected';
    }

    return {
      status: database === 'connected' ? 'ok' : 'degraded',
      database,
    };
  }
}