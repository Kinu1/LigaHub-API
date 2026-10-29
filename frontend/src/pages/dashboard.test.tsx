import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from './dashboard';
import { api } from '../api';

vi.mock('../api', () => ({ api: vi.fn() }));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { id: 'organizer', role: 'organizer' } }) }));

const overview = { events: 3, drafts: 1, confirmed: 20, cancellationRequests: 2, pendingPayments: 4, approvedBaseAmountInCents: 50000, accountConnected: true };
function openDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><Dashboard /></QueryClientProvider></MemoryRouter>);
}

describe('Dashboard de gestão', () => {
  beforeEach(() => vi.resetAllMocks());

  it('preserva os indicadores quando a consulta independente de eventos falha', async () => {
    vi.mocked(api).mockImplementation(async path => {
      if (path === '/dashboard') return overview;
      throw new Error('Consulta indisponível');
    });
    openDashboard();
    expect(await screen.findByText('R$ 500,00')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Tentar novamente: os eventos recentes' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Revisar 1 evento/ }).getAttribute('href')).toBe('/painel/eventos?status=draft');
    expect(screen.getByRole('link', { name: /Analisar 2 solicitação/ }).getAttribute('href')).toBe('/painel/eventos?attention=cancellation');
    expect(screen.getByRole('link', { name: 'Pendente' }).getAttribute('href')).toBe('/painel/financeiro?status=pending');
    expect(screen.queryByRole('navigation', { name: 'Administração' })).toBeNull();
  });

  it('oferece criação quando não há eventos e não inventa prioridades', async () => {
    vi.mocked(api).mockImplementation(async path => path === '/dashboard'
      ? { ...overview, events: 0, drafts: 0, cancellationRequests: 0, pendingPayments: 0 }
      : { items: [], total: 0 });
    openDashboard();
    expect(await screen.findByText('Nenhum evento ainda')).toBeTruthy();
    expect(await screen.findByText('Nenhuma prioridade pendente')).toBeTruthy();
    const recent = screen.getByRole('region', { name: 'Eventos recentes' });
    expect(within(recent).getByRole('link', { name: 'Criar seu primeiro evento' }).getAttribute('href')).toBe('/painel/eventos/novo');
  });
});
