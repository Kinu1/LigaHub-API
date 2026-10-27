import {
  Controller,
  Get,
  Post,
  Param,
  ParseUUIDPipe,
  Query,
  Inject,
} from '@nestjs/common';
import {
  CurrentUser,
  Roles,
  type AuthenticatedUser,
} from '../auth/auth.decorators.js';
import { OutboxAdminService } from './outbox-admin.service.js';
import { OutboxQueryDto } from './outbox-query.dto.js';

@Controller('admin/email-outbox')
@Roles('admin')
export class OutboxAdminController {
  constructor(
    @Inject(OutboxAdminService) private readonly service: OutboxAdminService,
  ) {}
  @Get()
  list(@Query() query: OutboxQueryDto) {
    return this.service.list(query);
  }
  @Post(':id/retry')
  retry(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.retry(id, actor.id);
  }
}
