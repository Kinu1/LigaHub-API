import type { Prisma } from '../../generated/prisma/client.js';

const detailKeys = [
  'previousActive',
  'active',
  'role',
  'method',
  'amountInCents',
  'status',
  'reason',
  'count',
  'expiresAt',
  'eventId',
  'paymentId',
  'providerPaymentId',
  'merchantId',
] as const;

const eventFields = new Set([
  'title',
  'description',
  'location',
  'startsAt',
  'endsAt',
  'registrationDeadline',
  'reservationMinutes',
  'capacity',
  'priceInCents',
  'form',
  'ownerId',
]);

export function auditDetails(metadata: Prisma.JsonValue) {
  const details: Record<string, string | number | boolean | string[]> = {};
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    return details;
  for (const key of detailKeys) {
    const value = metadata[key];
    if (['string', 'number', 'boolean'].includes(typeof value))
      details[key] = value as string | number | boolean;
  }
  if (Array.isArray(metadata.fields))
    details.fields = metadata.fields.filter(
      (field): field is string =>
        typeof field === 'string' && eventFields.has(field),
    );
  return details;
}
