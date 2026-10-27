import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

@Injectable()
export class JobsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    http.getResponse<Response>().setHeader('Cache-Control', 'no-store');
    if (process.env.BACKGROUND_JOBS_ENABLED !== 'true')
      throw new NotFoundException('Recurso não encontrado.');
    const secret = process.env.CRON_SECRET;
    if (!secret || !/^[\x21-\x7e]{32,256}$/.test(secret))
      throw new ServiceUnavailableException(
        'Configuração de rotinas indisponível.',
      );
    const header = http.getRequest<Request>().headers.authorization;
    const match =
      typeof header === 'string'
        ? /^Bearer ([^\s]{32,256})$/i.exec(header)
        : null;
    const hash = (value: string) => createHash('sha256').update(value).digest();
    const valid = timingSafeEqual(hash(match?.[1] ?? ''), hash(secret));
    if (!match || !valid)
      throw new UnauthorizedException('Credencial de rotina inválida.');
    return true;
  }
}
