import { describe, expect, it } from 'vitest';
import { participantFinancial } from './participant-financial.js';

const consolidate = (statuses: string[], free = false, history = false) =>
  participantFinancial(
    free ? 0 : 2500,
    statuses.map((status) => ({ status })),
    history,
  );

describe('Situação financeira independente da inscrição', () => {
  it.each([
    [['rejected', 'approved'], 'approved'],
    [['refunded', 'approved'], 'approved'],
    [['approved', 'in_mediation'], 'in_mediation'],
    [['rejected', 'pending'], 'pending'],
    [['refunded', 'authorized'], 'authorized'],
    [['refunded', 'rejected'], 'refunded'],
    [[], 'unpaid'],
  ])('consolida %j como %s', (statuses, expected) => {
    expect(consolidate(statuses).financialStatus).toBe(expected);
  });
  it('preserva a última tentativa e a compatibilidade', () => {
    expect(consolidate(['rejected', 'approved'])).toMatchObject({
      paymentStatus: 'rejected',
      latestPaymentStatus: 'rejected',
      financialStatus: 'approved',
    });
  });
  it('prioriza gratuidade, sem esconder a última tentativa nem alertas', () => {
    expect(consolidate(['in_mediation'], true)).toEqual({
      paymentStatus: 'free',
      financialStatus: 'free',
      latestPaymentStatus: 'in_mediation',
      financialWarnings: ['dispute_history'],
    });
  });
  it('alerta múltiplas aprovações e histórico inclusive após mediação resolvida', () => {
    expect(
      consolidate(['approved', 'approved'], false, true).financialWarnings,
    ).toEqual(['multiple_approvals', 'dispute_history']);
    expect(consolidate(['approved', 'charged_back']).financialWarnings).toEqual(
      ['dispute_history'],
    );
  });
  it('não depende da ordem de chegada entre tentativas com prioridade maior', () => {
    for (const statuses of [
      ['approved', 'rejected', 'in_mediation'],
      ['rejected', 'in_mediation', 'approved'],
      ['in_mediation', 'approved', 'rejected'],
    ])
      expect(consolidate(statuses).financialStatus).toBe('in_mediation');
  });
});
