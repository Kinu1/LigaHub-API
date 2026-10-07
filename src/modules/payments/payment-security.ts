import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

function encryptionKey(): Buffer {
  const key = Buffer.from(
    process.env.CREDENTIALS_ENCRYPTION_KEY ?? '',
    'base64',
  );
  if (key.length !== 32)
    throw new ServiceUnavailableException(
      'Configure a chave de criptografia de credenciais com 32 bytes em base64.',
    );
  return key;
}

export function encryptCredential(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString('base64url'))
    .join('.');
}

export function decryptCredential(value: string): string {
  try {
    const [iv, tag, ciphertext, extra] = value.split('.');
    if (!iv || !tag || !ciphertext || extra)
      throw new Error('Formato inválido.');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new ServiceUnavailableException(
      'Não foi possível ler as credenciais de pagamento.',
    );
  }
}

export function verifyWebhook(
  signature: string | undefined,
  requestId: string | undefined,
  dataId: string | undefined,
  now = Date.now(),
): void {
  const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  if (!secret)
    throw new ServiceUnavailableException(
      'O segredo do webhook não foi configurado.',
    );
  if (
    typeof signature !== 'string' ||
    typeof requestId !== 'string' ||
    typeof dataId !== 'string' ||
    !signature ||
    signature.length > 512 ||
    !requestId ||
    requestId.length > 256 ||
    !dataId ||
    dataId.length > 128 ||
    !/^[a-z0-9-]+$/i.test(dataId)
  )
    throw new UnauthorizedException('Assinatura de notificação inválida.');
  const entries = signature.split(',').map((entry) => entry.trim().split('='));
  if (
    entries.filter(([key]) => key === 'ts').length !== 1 ||
    entries.filter(([key]) => key === 'v1').length !== 1
  )
    throw new UnauthorizedException('Assinatura de notificação inválida.');
  const ts = entries.find(([key]) => key === 'ts')?.[1];
  const v1 = entries.find(([key]) => key === 'v1')?.[1];
  if (!ts || !/^\d{10,13}$/.test(ts) || !v1 || !/^[a-f0-9]{64}$/i.test(v1))
    throw new UnauthorizedException('Assinatura de notificação inválida.');
  const milliseconds = ts.length <= 10 ? Number(ts) * 1000 : Number(ts);
  if (Math.abs(now - milliseconds) > 300_000)
    throw new UnauthorizedException(
      'A notificação está fora do prazo permitido.',
    );
  const expected = createHmac('sha256', secret)
    .update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(v1, 'hex')))
    throw new UnauthorizedException('Assinatura de notificação inválida.');
}

export function assertProviderPayment(
  payment: ProviderPayment,
  reference: string,
  merchantId: string,
  amountInCents: number,
  method?: string,
  installments?: number,
): void {
  const cents = Math.round(payment.transaction_amount * 100);
  if (
    payment.external_reference !== reference ||
    String(payment.collector_id) !== merchantId ||
    payment.currency_id !== 'BRL' ||
    cents !== amountInCents ||
    !Number.isFinite(payment.transaction_amount) ||
    Math.abs(payment.transaction_amount * 100 - cents) > 0.00001
  ) {
    throw new BadRequestException(
      'O pagamento recebido não corresponde à inscrição e à conta organizadora.',
    );
  }
  if (
    !payment.id ||
    !payment.date_last_updated ||
    !Number.isFinite(Date.parse(payment.date_last_updated))
  )
    throw new BadRequestException('O provedor retornou um pagamento inválido.');
  if (
    (method === 'pix' && payment.payment_method_id !== 'pix') ||
    (method === 'card' &&
      !['credit_card', 'debit_card'].includes(payment.payment_type_id ?? '')) ||
    (installments !== undefined && payment.installments !== installments)
  )
    throw new BadRequestException(
      'O meio de pagamento ou as parcelas não correspondem à tentativa.',
    );
}

export type ProviderPayment = {
  id: string | number;
  external_reference: string;
  collector_id: string | number;
  currency_id: string;
  transaction_amount: number;
  status: string;
  status_detail?: string;
  date_last_updated: string;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      qr_code_base64?: string;
      ticket_url?: string;
    };
  };
  payment_method_id?: string;
  payment_type_id?: string;
  installments?: number;
};
