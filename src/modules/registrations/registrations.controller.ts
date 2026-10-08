import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { participantCookie } from '../../common/browser-security.js';
import { RegistrationAccessService } from './access.service.js';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  Public,
  Roles,
  type AuthenticatedUser,
} from '../auth/auth.decorators.js';

import {
  CreateRegistrationDto,
  RegistrationSuspensionDto,
  RegistrationPaginationDto,
} from './registrations.dto.js';
import { RegistrationsService } from './registrations.service.js';

const uuid = () =>
  new ParseUUIDPipe({
    exceptionFactory: () =>
      new BadRequestException('O identificador informado é inválido.'),
  });

@ApiTags('Inscrições')
@Controller()
export class RegistrationsController {
  constructor(
    @Inject(RegistrationsService)
    private readonly registrations: RegistrationsService,
    @Inject(RegistrationAccessService)
    private readonly access: RegistrationAccessService,
  ) {}
  @Public()
  @Post('public/events/:publicId/registrations')
  async reserve(
    @Param('publicId', uuid()) publicId: string,
    @Body() input: CreateRegistrationDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const record = await this.registrations.reserve(publicId, input);
    await this.access.safeSend(record.id);
    if (request.headers['x-browser-client'] === '1') {
      participantCookie(response, record.id, record.manageToken);
      const { manageToken: _secret, ...safe } = record;
      return safe;
    }
    return record;
  }
  @Public()
  @Get('public/registrations/:id/status')
  @Header('Cache-Control', 'no-store')
  @ApiHeader({ name: 'x-registration-status-token', required: true })
  status(
    @Param('id', uuid()) id: string,
    @Headers('x-registration-status-token') token?: string,
  ) {
    return this.registrations.participantStatus(id, token);
  }
  @Public()
  @Get('public/registrations/:id')
  @ApiHeader({ name: 'x-registration-token', required: true })
  details(
    @Param('id', uuid()) id: string,
    @Headers('x-registration-token') token?: string,
  ) {
    return this.registrations.participantDetails(id, token);
  }
  @Public()
  @Post('public/registrations/:id/cancellation')
  @ApiHeader({ name: 'x-registration-token', required: true })
  cancel(
    @Param('id', uuid()) id: string,
    @Headers('x-registration-token') token?: string,
  ) {
    return this.registrations.requestCancellation(id, token);
  }
  @Public()
  @Post('public/registrations/:id/renew')
  @ApiHeader({ name: 'x-registration-token', required: true })
  renew(
    @Param('id', uuid()) id: string,
    @Headers('x-registration-token') token?: string,
  ) {
    return this.registrations.renew(id, token);
  }
  @Get('events/:eventId/registrations')
  @Roles('admin', 'organizer')
  @ApiBearerAuth()
  list(
    @Param('eventId', uuid()) eventId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Query() pagination: RegistrationPaginationDto,
  ) {
    return this.registrations.list(eventId, actor, pagination);
  }
  @Patch('registrations/:id/suspension')
  @Roles('admin', 'organizer')
  @ApiBearerAuth()
  suspend(
    @Param('id', uuid()) id: string,
    @Body() input: RegistrationSuspensionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.registrations.suspend(id, input.suspended, actor);
  }
}
