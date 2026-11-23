import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
export type Db = Prisma.TransactionClient;
export type Role = 'admin' | 'organizer';
export async function eventAccess(
  tx: Db,
  eventId: string,
  userId: string,
  role: Role,
) {
  const event = await tx.academicEvent.findUnique({ where: { id: eventId } });
  if (!event) throw new NotFoundException('Evento não encontrado.');
  if (role !== 'admin' && event.ownerId !== userId)
    throw new ForbiddenException('Evento de outro organizador.');
  return event;
}
export async function campaignAccess(
  tx: Db,
  eventId: string,
  id: string,
  userId: string,
  role: Role,
  lock = false,
  draft = false,
) {
  await eventAccess(tx, eventId, userId, role);
  if (lock)
    await tx.$queryRaw`SELECT id FROM communication_campaigns WHERE id=${id}::uuid FOR UPDATE`;
  const campaign = await tx.communicationCampaign.findUnique({ where: { id } });
  if (!campaign || campaign.eventId !== eventId)
    throw new NotFoundException('Campanha não encontrada.');
  if (draft && campaign.status !== 'draft')
    throw new ConflictException('Campanha já congelada.');
  return campaign;
}
export type Audience = {
  eventId: string;
  audienceType: string;
  audienceCategoryIds: string[];
  confirmedOnly: boolean;
};
export function audienceWhere(
  c: Audience,
  now = new Date(),
): Prisma.RegistrationWhereInput {
  return {
    eventId: c.eventId,
    suspendedAt: null,
    ...(c.audienceType === 'categories'
      ? c.audienceCategoryIds.includes('geral')
        ? {
            AND: [
              {
                OR: [
                  { registrationTypeId: { in: c.audienceCategoryIds } },
                  { registrationTypeId: null },
                ],
              },
            ],
          }
        : { registrationTypeId: { in: c.audienceCategoryIds } }
      : {}),
    ...(c.confirmedOnly || c.audienceType === 'confirmed_only'
      ? { status: 'confirmed' }
      : {
          OR: [
            { status: { in: ['confirmed', 'payment_review'] } },
            { status: 'reserved', reservationExpiresAt: { gt: now } },
          ],
        }),
  };
}
export function eligible(
  r: {
    status: string;
    suspendedAt: Date | null;
    reservationExpiresAt: Date;
    eventId: string;
    registrationTypeId: string | null;
  },
  c: Audience,
  now = new Date(),
) {
  return (
    r.eventId === c.eventId &&
    !r.suspendedAt &&
    (c.audienceType !== 'categories' ||
      c.audienceCategoryIds.includes(r.registrationTypeId ?? 'geral')) &&
    (c.confirmedOnly || c.audienceType === 'confirmed_only'
      ? r.status === 'confirmed'
      : r.status === 'confirmed' ||
        r.status === 'payment_review' ||
        (r.status === 'reserved' && r.reservationExpiresAt > now))
  );
}
export function validateCategories(
  event: { registrationTypes: unknown },
  type: string,
  ids: string[],
) {
  const categories = Array.isArray(event.registrationTypes)
    ? event.registrationTypes
    : [];
  const known = new Set(
    categories.length
      ? categories.map((x: { id?: string }) => x.id)
      : ['geral'],
  );
  if (
    (type === 'categories' && !ids.length) ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !known.has(id))
  )
    throw new BadRequestException('Categorias inválidas para este evento.');
}
export const terminalRecipientStates = [
  'delivered',
  'failed',
  'skipped',
  'unconfirmed_after24h',
] as const;
