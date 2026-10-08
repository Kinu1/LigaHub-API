import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma.service.js';
import { cookieOptions } from '../../common/browser-security.js';
import { digest } from '../payments/payment-security.js';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import {
  CurrentUser,
  Public,
  type AuthenticatedUser,
} from './auth.decorators.js';
import { LoginDto } from './login.dto.js';

@ApiTags('Autenticação')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() input: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(input.email, input.password);
    if (request.headers['x-browser-client'] !== '1') return result;
    const account = await this.prisma.user.findUniqueOrThrow({
      where: { id: result.user.id },
    });
    const refresh = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 8 * 3600_000);
    await this.prisma.browserSession.create({
      data: {
        userId: account.id,
        tokenVersion: account.tokenVersion,
        tokenHash: digest(refresh),
        expiresAt,
      },
    });
    response.cookie('lh_access', result.accessToken, {
      ...cookieOptions(),
      maxAge: 900_000,
    });
    response.cookie('lh_refresh', refresh, {
      ...cookieOptions(),
      expires: expiresAt,
    });
    response.setHeader('Cache-Control', 'no-store');
    return { user: result.user, expiresIn: result.expiresIn };
  }
  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(user);
    response.clearCookie('lh_access', cookieOptions());
    response.clearCookie('lh_refresh', cookieOptions());
  }
}
