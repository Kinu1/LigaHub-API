import { isEmail } from 'class-validator';
import { decryptCredential } from '../payments/payment-security.js';
import type { EmailMessage } from './confirmation-email.js';

export function readPayload(encrypted: string): Record<string, unknown> {
  const value: unknown = JSON.parse(decryptCredential(encrypted));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Payload inválido.');
  return value as Record<string, unknown>;
}
export function readMessage(encrypted: string): EmailMessage {
  const { message } = readPayload(encrypted);
  if (!message || typeof message !== 'object')
    throw new Error('Payload inválido.');
  const m = message as EmailMessage;
  if (
    typeof m.from !== 'string' ||
    !m.from ||
    /[\r\n]/.test(m.from) ||
    !Array.isArray(m.to) ||
    m.to.length !== 1 ||
    typeof m.to[0] !== 'string' ||
    !isEmail(m.to[0]) ||
    typeof m.subject !== 'string' ||
    !m.subject ||
    /[\r\n]/.test(m.subject) ||
    typeof m.text !== 'string' ||
    !m.text
  )
    throw new Error('Payload inválido.');
  return m;
}
export function validateConfirmation(
  payload: Record<string, unknown>,
  registrationId: string,
) {
  if (
    payload.registrationId !== registrationId ||
    typeof payload.to !== 'string' ||
    !isEmail(payload.to) ||
    !['name', 'eventTitle', 'location', 'token'].every(
      (k) => typeof payload[k] === 'string',
    ) ||
    !payload.token ||
    (payload.startsAt !== undefined &&
      (typeof payload.startsAt !== 'string' ||
        !Number.isFinite(Date.parse(payload.startsAt))))
  )
    throw new Error('Payload inválido.');
}
