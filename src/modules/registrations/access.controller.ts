import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { IsEmail, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorators.js';
import { RegistrationAccessService } from './access.service.js';
import { participantCookie } from '../../common/browser-security.js';
class RecoveryDto {
  @IsUUID('4') publicId!: string;
  @IsEmail() @MaxLength(254) email!: string;
}
class ExchangeDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) token!: string;
}
@Controller('public')
export class RegistrationAccessController {
  constructor(
    @Inject(RegistrationAccessService)
    private readonly access: RegistrationAccessService,
  ) {}
  @Public()
  @Throttle({ default: { limit: 3, ttl: 3600_000 } })
  @Post('access/recover')
  @HttpCode(200)
  recover(@Body() input: RecoveryDto) {
    return this.access.recover(input.publicId, input.email);
  }
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('registrations/:id/access')
  @HttpCode(204)
  async exchange(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: ExchangeDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    participantCookie(
      response,
      id,
      await this.access.exchange(id, input.token),
    );
  }
}
