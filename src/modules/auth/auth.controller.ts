import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
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
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() input: LoginDto) {
    return this.auth.login(input.email, input.password);
  }
  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(204)
  logout(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.logout(user);
  }
}
