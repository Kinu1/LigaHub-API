import { ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma.service.js';
import { decryptCredential, encryptCredential } from './payment-security.js';
import { platformPixAccountId } from './pix-payout.policy.js';

export async function pixRouting(
  db: Prisma.TransactionClient | PrismaService,
  ownerId: string,
) {
  const accountId = platformPixAccountId();
  if (!accountId) return null;
  const account = await db.paymentAccount.findFirst({
    where: { id: accountId, active: true },
  });
  if (
    !account ||
    account.isTest !==
      ((process.env.MERCADO_PAGO_TEST_MODE ?? 'true') === 'true')
  )
    throw new ServiceUnavailableException(
      'A conta de recebimento da plataforma não está configurada para este ambiente.',
    );
  const destination = await db.organizerPixDestination.findUnique({
    where: { ownerId },
  });
  if (!destination?.approvedAt)
    throw new ServiceUnavailableException(
      'O organizador precisa cadastrar uma chave Pix e aguardar sua aprovação para receber inscrições.',
    );
  return {
    account,
    snapshot: encryptCredential(
      JSON.stringify({
        ownerId,
        keyType: destination.keyType,
        key: decryptCredential(destination.keyEncrypted),
        fingerprint: destination.fingerprint,
      }),
    ),
  };
}
