import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { isEmail, isUUID } from 'class-validator';
import type { PaymentAttempt, Prisma } from '../../generated/prisma/client.js';
import { decryptCredential, digest } from './payment-security.js';
import { organizerPayoutAmount } from './pix-pricing.js';

export const pixKeyTypes = [
  'CPF',
  'CNPJ',
  'EMAIL',
  'PHONE',
  'PIX_CODE',
] as const;
export function payoutMode(): 'manual' | 'automatic' {
  const mode = process.env.MERCADO_PAGO_PAYOUT_MODE ?? 'manual';
  if (mode !== 'manual' && mode !== 'automatic')
    throw new ServiceUnavailableException('O modo de repasse está inválido.');
  return mode;
}
export type PixDestination = {
  ownerId: string;
  keyType: (typeof pixKeyTypes)[number];
  key: string;
  fingerprint: string;
};

function validDocument(value: string, length: number): boolean {
  if (!new RegExp(`^\\d{${length}}$`).test(value) || /^(\d)\1+$/.test(value))
    return false;
  const digit = (base: string) => {
    let weight = 2;
    let sum = 0;
    for (let i = base.length - 1; i >= 0; i--) {
      sum += Number(base[i]) * weight;
      weight = length === 11 ? weight + 1 : weight === 9 ? 2 : weight + 1;
    }
    const rest = sum % 11;
    return rest < 2 ? '0' : String(11 - rest);
  };
  const base = value.slice(0, -2);
  return value === base + digit(base) + digit(base + digit(base));
}

export function normalizePixKey(keyType: string, raw: string): string {
  if (
    typeof raw !== 'string' ||
    raw.length > 254 ||
    !pixKeyTypes.includes(keyType as PixDestination['keyType'])
  )
    throw new BadRequestException('Informe um tipo e uma chave Pix válidos.');
  let key = raw.trim();
  if (['CPF', 'CNPJ'].includes(keyType)) key = key.replace(/[./-]/g, '');
  if (keyType === 'EMAIL' || keyType === 'PIX_CODE') key = key.toLowerCase();
  const valid =
    keyType === 'CPF'
      ? validDocument(key, 11)
      : keyType === 'CNPJ'
        ? validDocument(key, 14)
        : keyType === 'EMAIL'
          ? isEmail(key)
          : keyType === 'PHONE'
            ? /^\+[1-9]\d{7,14}$/.test(key)
            : isUUID(key, '4');
  if (!valid)
    throw new BadRequestException(
      'A chave Pix não corresponde ao tipo informado.',
    );
  return key;
}

export const destinationFingerprint = (
  ownerId: string,
  keyType: string,
  key: string,
) => digest(JSON.stringify([ownerId, keyType, key]));

export function platformPixAccountId(): string | undefined {
  const id = process.env.MERCADO_PAGO_PIX_PLATFORM_ACCOUNT_ID;
  if (!id) return undefined;
  if (!isUUID(id, '4'))
    throw new ServiceUnavailableException(
      'A conta de recebimento da plataforma está inválida.',
    );
  return id;
}

export function readPixDestination(encrypted: string): PixDestination {
  const value = JSON.parse(decryptCredential(encrypted)) as PixDestination;
  if (
    !value ||
    !isUUID(value.ownerId, '4') ||
    normalizePixKey(value.keyType, value.key) !== value.key ||
    destinationFingerprint(value.ownerId, value.keyType, value.key) !==
      value.fingerprint
  )
    throw new ServiceUnavailableException(
      'O destino do repasse está inválido.',
    );
  return value;
}

// Executada na mesma transação que salva a confirmação validada pelo provedor.
export async function enqueuePixPayout(
  tx: Prisma.TransactionClient,
  payment: PaymentAttempt,
): Promise<void> {
  if (
    payment.status !== 'approved' ||
    payment.method !== 'pix' ||
    !payment.payoutOwnerId ||
    !payment.payoutDestinationEncrypted
  )
    return;
  await tx.pixPayout.upsert({
    where: { registrationId: payment.registrationId },
    update: {},
    create: {
      paymentId: payment.id,
      registrationId: payment.registrationId,
      ownerId: payment.payoutOwnerId,
      destinationEncrypted: payment.payoutDestinationEncrypted,
      amountInCents: organizerPayoutAmount(payment),
    },
  });
}
