import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, send } from '../api';
import { useAuth } from '../auth';
import { Button } from '../components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import {
  date,
  formatCpf,
  money,
  type Page,
  type PaymentHistory,
  type User,
} from '../types';
import { Empty, Heading, Notice, Pager, Status } from '../ui';
import {
  FinanceFilters,
  paymentFiltersFromSearch,
  paymentHistoryUrl,
  type PaymentFilters,
} from './finance-filters';
import { QueryState } from './query-state';

type ConnectedAccount = {
  connected: boolean;
};

export function FinancePage() {
  const { user } = useAuth();
  const [connectionReturn] = useState(() => {
    const params = new URLSearchParams(location.search);
    return {
      result: params.get('mercadoPago'),
      ownerId: params.get('ownerId'),
    };
  });
  useEffect(() => {
    if (
      !['connected', 'error', 'canceled'].includes(
        connectionReturn.result ?? '',
      )
    )
      return;
    const url = new URL(location.href);
    url.searchParams.delete('mercadoPago');
    history.replaceState(
      history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [connectionReturn]);
  const [page, setPage] = useState(1);
  const initialFilters = paymentFiltersFromSearch(location.search);
  const [filters, setFilters] = useState<PaymentFilters>(initialFilters);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const account = useQuery({
    queryKey: ['account', user?.id, connectionReturn.ownerId],
    queryFn: async () => {
      const users = user?.role === 'admin' ? await api<User[]>('/users') : [];
      const ownerId =
        user?.role === 'admin'
          ? (connectionReturn.ownerId ??
            users.find((u) => u.role === 'organizer' && u.active)?.id)
          : undefined;
      return api<ConnectedAccount>(
        `/payments/accounts${ownerId ? '?ownerId=' + encodeURIComponent(ownerId) : ''}`,
      );
    },
  });
  const payments = useQuery({
    queryKey: ['payments', page, filters],
    queryFn: () => api<Page<PaymentHistory>>(paymentHistoryUrl(page, filters)),
  });
  return (
    <>
      <Heading title="Financeiro">
        Recebimentos e conexão com Mercado Pago.
      </Heading>
      <section className="account-strip mb-6">
        <h2 className="text-base">Conta de recebimento</h2>
        {connectionReturn.result === 'error' && (
          <Notice>
            Não foi possível concluir a conexão. Tente conectar a conta
            novamente.
          </Notice>
        )}
        {connectionReturn.result === 'canceled' && (
          <Notice>
            A autorização foi cancelada. Sua conexão anterior foi preservada.
          </Notice>
        )}
        <QueryState query={account} hasData={!!account.data}>
          <p
            className="muted my-2 text-sm"
            role={account.data?.connected ? 'status' : undefined}
          >
            {account.data?.connected
              ? 'Conta conectada ao Mercado Pago.'
              : 'Conecte a conta do organizador para habilitar pagamentos.'}
          </p>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                let ownerId: string | undefined;
                if (user?.role === 'admin') {
                  const users = await api<User[]>('/users');
                  ownerId =
                    connectionReturn.ownerId ??
                    users.find((u) => u.role === 'organizer' && u.active)?.id;
                  if (!ownerId)
                    throw new Error(
                      'Cadastre e ative o organizador antes de conectar a conta.',
                    );
                }
                const result = await send<{ authorizationUrl: string }>(
                  '/payments/accounts/authorize',
                  ownerId ? { ownerId } : {},
                );
                const url = new URL(result.authorizationUrl);
                if (url.protocol !== 'https:')
                  throw new Error('Endereço de autorização inválido.');
                location.assign(url.href);
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            {busy
              ? 'Aguarde…'
              : account.data?.connected
                ? 'Reconectar conta'
                : 'Conectar Mercado Pago'}
          </Button>
        </QueryState>
        {error && <Notice>{error}</Notice>}
      </section>
      <section className="data-section">
        <h2 className="mb-5">Histórico de pagamentos</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          O valor base é o valor da tentativa de pagamento; não representa saldo
          nem receita líquida.
        </p>
        <FinanceFilters
          initialFilters={initialFilters}
          onApply={(next) => {
            setPage(1);
            setFilters(next);
          }}
        />
        <QueryState query={payments} hasData={!!payments.data}>
          {payments.data && (
            <p className="muted mb-3 text-sm" role="status">
              {payments.data.total} pagamento(s) encontrado(s)
            </p>
          )}
          {payments.data?.items.length ? (
            <>
              <Table className="data-table payment-history-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Evento</TableHead>
                    <TableHead>Nome completo do pagador</TableHead>
                    <TableHead>CPF do pagador</TableHead>
                    <TableHead>Forma</TableHead>
                    <TableHead className="xl:text-right">Valor base</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.data.items.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell
                        className="whitespace-normal break-words"
                        data-label="Data"
                      >
                        {date(p.createdAt)}
                      </TableCell>
                      <TableCell
                        className="whitespace-normal break-words"
                        data-label="Evento"
                      >
                        {p.event?.title ?? 'Não informado'}
                      </TableCell>
                      <TableCell
                        data-label="Nome completo do pagador"
                        className="whitespace-normal break-words"
                      >
                        {p.payer?.name || 'Não informado'}
                      </TableCell>
                      <TableCell
                        data-label="CPF do pagador"
                        className="whitespace-nowrap tabular-nums"
                      >
                        {formatCpf(p.payer?.cpf)}
                      </TableCell>
                      <TableCell
                        className="whitespace-normal break-words"
                        data-label="Forma"
                      >
                        {p.method === 'pix'
                          ? 'Pix'
                          : `Cartão · ${p.installments}x`}
                      </TableCell>
                      <TableCell
                        className="whitespace-normal break-words tabular-nums xl:text-right"
                        data-label="Valor base"
                      >
                        {money(p.amountInCents)}
                      </TableCell>
                      <TableCell
                        className="whitespace-normal break-words"
                        data-label="Estado"
                      >
                        <Status value={p.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pager
                page={page}
                total={payments.data.total}
                limit={50}
                setPage={setPage}
              />
            </>
          ) : (
            <Empty title="Nenhum pagamento encontrado" />
          )}
        </QueryState>
      </section>
      <p className="muted mt-5 text-sm">
        Reembolsos são executados pelo organizador no Mercado Pago e
        acompanhados pela API.
      </p>
    </>
  );
}
