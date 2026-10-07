import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  Public,
  Roles,
  type AuthenticatedUser,
} from '../auth/auth.decorators.js';
import { CatalogService } from './catalog.service.js';
import {
  CreateEventDto,
  EventPaginationDto,
  UpdateEventDto,
} from './catalog.dto.js';

@ApiTags('Eventos')
@ApiBearerAuth()
@Roles('admin', 'organizer')
@Controller('events')
export class CatalogController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}
  @Post() create(
    @Body() input: CreateEventDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.catalog.create(input, actor);
  }
  @Get() list(
    @Query() query: EventPaginationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.catalog.list(query, actor);
  }
  @Get(':id') get(
    @Param('id', uuidPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.catalog.get(id, actor);
  }
  @Patch(':id') update(
    @Param('id', uuidPipe()) id: string,
    @Body() input: UpdateEventDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.catalog.update(id, input, actor);
  }
  @Post(':id/publish') publish(
    @Param('id', uuidPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.catalog.transition(id, 'published', actor);
  }
  @Post(':id/suspend') suspend(
    @Param('id', uuidPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.catalog.transition(id, 'suspended', actor);
  }
  @Post(':id/close') close(
    @Param('id', uuidPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.catalog.transition(id, 'closed', actor);
  }
}

function uuidPipe() {
  return new ParseUUIDPipe({
    exceptionFactory: () =>
      new BadRequestException('O identificador do evento é inválido.'),
  });
}

@ApiTags('Inscrições públicas')
@Controller('public/events')
export class PublicEventsController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}
  @Public() @Get(':publicId') get(
    @Param('publicId', uuidPipe()) publicId: string,
  ) {
    return this.catalog.publicEvent(publicId);
  }
}
