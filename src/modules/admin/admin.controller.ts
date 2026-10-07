import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
  BadRequestException,
} from '@nestjs/common';
import {
  CurrentUser,
  Roles,
  type AuthenticatedUser,
} from '../auth/auth.decorators.js';
import { PaginationDto } from '../../common/pagination.js';
import { AdminService } from './admin.service.js';

@Controller()
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get('admin/overview')
  @Roles('admin')
  overview() {
    return this.admin.overview();
  }

  @Get('admin/audit')
  @Roles('admin')
  audit(@Query() query: PaginationDto) {
    return this.admin.audit(query);
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
