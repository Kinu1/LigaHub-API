import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../prisma.module.js';
import { UsersModule } from '../users/users.module.js';
import { UsersController } from '../users/users.controller.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard, RolesGuard } from './auth.guards.js';

@Module({
  imports: [JwtModule.register({}), PrismaModule, UsersModule],
  controllers: [AuthController, UsersController],
  providers: [AuthService, JwtAuthGuard, RolesGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
