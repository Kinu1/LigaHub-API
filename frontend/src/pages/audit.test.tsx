import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuditPage } from './panel';
import { api } from '../api';

const auth = vi.hoisted(() => ({ role: 'admin' }));
vi.mock('../auth', () => ({
  useAuth: () => ({ user: { id: 'admin', role: auth.role } }),
}));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: vi.fn(),
}));

function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AuditPage />
    </QueryClientProvider>,
  );
  return client;
}

const entry = {
  id: 'auditoria-1',
  entityId: 'pagamento-1',
  actorId: 'usuario-1',
  action: 'payment.created',
  entityType: 'payment',
  createdAt: '2026-10-26T18:30:45Z',
  actor: {
    id: 'usuario-1',
    name: 'Ana Administradora',
    email: 'ana@ligahub.test',
    role: 'admin',
  },
  subject: { name: 'Pedro Participante', eventTitle: 'Jornada acadêmica' },
  metadata: {
    method: 'pix',
    amountInCents: 2500,
    accessToken: 'segredo-nao-exibir',
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  auth.role = 'admin';
});

describe('Auditoria do administrador', () => {
  it.each([
    ['payment_refunded', 'Pagamento reembolsado integralmente'],
    ['payment_charged_back', 'Pagamento devolvido por contestação'],
  ])(
    'explica o cancelamento da inscrição pelo motivo %s',
    async (reason, description) => {
      vi.mocked(api).mockResolvedValue({
        items: [
          {
            ...entry,
            entityType: 'registration',
            entityId: 'inscricao-1',
            action: 'registration.canceled',
            actor: null,
            actorId: null,
            metadata: { reason, paymentId: 'pagamento-1', status: 'canceled' },
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      });
      show();
      const article = await screen.findByRole('article', {
        name: 'Inscrição cancelada após devolução do pagamento',
      });
      expect(within(article).getByText(description)).toBeTruthy();
      expect(within(article).getByText('Cancelada')).toBeTruthy();
    },
  );
  it('traduz alterações de acesso e campos do evento sem mostrar campos desconhecidos', async () => {
    vi.mocked(api).mockResolvedValue({
      items: [
        {
          ...entry,
          id: 'acesso',
          entityType: 'user',
          action: 'status_updated',
          metadata: { previousActive: true, active: false },
        },
        {
          ...entry,
          id: 'evento',
          entityType: 'event',
          action: 'updated',
          metadata: {
            fields: [
              'title',
              'registrationDeadline',
              'reservationMinutes',
              'campo-interno',
            ],
          },
        },
      ],
      total: 2,
      page: 1,
      limit: 20,
    });
    show();
    const access = await screen.findByRole('article', {
      name: 'Situação de acesso do usuário alterada',
    });
    expect(within(access).getByText('Ativo')).toBeTruthy();
    expect(within(access).getByText('Suspenso')).toBeTruthy();
    expect(
      screen.getByText('Título, Prazo de inscrição, Duração da reserva'),
    ).toBeTruthy();
    expect(screen.queryByText(/campo-interno/)).toBeNull();
  });
  it('preserva o histórico carregado se a atualização falhar e permite tentar novamente', async () => {
    vi.mocked(api).mockResolvedValueOnce({
      items: [entry],
      total: 1,
      page: 1,
      limit: 20,
    });
    const client = show();
    await screen.findByText('Tentativa de pagamento criada');
    vi.mocked(api).mockRejectedValueOnce(
      new Error('Falha temporária de conexão.'),
    );
    await act(async () => {
      await client.refetchQueries({ queryKey: ['audit'] });
    });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Tentativa de pagamento criada')).toBeTruthy();
    vi.mocked(api).mockResolvedValueOnce({
      items: [entry],
      total: 1,
      page: 1,
      limit: 20,
    });
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Pedro Participante')).toBeTruthy();
  });
  it('explica a ação, o responsável, o participante, o evento e o valor sem expor metadados privados', async () => {
    vi.mocked(api).mockResolvedValue({
      items: [entry],
      total: 1,
      page: 1,
      limit: 20,
    });
    show();
    const row = await screen.findByRole('article', {
      name: 'Tentativa de pagamento criada',
    });
    expect(within(row).getByText('Ana Administradora')).toBeTruthy();
    expect(within(row).getByText('Pedro Participante')).toBeTruthy();
    expect(within(row).getByText('Evento: Jornada acadêmica')).toBeTruthy();
    expect(within(row).getByText(/R\$\s*25,00/)).toBeTruthy();
    expect(within(row).getByText('Pix')).toBeTruthy();
    expect(within(row).getByText(/15:30:45/)).toBeTruthy();
    expect(screen.queryByText('segredo-nao-exibir')).toBeNull();
    await userEvent
      .setup()
      .click(within(row).getByText('Identificadores do registro'));
    expect(within(row).getByText('pagamento-1')).toBeTruthy();
  });

  it('explicita ausência de identificação e mantém códigos desconhecidos nos detalhes', async () => {
    vi.mocked(api).mockResolvedValue({
      items: [
        {
          id: 'antigo',
          action: 'acao.antiga',
          entityType: 'legado',
          createdAt: entry.createdAt,
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
    show();
    expect(
      await screen.findByText('Ação sem descrição disponível'),
    ).toBeTruthy();
    expect(screen.getByText('Não identificado no registro')).toBeTruthy();
    expect(
      screen.getByText('Sem detalhes adicionais registrados.'),
    ).toBeTruthy();
    await userEvent
      .setup()
      .click(screen.getByText('Identificadores do registro'));
    expect(screen.getByText('acao.antiga')).toBeTruthy();
  });

  it('filtra no servidor e volta à primeira página ao trocar o tipo', async () => {
    vi.mocked(api).mockResolvedValue({
      items: [entry],
      total: 40,
      page: 1,
      limit: 20,
    });
    show();
    const user = userEvent.setup();
    await screen.findByText('Tentativa de pagamento criada');
    await user.click(screen.getByRole('button', { name: 'Próxima página' }));
    expect(api).toHaveBeenLastCalledWith('/admin/audit?page=2');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Tipo de registro' }),
      'user',
    );
    expect(api).toHaveBeenLastCalledWith('/admin/audit?page=1&entityType=user');
  });

  it('não consulta auditoria para organizadores', () => {
    auth.role = 'organizer';
    show();
    expect(screen.getByRole('alert').textContent).toContain(
      'Você não tem acesso',
    );
    expect(api).not.toHaveBeenCalled();
  });
});
