import { ArgumentsHost, BadRequestException, Catch, HttpException, ValidationPipe, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import type { ValidationError } from 'class-validator';
import { Prisma } from '../generated/prisma/client.js';
import { EmailAlreadyInUseError } from '../modules/users/errors/email-already-in-use.error.js';

export function validationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    exceptionFactory: (errors) => {
      const flatten = (items: ValidationError[], prefix = ''): { field: string; message: string }[] => items.flatMap((item) => {
        const field = prefix ? `${prefix}.${item.property}` : item.property;
        return [
          ...Object.keys(item.constraints ?? {}).map(() => ({ field, message: `O campo ${field} é inválido ou não é permitido.` })),
          ...flatten(item.children ?? [], field),
        ];
      });
      return new BadRequestException({ message: 'Dados inválidos.', errors: flatten(errors) });
    },
  });
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let message: string | string[] = 'Não foi possível concluir a operação.';
    let errors: unknown;
    if (error instanceof HttpException) {
      status = error.getStatus();
      const body = error.getResponse();
      if (typeof body === 'string') message = body;
      else {
        const payload = body as { message?: string | string[]; errors?: unknown };
        message = payload.message ?? message;
        errors = payload.errors;
      }
      if (status === 429) message = 'Muitas solicitações. Aguarde antes de tentar novamente.';
      if (status === 404 && message === 'Cannot GET /') message = 'Recurso não encontrado.';
    } else if (error instanceof EmailAlreadyInUseError) {
      status = 409;
      message = error.message;
    } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      status = 409;
      const target = error.meta?.target;
      message = Array.isArray(target) && target.includes('role') ? 'Já existe um responsável cadastrado para a liga.' : 'Já existe um registro com estes dados únicos.';
    } else if (error instanceof Error && new Set([
      'O ID do usuário é obrigatório.', 'O nome do usuário é obrigatório.',
      'O e-mail do usuário é inválido.', 'O papel do usuário é inválido.',
      'A senha deve ter entre 6 e 128 caracteres.',
    ]).has(error.message)) {
      status = 400;
      message = error.message;
    }
    if (status === 404 && (typeof message !== 'string' || message.startsWith('Cannot '))) message = 'Recurso não encontrado.';
    response.status(status).json({ statusCode: status, message, ...(errors ? { errors } : {}), timestamp: new Date().toISOString() });
  }
}
