export type FinancialWarning = 'multiple_approvals' | 'dispute_history';

type Attempt = { status: string };

// Attempts must be ordered by creation date and ID, newest first. Provider
// notification arrival/update time never decides which attempt is the latest.
export function participantFinancial(
  priceInCents: number,
  payments: readonly Attempt[],
  hasDisputeHistory = false,
) {
  const latestPaymentStatus = payments[0]?.status ?? 'unpaid';
  const financialWarnings: FinancialWarning[] = [];
  if (payments.filter((p) => p.status === 'approved').length > 1)
    financialWarnings.push('multiple_approvals');
  if (
    hasDisputeHistory ||
    payments.some((p) => ['in_mediation', 'charged_back'].includes(p.status))
  )
    financialWarnings.push('dispute_history');
  const processing = payments.find((p) =>
    ['created', 'pending', 'in_process', 'authorized'].includes(p.status),
  );
  const financialStatus =
    priceInCents === 0
      ? 'free'
      : payments.some((p) => p.status === 'in_mediation')
        ? 'in_mediation'
        : payments.some((p) => p.status === 'approved')
          ? 'approved'
          : (processing?.status ?? latestPaymentStatus);
  return {
    // Compatibility: this remains the last attempt (or free registration).
    paymentStatus: priceInCents === 0 ? 'free' : latestPaymentStatus,
    financialStatus,
    latestPaymentStatus,
    financialWarnings,
  };
}
