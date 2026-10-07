import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma.service.js';
import {
  CurrentUser,
  Roles,
  type AuthenticatedUser,
} from '../auth/auth.decorators.js';
import {
  CreateUserHttpDto,
  UpdateUserStatusDto,
} from './dto/create-user-http.dto.js';
import { UsersService } from './users.service.js';

const publicSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
} as const;

@ApiTags('Usuários')
@ApiBearerAuth()
@Roles('admin')
@Controller('users')
export class UsersController {
  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}
  @Post()
  create(
    @Body() input: CreateUserHttpDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.create(input, actor.id);
  }
  @Get()
  list() {
    return this.prisma.user.findMany({
      select: publicSelect,
      orderBy: { createdAt: 'asc' },
    });
  }
  @Patch(':id/status')
  async status(
    @Param(
      'id',
      new ParseUUIDPipe({
        exceptionFactory: () =>
          new BadRequestException('O ID do usuário é inválido.'),
      }),
    )
    id: string,
    @Body() input: UpdateUserStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!input.active && id === actor.id)
      throw new BadRequestException(
        'Você não pode suspender sua própria conta.',
      );
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(8712026)`;
      const account = await tx.user.findUnique({ where: { id } });
      if (!account) throw new NotFoundException('Usuário não encontrado.');
      if (account.active && !input.active && account.role === 'admin') {
        const count = await tx.user.count({
          where: { role: 'admin', active: true },
        });
        if (count <= 1)
          throw new BadRequestException(
            'Não é possível suspender o último administrador ativo.',
          );
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          entityType: 'user',
          entityId: id,
          action: 'status_updated',
          metadata: { previousActive: account.active, active: input.active },
        },
      });
      return tx.user.update({
        where: { id },
        data: {
          active: input.active,
          ...(account.active !== input.active
            ? { tokenVersion: { increment: 1 } }
            : {}),
        },
        select: publicSelect,
      });
    });
  }
}
