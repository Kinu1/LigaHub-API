import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma.service.js';
import {
  cookies,
  cookieOptions,
  issueCsrf,
} from '../../common/browser-security.js';
import { Public } from './auth.decorators.js';
import { jwtSecret } from './auth.service.js';
import { digest } from '../payments/payment-security.js';

@Controller()
export class BrowserController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {}
  @Public() @Get('browser/csrf') csrf(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return issueCsrf(request, response);
  }
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('auth/refresh')
  @HttpCode(204)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = cookies(request).lh_refresh;
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException('Sessão expirada.');
    const newToken = randomBytes(32).toString('base64url');
    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM browser_sessions WHERE "tokenHash" = ${digest(token)} FOR UPDATE`;
      const session = rows[0]
        ? await tx.browserSession.findUnique({ where: { id: rows[0].id } })
        : null;
      if (!session) return null;
      const user = await tx.user.findUnique({ where: { id: session.userId } });
      if (
        session.revokedAt ||
        session.expiresAt <= new Date() ||
        !user?.active ||
        user.tokenVersion !== session.tokenVersion
      ) {
        await tx.browserSession.updateMany({
          where: { userId: session.userId },
          data: { revokedAt: new Date() },
        });
        if (session.revokedAt && user?.active)
          await tx.user.update({
            where: { id: user.id },
            data: { tokenVersion: { increment: 1 } },
          });
        return null;
      }
      // Preserve consumed tokens so replay can revoke the entire user's session family.
      await tx.browserSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      await tx.browserSession.create({
        data: {
          userId: user.id,
          tokenVersion: user.tokenVersion,
          tokenHash: digest(newToken),
          expiresAt: session.expiresAt,
        },
      });
      return { user, expiresAt: session.expiresAt };
    });
    if (!result) {
      response.clearCookie('lh_access', cookieOptions());
      response.clearCookie('lh_refresh', cookieOptions());
      throw new UnauthorizedException('Sessão expirada. Entre novamente.');
    }
    const accessSeconds = Math.max(
      1,
      Math.min(
        900,
        Math.floor((result.expiresAt.getTime() - Date.now()) / 1000),
      ),
    );
    const access = await this.jwt.signAsync(
      { sub: result.user.id, version: result.user.tokenVersion },
      {
        secret: jwtSecret(),
        expiresIn: accessSeconds,
        algorithm: 'HS256',
        issuer: 'ligahub-api',
        audience: 'ligahub',
      },
    );
    response.cookie('lh_access', access, {
      ...cookieOptions(),
      maxAge: accessSeconds * 1000,
    });
    response.cookie('lh_refresh', newToken, {
      ...cookieOptions(),
      expires: result.expiresAt,
    });
  }
}
