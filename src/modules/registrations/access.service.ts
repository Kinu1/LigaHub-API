import {
  Inject,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma.service.js';
import {
  digest,
  encryptCredential,
  decryptCredential,
} from '../payments/payment-security.js';
import { AccessEmailProcessor } from '../notifications/access-email.processor.js';
import { readMessage } from '../notifications/outbox-payload.js';
import { renderAccessEmail } from '../notifications/access-email.js';

@Injectable()
export class RegistrationAccessService {
  private readonly logger = new Logger(RegistrationAccessService.name);
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AccessEmailProcessor) private readonly emails: AccessEmailProcessor,
  ) {}
  async sendLink(id: string) {
    if (process.env.EMAIL_DELIVERY_ENABLED !== 'true') return;
    this.emails.preflight();
    const token = randomBytes(32).toString('base64url');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${id}::uuid FOR UPDATE`;
      const registration = await tx.registration.findUniqueOrThrow({
        where: { id },
        include: { event: true },
      });
      // Registros legados recebem uma credencial de gestão; somente o valor criptografado é persistido.
      if (!registration.manageTokenEncrypted) {
        const management = randomBytes(32).toString('base64url');
        await tx.registration.update({
          where: { id },
          data: {
            manageTokenHash: digest(management),
            manageTokenEncrypted: encryptCredential(management),
          },
        });
      }
      const message = renderAccessEmail({
        registrationId: id,
        to: registration.email,
        name: registration.name,
        eventTitle: registration.event.title,
        token,
      });
      const payloadEncrypted = encryptCredential(JSON.stringify({ message }));
      readMessage(payloadEncrypted);
      const expiresAt = new Date(Date.now() + 900_000);
      await tx.registrationAccessLink.create({
        data: {
          registrationId: id,
          tokenHash: digest(token),
          expiresAt,
          email: { create: { payloadEncrypted, expiresAt } },
        },
      });
    });
    await this.emails.processBatch(id);
  }
  async safeSend(id: string) {
    try {
      await this.sendLink(id);
    } catch {
      this.logger.warn(
        'Não foi possível preparar ou enviar um link de acesso.',
      );
    }
  }
  async recover(publicId: string, email: string) {
    const record = await this.prisma.registration.findFirst({
      where: { email: email.trim().toLowerCase(), event: { publicId } },
    });
    if (record) await this.safeSend(record.id);
    return {
      message:
        'Se houver uma inscrição com esses dados, enviaremos um link de acesso. Verifique também a pasta de spam.',
    };
  }
  async exchange(id: string, token: string) {
    return this.prisma.$transaction(async (tx) => {
      const link = await tx.registrationAccessLink.findUnique({
        where: { tokenHash: digest(token) },
      });
      if (
        !link ||
        link.registrationId !== id ||
        link.usedAt ||
        link.expiresAt <= new Date()
      )
        throw new UnauthorizedException(
          'O link expirou ou já foi utilizado. Solicite outro.',
        );
      const consumed = await tx.registrationAccessLink.updateMany({
        where: { id: link.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1)
        throw new UnauthorizedException('Link já utilizado.');
      const registration = await tx.registration.findUniqueOrThrow({
        where: { id },
      });
      if (!registration.manageTokenEncrypted)
        throw new UnauthorizedException('Solicite um novo link.');
      return decryptCredential(registration.manageTokenEncrypted);
    });
  }
}
