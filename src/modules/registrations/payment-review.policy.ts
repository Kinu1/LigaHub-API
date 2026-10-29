// Prioriza decisões do participante, regras do responsável/evento, estado e vagas.
export const reviewMessages = {
  registration_canceled: 'A inscrição está cancelada.',
  participant_cancellation_requested:
    'O participante solicitou o cancelamento. Resolva a solicitação antes de confirmar.',
  registration_suspended:
    'A inscrição está suspensa. Remova a suspensão antes de confirmar.',
  owner_inactive: 'O organizador responsável está inativo.',
  event_unpublished: 'O evento não está publicado.',
  event_started: 'O evento já começou.',
  invalid_registration_state: 'O estado da inscrição não permite confirmação.',
  capacity_full:
    'Todas as vagas estão ocupadas por confirmações ou reservas vigentes.',
} as const;
export type ReviewReason = keyof typeof reviewMessages;
export function confirmationBlock(
  registration: {
    status: string;
    suspendedAt: Date | null;
    cancellationRequestedAt: Date | null;
    event: {
      owner: { active: boolean } | null;
      status: string;
      startsAt: Date | null;
      capacity: number;
    };
  },
  occupied: number,
  now: Date,
  manual = false,
): ReviewReason | null {
  if (registration.status === 'canceled') return 'registration_canceled';
  if (registration.cancellationRequestedAt)
    return 'participant_cancellation_requested';
  if (registration.suspendedAt) return 'registration_suspended';
  if (!registration.event.owner?.active) return 'owner_inactive';
  if (registration.event.status !== 'published') return 'event_unpublished';
  if (registration.event.startsAt && registration.event.startsAt <= now)
    return 'event_started';
  if (
    !(manual ? ['payment_review'] : ['reserved', 'expired']).includes(
      registration.status,
    )
  )
    return 'invalid_registration_state';
  if (occupied >= registration.event.capacity) return 'capacity_full';
  return null;
}
