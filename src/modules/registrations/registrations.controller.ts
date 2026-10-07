import { BadRequestException, Body, Controller, Get, Headers, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, Roles, type AuthenticatedUser } from '../auth/auth.decorators.js';
import { PaginationDto } from '../../common/pagination.js';
import { CreateRegistrationDto, RegistrationSuspensionDto } from './registrations.dto.js';
import { RegistrationsService } from './registrations.service.js';

const uuid = () => new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException('O identificador informado é inválido.') });

@ApiTags('Inscrições')
@Controller()
export class RegistrationsController {
  constructor(@Inject(RegistrationsService) private readonly registrations: RegistrationsService) {}
  @Public() @Post('public/events/:publicId/registrations')
  reserve(@Param('publicId', uuid()) publicId: string, @Body() input: CreateRegistrationDto) { return this.registrations.reserve(publicId, input); }
  @Public() @Get('public/registrations/:id') @ApiHeader({ name: 'x-registration-token', required: true })
  details(@Param('id', uuid()) id: string, @Headers('x-registration-token') token?: string) { return this.registrations.participantDetails(id, token); }
  @Public() @Post('public/registrations/:id/cancellation') @ApiHeader({ name: 'x-registration-token', required: true })
  cancel(@Param('id', uuid()) id: string, @Headers('x-registration-token') token?: string) { return this.registrations.requestCancellation(id, token); }
  @Public() @Post('public/registrations/:id/renew') @ApiHeader({ name: 'x-registration-token', required: true })
  renew(@Param('id', uuid()) id: string, @Headers('x-registration-token') token?: string) { return this.registrations.renew(id, token); }
  @Get('events/:eventId/registrations') @Roles('admin', 'organizer') @ApiBearerAuth()
  list(@Param('eventId', uuid()) eventId: string, @CurrentUser() actor: AuthenticatedUser, @Query() pagination: PaginationDto) { return this.registrations.list(eventId, actor, pagination); }
  @Patch('registrations/:id/suspension') @Roles('admin', 'organizer') @ApiBearerAuth()
  suspend(@Param('id', uuid()) id: string, @Body() input: RegistrationSuspensionDto, @CurrentUser() actor: AuthenticatedUser) { return this.registrations.suspend(id, input.suspended, actor); }
}
