import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  CurrentUser,
  Roles,
  type AuthenticatedUser,
} from '../auth/auth.decorators.js';
import { PaginationDto } from '../../common/pagination.js';
import { AdminService } from './admin.service.js';
import { AuditQueryDto } from './audit-query.dto.js';
import { OperationsQueryDto } from './operations-query.dto.js';

@Controller()
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get('dashboard')
  @Roles('admin', 'organizer')
  dashboard(@CurrentUser() actor: AuthenticatedUser) {
    return this.admin.dashboard(actor);
  }

  @Get('admin/overview')
  @Roles('admin')
  overview() {
    return this.admin.overview();
  }

  @Get('admin/audit')
  @Roles('admin')
  audit(@Query() query: AuditQueryDto) {
    return this.admin.audit(query);
  }

  @Get(['admin/operations', 'admin/jobs'])
  @Roles('admin')
  operations(
    @Query() query: OperationsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.admin.operations(query);
  }

  @Get('events/:id/history')
  @Roles('admin', 'organizer')
  history(
    @Param(
      'id',
      new ParseUUIDPipe({
        exceptionFactory: () =>
          new BadRequestException('O identificador do evento é inválido.'),
      }),
    )
    id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: PaginationDto,
  ) {
    return this.admin.eventHistory(id, actor, query);
  }
}
