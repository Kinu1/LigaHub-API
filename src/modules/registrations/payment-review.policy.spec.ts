import { describe, expect, it } from 'vitest';
import { confirmationBlock } from './payment-review.policy.js';

const now = new Date('2026-10-27T12:00:00Z');
const record = () => ({
  status: 'payment_review',
  suspendedAt: null as Date | null,
  cancellationRequestedAt: null as Date | null,
  event: {
    owner: { active: true },
    status: 'published',
    startsAt: new Date(now.getTime() + 1000),
    capacity: 1,
  },
});
describe('Precedência dos motivos de revisão', () => {
  it('exige chamada manual explícita para payment_review', () => {
    expect(confirmationBlock(record(), 0, now)).toBe(
      'invalid_registration_state',
    );
    expect(confirmationBlock(record(), 0, now, true)).toBeNull();
  });
  it.each(['reserved', 'expired'])(
    'não usa a revisão manual para %s',
    (status) => {
      const r = { ...record(), status };
      expect(confirmationBlock(r, 0, now, true)).toBe(
        'invalid_registration_state',
      );
      expect(confirmationBlock(r, 0, now)).toBeNull();
    },
  );
  it('prioriza decisões do participante sobre evento e lotação', () => {
    const r = record();
    r.status = 'canceled';
    r.suspendedAt = now;
    r.cancellationRequestedAt = now;
    r.event.owner.active = false;
    r.event.status = 'draft';
    r.event.startsAt = now;
    expect(confirmationBlock(r, 1, now, true)).toBe('registration_canceled');
    r.status = 'payment_review';
    expect(confirmationBlock(r, 1, now, true)).toBe(
      'participant_cancellation_requested',
    );
    r.cancellationRequestedAt = null;
    expect(confirmationBlock(r, 1, now, true)).toBe('registration_suspended');
    r.suspendedAt = null;
    expect(confirmationBlock(r, 1, now, true)).toBe('owner_inactive');
    r.event.owner.active = true;
    expect(confirmationBlock(r, 1, now, true)).toBe('event_unpublished');
    r.event.status = 'published';
    expect(confirmationBlock(r, 1, now, true)).toBe('event_started');
    r.event.startsAt = new Date(now.getTime() + 1);
    expect(confirmationBlock(r, 1, now, true)).toBe('capacity_full');
  });
});
