import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.decorators.js';
import { PaymentGateway } from './payment.gateway.js';
import {
  decryptCredential,
  digest,
  encryptCredential,
} from './payment-security.js';

function oauthConfig(): {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
} {
  const client_id = process.env.MERCADO_PAGO_CLIENT_ID;
  const client_secret = process.env.MERCADO_PAGO_CLIENT_SECRET;
  const redirect_uri = process.env.MERCADO_PAGO_REDIRECT_URI;
  if (!client_id || !client_secret || !redirect_uri)
    throw new ServiceUnavailableException(
      'Configure a aplicação OAuth do Mercado Pago.',
    );
  return { client_id, client_secret, redirect_uri };
}

@Injectable()
export class PaymentAccountsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaymentGateway) private readonly gateway: PaymentGateway,
  ) {}

  async authorize(actor: AuthenticatedUser, requestedOwner?: string) {
    const ownerId = requestedOwner ?? actor.id;
    if (actor.role !== 'admin' && actor.id !== ownerId)
      throw new ForbiddenException(
        'Você não pode alterar a conta de outro responsável.',
      );
    const owner = await this.prisma.user.findUnique({ where: { id: ownerId } });
    if (!owner?.active)
      throw new BadRequestException('O responsável informado não está ativo.');
    const config = oauthConfig();
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    await this.prisma.oAuthState.create({
      data: {
        ownerId,
        stateHash: digest(state),
        verifierEncrypted: encryptCredential(verifier),
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    const url = new URL('https://auth.mercadopago.com/authorization');
    for (const [key, value] of Object.entries({
      client_id: config.client_id,
      response_type: 'code',
      platform_id: 'mp',
      redirect_uri: config.redirect_uri,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }))
      url.searchParams.set(key, value);
    return { authorizationUrl: url.toString(), expiresInSeconds: 600 };
  }

  async callback(state: string, code: string) {
    if (
      typeof state !== 'string' ||
      typeof code !== 'string' ||
      !state ||
      !code ||
      state.length > 256 ||
      code.length > 2048
    )
      throw new BadRequestException('A autorização de pagamento é inválida.');
    const stateHash = digest(state);
    const authorization = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.oAuthState.updateMany({
        where: {
          stateHash,
          usedAt: null,
          expiresAt: { gt: new Date() },
          owner: { active: true },
        },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1)
        throw new BadRequestException(
          'A autorização expirou ou já foi utilizada. Conecte a conta novamente.',
        );
      return tx.oAuthState.findUniqueOrThrow({ where: { stateHash } });
    });
    const token = await this.gateway.exchangeOAuth({
      ...oauthConfig(),
      grant_type: 'authorization_code',
      code,
      code_verifier: decryptCredential(authorization.verifierEncrypted),
    });
    const merchant = await this.gateway.merchant(token.access_token);
    if (String(merchant.id) !== String(token.user_id))
      throw new BadRequestException(
        'A conta autorizada não corresponde às credenciais recebidas.',
      );
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${authorization.ownerId}))`;
      const owner = await tx.user.findUnique({
        where: { id: authorization.ownerId },
      });
      if (!owner?.active)
        throw new BadRequestException(
          'O responsável pela conta não está ativo.',
        );
      await tx.paymentAccount.updateMany({
        where: { ownerId: owner.id, active: true },
        data: { active: false },
      });
      const account = await tx.paymentAccount.create({
        data: {
          ownerId: owner.id,
          merchantId: String(token.user_id),
          publicKey: token.public_key,
          accessTokenEncrypted: encryptCredential(token.access_token),
          refreshTokenEncrypted: token.refresh_token
            ? encryptCredential(token.refresh_token)
            : null,
          tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: owner.id,
          entityType: 'payment_account',
          entityId: account.id,
          action: 'payment_account.connected',
          metadata: { merchantId: account.merchantId },
        },
      });
      return {
        id: account.id,
        merchantId: account.merchantId,
        publicKey: account.publicKey,
        connected: true,
      };
    });
    return result;
  }

  async status(actor: AuthenticatedUser, ownerId = actor.id) {
    if (
      typeof ownerId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        ownerId,
      )
    )
      throw new BadRequestException('O responsável informado é inválido.');
    if (actor.role !== 'admin' && actor.id !== ownerId)
      throw new ForbiddenException(
        'Você não pode consultar a conta de outro responsável.',
      );
    const account = await this.prisma.paymentAccount.findFirst({
      where: { ownerId, active: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true, merchantId: true, publicKey: true },
    });
    return account ? { ...account, connected: true } : { connected: false };
  }

  async accessToken(accountId: string): Promise<string> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${accountId}))`;
        const account = await tx.paymentAccount.findUniqueOrThrow({
          where: { id: accountId },
        });
        if (
          !account.tokenExpiresAt ||
          account.tokenExpiresAt.getTime() > Date.now() + 60_000
        )
          return decryptCredential(account.accessTokenEncrypted);
        if (!account.refreshTokenEncrypted)
          throw new ServiceUnavailableException(
            'O organizador precisa reconectar sua conta de pagamento.',
          );
        const token = await this.gateway.exchangeOAuth({
          ...oauthConfig(),
          grant_type: 'refresh_token',
          refresh_token: decryptCredential(account.refreshTokenEncrypted),
        });
        if (String(token.user_id) !== account.merchantId)
          throw new ServiceUnavailableException(
            'As credenciais renovadas não correspondem à conta organizadora.',
          );
        await tx.paymentAccount.update({
          where: { id: account.id },
          data: {
            accessTokenEncrypted: encryptCredential(token.access_token),
            refreshTokenEncrypted: token.refresh_token
              ? encryptCredential(token.refresh_token)
              : account.refreshTokenEncrypted,
            tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
            publicKey: token.public_key,
          },
        });
        return token.access_token;
      },
      { timeout: 20_000, maxWait: 20_000 },
    );
  }
}
