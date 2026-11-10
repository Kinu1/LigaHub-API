import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Public } from './modules/auth/auth.decorators.js';
import { PrismaService } from './prisma.service.js';

@Controller()
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Public()
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async ready() {
    try {
      // PostgreSQL statement timeout and transaction acquisition are both bounded.
      await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '2000ms'");
          await tx.$queryRaw`SELECT 1`;
        },
        { maxWait: 2000, timeout: 3000 },
      );
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException('Service unavailable.');
    }
  }
}
