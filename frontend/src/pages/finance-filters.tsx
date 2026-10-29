import { useState } from 'react';
import { labels } from '../types';
import { Notice } from '../ui';

export type PaymentFilters = {
  eventSearch: string;
  status: string;
  method: string;
  from: string;
  to: string;
};
export const emptyPaymentFilters: PaymentFilters = {
  eventSearch: '',
  status: '',
  method: '',
  from: '',
  to: '',
};
export function dayBoundary(value: string, after = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error('Informe uma data válida.');
  const [year, month, day] = value.split('-').map(Number);
  const midnight = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(midnight.getTime()) ||
    midnight.getUTCFullYear() !== year ||
    midnight.getUTCMonth() !== month - 1 ||
    midnight.getUTCDate() !== day
  )
    throw new Error('Informe uma data válida.');
  return new Date(
    midnight.getTime() + 3 * 3600000 + (after ? 86400000 : 0),
  ).toISOString();
}
export function paymentHistoryUrl(page: number, filters: PaymentFilters) {
  const params = new URLSearchParams({ page: String(page) });
  if (filters.eventSearch.trim())
    params.set('eventSearch', filters.eventSearch.trim());
  if (filters.status) params.set('status', filters.status);
  if (filters.method) params.set('method', filters.method);
  if (filters.from) params.set('from', dayBoundary(filters.from));
  if (filters.to) params.set('to', dayBoundary(filters.to, true));
  return `/payments?${params}`;
}
export const paymentStatuses = [
  'created',
  'pending',
  'in_process',
  'authorized',
  'in_mediation',
  'approved',
  'rejected',
  'cancelled',
  'refunded',
  'charged_back',
];
export function paymentFiltersFromSearch(search: string): PaymentFilters {
  const params = new URLSearchParams(search);
  const status = params.get('status') || '';
  return { ...emptyPaymentFilters, status: paymentStatuses.includes(status) ? status : '' };
}
export function FinanceFilters({
  onApply,
  initialFilters = emptyPaymentFilters,
}: {
  initialFilters?: PaymentFilters;
  onApply: (filters: PaymentFilters) => void;
}) {
  const [draft, setDraft] = useState({ ...initialFilters });
  const [error, setError] = useState('');
  const change = (key: keyof PaymentFilters, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <form
      className="filter-bar mb-6 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          if (draft.from && draft.to && draft.from > draft.to)
            throw new Error(
              'A data inicial deve ser anterior ou igual à final.',
            );
          paymentHistoryUrl(1, draft);
          setError('');
          onApply({ ...draft, eventSearch: draft.eventSearch.trim() });
        } catch (reason) {
          setError((reason as Error).message);
        }
      }}
    >
      <div className="grid gap-4 md:grid-cols-3">
        <label htmlFor="finance-event">
          Evento
          <input
            id="finance-event"
            value={draft.eventSearch}
            maxLength={120}
            onChange={(event) => change('eventSearch', event.target.value)}
            placeholder="Nome do evento"
          />
        </label>
        <div>
          <label htmlFor="finance-status">Estado do pagamento</label>
          <select
            id="finance-status"
            value={draft.status}
            onChange={(event) => change('status', event.target.value)}
          >
            <option value="">Todos</option>
            {paymentStatuses.map((status) => (
              <option key={status} value={status}>
                {labels[status] ?? status}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="finance-method">Forma de pagamento</label>
          <select
            id="finance-method"
            value={draft.method}
            onChange={(event) => change('method', event.target.value)}
          >
            <option value="">Todas</option>
            <option value="pix">Pix</option>
            <option value="card">Cartão</option>
          </select>
        </div>
        <label htmlFor="finance-from">
          Data inicial
          <input
            id="finance-from"
            type="date"
            value={draft.from}
            aria-describedby="finance-timezone"
            onChange={(event) => change('from', event.target.value)}
          />
        </label>
        <label htmlFor="finance-to">
          Data final
          <input
            id="finance-to"
            type="date"
            value={draft.to}
            aria-describedby="finance-timezone"
            onChange={(event) => change('to', event.target.value)}
          />
        </label>
      </div>
      <p id="finance-timezone" className="muted text-xs">
        Período pela criação da tentativa, em Brasília (UTC−03:00). Inclui o dia
        final inteiro.
      </p>
      <div className="flex flex-wrap gap-3">
        <button className="btn">Aplicar filtros</button>
        <button
          className="btn secondary"
          type="button"
          onClick={() => {
            setDraft({ ...emptyPaymentFilters });
            setError('');
            onApply({ ...emptyPaymentFilters });
          }}
        >
          Limpar filtros
        </button>
      </div>
      {error && <Notice>{error}</Notice>}
    </form>
  );
}
