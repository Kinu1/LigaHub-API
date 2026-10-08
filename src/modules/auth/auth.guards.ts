import {
  Inject,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma.service.js';
import type { UserRole } from '../users/entities/user.entity.js';
import {
  PUBLIC_ROUTE,
  REQUIRED_ROLES,
  type AuthenticatedUser,
} from './auth.decorators.js';
import { jwtSecret } from './auth.service.js';
import { cookies } from '../../common/browser-security.js';

type AuthRequest = {
  headers: { authorization?: string; cookie?: string };
  user?: AuthenticatedUser;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const match = /^Bearer ([^\s]+)$/i.exec(
      request.headers.authorization ??
        (cookies(request).lh_access
          ? `Bearer ${cookies(request).lh_access}`
          : ''),
    );
    if (!match || match[1].length > 4096)
      throw new UnauthorizedException('Autenticação necessária.');
    const secret = jwtSecret();
    let payload: {
      sub?: unknown;
      version?: unknown;
      exp?: unknown;
      iat?: unknown;
    };
    try {
      payload = await this.jwt.verifyAsync(match[1], {
        secret,
        algorithms: ['HS256'],
        issuer: 'ligahub-api',
        audience: 'ligahub',
      });
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado.');
    }
    if (
      typeof payload.sub !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        payload.sub,
      ) ||
      typeof payload.version !== 'number' ||
      !Number.isSafeInteger(payload.version) ||
      payload.version < 0 ||
      typeof payload.exp !== 'number' ||
      typeof payload.iat !== 'number' ||
      !Number.isSafeInteger(payload.exp) ||
      !Number.isSafeInteger(payload.iat) ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > 900 ||
      payload.iat > Math.floor(Date.now() / 1000) + 30
    )
      throw new UnauthorizedException('Token inválido ou expirado.');
    const account = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!account || !account.active || account.tokenVersion !== payload.version)
      throw new UnauthorizedException('Sessão inválida. Faça login novamente.');
    request.user = {
      id: account.id,
      name: account.name,
      email: account.email,
      role: account.role,
    };
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;
    const user = context.switchToHttp().getRequest<AuthRequest>().user;
    if (!user || !roles.includes(user.role))
      throw new ForbiddenException(
        'Você não tem permissão para esta operação.',
      );
    return true;
  }
}
