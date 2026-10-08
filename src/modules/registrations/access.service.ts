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
import { EmailGateway } from '../notifications/email.gateway.js';

@Injectable()
export class RegistrationAccessService {
  private readonly logger = new Logger(RegistrationAccessService.name);
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmailGateway) private readonly email: EmailGateway,
  ) {}
  async sendLink(id: string) {
    if (process.env.EMAIL_DELIVERY_ENABLED !== 'true') return;
    const token = randomBytes(32).toString('base64url');
    const record = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${id}::uuid FOR UPDATE`;
      const registration = await tx.registration.findUniqueOrThrow({
        where: { id },
        include: { event: true },
      });
      // Legacy records receive a management credential once; only its encrypted value is persisted.
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
      await tx.registrationAccessLink.deleteMany({
        where: { registrationId: id, expiresAt: { lte: new Date() } },
      });
      await tx.registrationAccessLink.create({
        data: {
          registrationId: id,
          tokenHash: digest(token),
          expiresAt: new Date(Date.now() + 900_000),
        },
      });
      return registration;
    });
    const base = new URL(process.env.FRONTEND_URL ?? '');
    if (
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      (base.protocol !== 'https:' &&
        !(base.protocol === 'http:' && base.hostname === 'localhost'))
    )
      throw new Error('FRONTEND_URL inválida.');
    const url = new URL(`/inscricao/${id}`, base);
    url.hash = new URLSearchParams({ access: token }).toString();
    const from = process.env.EMAIL_FROM;
    if (!from || /[\r\n]/.test(from)) throw new Error('EMAIL_FROM inválido.');
    await this.email.send(
      {
        from,
        to: [record.email],
        subject: 'Acesse sua inscrição — LigaHub',
        text: `Olá, ${record.name}!\n\nAcompanhe sua inscrição em ${record.event.title}:\n${url.toString()}\n\nEste link é pessoal, de uso único e expira em 15 minutos. Ele não confirma pagamento. Caso não tenha solicitado, ignore esta mensagem.\nLigaHub`,
      },
      `access-${digest(token)}`,
    );
  }
  async safeSend(id: string) {
    try {
      await this.sendLink(id);
    } catch {
      this.logger.warn(
        'Não foi possível enviar um link de acesso. O participante pode solicitar novamente.',
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
