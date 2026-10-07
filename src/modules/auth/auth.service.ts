import {
  Inject,
  Injectable,
  UnauthorizedException,
  type OnModuleInit,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma.service.js';
import { PasswordHasher } from '../users/password-hasher.js';
import type { AuthenticatedUser } from './auth.decorators.js';

export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32)
    throw new Error('JWT_SECRET deve conter pelo menos 32 caracteres.');
  return secret;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash!: string;
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {}

  async onModuleInit(): Promise<void> {
    jwtSecret();
    this.dummyHash = await this.hasher.hash(randomBytes(32).toString('hex'));
  }

  async login(email: string, password: string) {
    const account = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    const matches = await this.hasher.verify(
      password,
      account?.passwordHash ?? this.dummyHash,
    );
    if (!account || !account.active || !matches) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }
    const accessToken = await this.jwt.signAsync(
      { sub: account.id, version: account.tokenVersion },
      {
        secret: jwtSecret(),
        expiresIn: '15m',
        algorithm: 'HS256',
        issuer: 'ligahub-api',
        audience: 'ligahub',
      },
    );
    await this.prisma.auditLog.create({
      data: {
        actorId: account.id,
        entityType: 'user',
        entityId: account.id,
        action: 'login',
      },
    });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: 900,
      user: {
        id: account.id,
        name: account.name,
        email: account.email,
        role: account.role,
      },
    };
  }

  async logout(user: AuthenticatedUser): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { tokenVersion: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          entityType: 'user',
          entityId: user.id,
          action: 'logout',
        },
      });
    });
  }
}
