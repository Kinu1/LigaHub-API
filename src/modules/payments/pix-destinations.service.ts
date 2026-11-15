import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.decorators.js';
import { decryptCredential, encryptCredential } from './payment-security.js';
import {
  destinationFingerprint,
  normalizePixKey,
  platformPixAccountId,
} from './pix-payout.policy.js';

@Injectable()
export class PixDestinationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private owner(actor: AuthenticatedUser, requested?: string): string {
    const id = requested ?? actor.id;
    if (actor.role !== 'admin' && id !== actor.id)
      throw new ForbiddenException(
        'Você não pode alterar o recebimento de outro organizador.',
      );
    return id;
  }

  async status(actor: AuthenticatedUser, requested?: string) {
    const ownerId = this.owner(actor, requested);
    const destination = await this.prisma.organizerPixDestination.findUnique({
      where: { ownerId },
    });
    // Somente uma consulta autenticada do próprio organizador ou administrador obtém a chave.
    return {
      platformPix: !!platformPixAccountId(),
      automaticPayoutsEnabled:
        process.env.MERCADO_PAGO_PAYOUTS_ENABLED === 'true',
      destination: destination
        ? {
            id: destination.id,
            ownerId,
            keyType: destination.keyType,
            key: decryptCredential(destination.keyEncrypted),
            approved: !!destination.approvedAt,
          }
        : null,
    };
  }

  async save(
    actor: AuthenticatedUser,
    keyType: string,
    rawKey: string,
    requested?: string,
  ) {
    const ownerId = this.owner(actor, requested);
    const key = normalizePixKey(keyType, rawKey);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))`;
      const owner = await tx.user.findUnique({ where: { id: ownerId } });
      if (!owner?.active || owner.role !== 'organizer')
        throw new BadRequestException(
          'Escolha um organizador ativo para receber os repasses.',
        );
      const fingerprint = destinationFingerprint(ownerId, keyType, key);
      const previous = await tx.organizerPixDestination.findUnique({
        where: { ownerId },
      });
      if (previous?.fingerprint === fingerprint)
        return { saved: true, approved: !!previous.approvedAt };
      const data = {
        id: randomUUID(),
        keyType,
        keyEncrypted: encryptCredential(key),
        fingerprint,
        approvedAt: null,
        approvedBy: null,
      };
      await tx.organizerPixDestination.upsert({
        where: { ownerId },
        update: data,
        create: { ownerId, ...data },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          entityType: 'pix_destination',
          entityId: ownerId,
          action: 'pix_destination.updated',
        },
      });
      return { saved: true, approved: false };
    });
  }

  async approve(
    actor: AuthenticatedUser,
    ownerId: string,
    destinationId: string,
  ) {
    if (actor.role !== 'admin')
      throw new ForbiddenException(
        'Somente administradores aprovam os destinos de repasse.',
      );
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))`;
      const owner = await tx.user.findUnique({ where: { id: ownerId } });
      if (!owner?.active || owner.role !== 'organizer')
        throw new BadRequestException('Organizador indisponível.');
      const changed = await tx.organizerPixDestination.updateMany({
        where: { ownerId, id: destinationId },
        data: { approvedAt: new Date(), approvedBy: actor.id },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          'A chave Pix mudou. Confira novamente antes de aprovar.',
        );
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          entityType: 'pix_destination',
          entityId: ownerId,
          action: 'pix_destination.approved',
        },
      });
      return { approved: true };
    });
  }
}
