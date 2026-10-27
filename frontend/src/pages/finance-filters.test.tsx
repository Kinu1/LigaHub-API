import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  FinanceFilters,
  dayBoundary,
  emptyPaymentFilters,
  paymentHistoryUrl,
} from './finance-filters';
describe('Filtros financeiros', () => {
  it('converte o dia inteiro em UTC−03 inclusive ano bissexto, sem fuso do navegador', () => {
    expect(dayBoundary('2028-02-29')).toBe('2028-02-29T03:00:00.000Z');
    expect(dayBoundary('2028-02-29', true)).toBe('2028-03-01T03:00:00.000Z');
    expect(() => dayBoundary('2026-02-29')).toThrow('válida');
    const params = new URL(
      paymentHistoryUrl(2, {
        ...emptyPaymentFilters,
        eventSearch: ' Jornada ',
        method: 'card',
        status: 'approved',
        from: '2026-10-27',
        to: '2026-10-27',
      }),
      'http://localhost',
    ).searchParams;
    expect(Object.fromEntries(params)).toEqual({
      page: '2',
      eventSearch: 'Jornada',
      method: 'card',
      status: 'approved',
      from: '2026-10-27T03:00:00.000Z',
      to: '2026-10-28T03:00:00.000Z',
    });
  });
  it('aplica somente no envio e limpa rascunho e filtros', async () => {
    const apply = vi.fn(),
      user = userEvent.setup();
    render(<FinanceFilters onApply={apply} />);
    await user.type(screen.getByLabelText('Evento'), 'Jornada');
    await user.selectOptions(
      screen.getByLabelText('Forma de pagamento'),
      'card',
    );
    await user.selectOptions(
      screen.getByLabelText('Estado do pagamento'),
      'approved',
    );
    expect(apply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    expect(apply).toHaveBeenLastCalledWith({
      ...emptyPaymentFilters,
      eventSearch: 'Jornada',
      method: 'card',
      status: 'approved',
    });
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(apply).toHaveBeenLastCalledWith(emptyPaymentFilters);
    expect((screen.getByLabelText('Evento') as HTMLInputElement).value).toBe(
      '',
    );
  });
});
