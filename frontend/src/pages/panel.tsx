import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/table';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useEffect, useState, type ReactNode } from 'react';
import {
  FinanceFilters,
  paymentHistoryUrl,
  paymentFiltersFromSearch,
  type PaymentFilters,
} from './finance-filters';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  ArrowUpRight,
  Copy,
  Check,
  Search,
  Download,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { api, send } from '../api';
import { useAuth } from '../auth';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '../components/ui/tabs';
import {
  Heading,
  Loading,
  Notice,
  Empty,
  Status,
  Pager,
  Confirm,
  Field,
  useDebounced,
} from '../ui';
import {
  money,
  reviewReasonText,
  date,
  formatCpf,
  type Event,
  type Page,
  type Registration,
  type User,
  type Audit,
  type PaymentHistory,
} from '../types';
import { AuditList, auditCategories } from './audit-list';
function QueryState({
  query,
  children,
  hasData = false,
}: {
  query: { isPending: boolean; error: Error | null; refetch: () => unknown };
  children: ReactNode;
  hasData?: boolean;
}) {
  if (query.isPending) return <Loading />;
  if (query.error && !hasData)
    return (
      <>
        <Notice>{query.error.message}</Notice>
        <Button variant="outline" onClick={() => query.refetch()}>
          Tentar novamente
        </Button>
      </>
    );
  return (
    <>
      {query.error && (
        <Notice>
          Não foi possível atualizar os registros. Os dados anteriores continuam
          disponíveis.{' '}
          <Button
            variant="link"
            className="h-auto p-0"
            onClick={() => query.refetch()}
          >
            Tentar novamente
          </Button>
        </Notice>
      )}
      {children}
    </>
  );
}
export { Dashboard } from './dashboard';
export function EventsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const querySearch = useDebounced(search);
  const [params, setParams] = useSearchParams();
  const status = ['draft', 'published', 'suspended', 'closed'].includes(
    params.get('status') || '',
  )
    ? params.get('status')!
    : '';
  const cancellations = params.get('attention') === 'cancellation';
  const query = useQuery({
    queryKey: ['events', page, querySearch, status],
    queryFn: () =>
      api<Page<Event>>(
        `/events?page=${page}&limit=12&search=${encodeURIComponent(querySearch)}&status=${status}`,
      ),
  });
  return (
    <>
      <Heading
        title="Eventos"
        action={
          <Button asChild>
            <Link to="/painel/eventos/novo">
              <Plus size={18} />
              Criar evento
            </Link>
          </Button>
        }
      >
        Organize cada detalhe do próximo encontro.
      </Heading>
      <div className="filter-bar mb-6 flex flex-wrap gap-3">
        <label className="relative min-w-0 flex-1">
          <Search
            className="absolute left-3 top-3.5 text-muted-foreground"
            size={18}
          />
          <Input
            aria-label="Buscar evento"
            placeholder="Buscar pelo nome do evento"
            style={{ paddingLeft: 40 }}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <select
          aria-label="Filtrar por estado"
          className="sm:max-w-48"
          value={status}
          onChange={(e) => {
            setParams((current) => {
              const next = new URLSearchParams(current);
              if (e.target.value) next.set('status', e.target.value);
              else next.delete('status');
              return next;
            });
            setPage(1);
          }}
        >
          <option value="">Todos os estados</option>
          {['draft', 'published', 'suspended', 'closed'].map((s) => (
            <option key={s} value={s}>
              {
                {
                  draft: 'Rascunho',
                  published: 'Publicado',
                  suspended: 'Suspenso',
                  closed: 'Encerrado',
                }[s]
              }
            </option>
          ))}
        </select>
        {query.data && (
          <p
            className="text-muted-foreground self-center text-sm"
            role="status"
          >
            {query.data.total} evento(s) encontrado(s)
            {status
              ? ` · ${{ draft: 'Rascunho', published: 'Publicado', suspended: 'Suspenso', closed: 'Encerrado' }[status]}`
              : ' · Todos os estados'}
          </p>
        )}
      </div>
      {cancellations && (
        <Notice success>
          Selecione um evento para consultar suas solicitações abertas de
          cancelamento. Esta lista inclui todos os eventos; não indica quais têm
          solicitações.
        </Notice>
      )}
      <QueryState query={query} hasData={!!query.data}>
        {query.data?.items.length ? (
          <>
            <section className="data-section" aria-label="Lista de eventos">
              <Table className="data-table" aria-label="Eventos">
                <TableHeader>
                  <TableRow>
                    <TableHead>Evento / local</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead className="md:text-right">Preço</TableHead>
                    <TableHead className="md:text-right">Capacidade</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.items.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell
                        data-label="Evento / local"
                        className="whitespace-normal break-words"
                      >
                        <div className="min-w-0">
                          <Link
                            className="font-medium hover:underline"
                            to={`/painel/eventos/${event.id}${cancellations ? '?status=cancellation' : ''}`}
                            aria-label={`${cancellations ? 'Analisar cancelamentos de' : 'Gerenciar evento'} ${event.title}`}
                          >
                            {event.title}
                          </Link>
                          <p className="text-muted-foreground mt-1 text-sm">
                            {event.location || 'Local a confirmar'}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell
                        data-label="Data"
                        className="whitespace-normal"
                      >
                        {date(event.startsAt)}
                      </TableCell>
                      <TableCell
                        data-label="Preço"
                        className="whitespace-normal break-words tabular-nums md:text-right"
                      >
                        {money(event.priceInCents)}
                      </TableCell>
                      <TableCell
                        data-label="Capacidade"
                        className="whitespace-normal tabular-nums md:text-right"
                      >
                        {event.capacity} vagas
                      </TableCell>
                      <TableCell data-label="Estado">
                        <Status value={event.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
            <Pager
              page={page}
              total={query.data.total}
              limit={12}
              setPage={setPage}
            />
          </>
        ) : (
          <Empty title="Nenhum evento encontrado">
            Crie seu primeiro evento ou ajuste os filtros.
          </Empty>
        )}
      </QueryState>
    </>
  );
}
export function Share({ publicId }: { publicId: string }) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  const url = `${location.origin}/eventos/${publicId}`;
  useEffect(() => {
    QRCode.toDataURL(url, {
      width: 220,
      margin: 2,
      color: { dark: '#991b1b', light: '#ffffff' },
    })
      .then(setQr)
      .catch(() => setError('Não foi possível gerar o QR Code.'));
  }, [url]);
  return (
    <div className="data-section">
      <h2>Convide os participantes</h2>
      <p className="muted mt-2 text-sm">
        Compartilhe o link público quando o evento estiver publicado.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2500);
            } catch {
              setError('Não foi possível copiar. Selecione o endereço abaixo.');
            }
          }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}{' '}
          {copied ? 'Link copiado' : 'Copiar link'}
        </Button>
        <Button variant="outline" asChild>
          <a href={url} target="_blank" rel="noreferrer">
            Abrir página <ArrowUpRight size={16} />
          </a>
        </Button>
      </div>
      <p className="mt-3 break-all text-xs text-muted-foreground">{url}</p>
      {qr && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium">
            QR Code de divulgação
          </summary>
          <img
            src={qr}
            width={220}
            height={220}
            alt="QR Code do link público do evento"
          />
          <Button variant="outline" asChild>
            <a href={qr} download="evento-ligahub.png">
              <Download size={16} />
              Baixar QR Code
            </a>
          </Button>
        </details>
      )}
      {error && <Notice>{error}</Notice>}
    </div>
  );
}
export function EventDetails() {
  const { id } = useParams();
  const client = useQueryClient();
  const [tab, setTab] = useState('inscricoes');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [registrationTypeId, setRegistrationTypeId] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const querySearch = useDebounced(search);
  const [params] = useSearchParams();
  const [status, setStatus] = useState(
    [
      'confirmed',
      'reserved',
      'expired',
      'payment_review',
      'cancellation',
    ].includes(params.get('status') || '')
      ? params.get('status')!
      : '',
  );
  const query = useQuery({
    queryKey: ['event', id],
    queryFn: () => api<Event>(`/events/${id}`),
  });
  const registrations = useQuery({
    queryKey: [
      'registrations',
      id,
      page,
      querySearch,
      status,
      registrationTypeId,
    ],
    queryFn: () =>
      api<Page<Registration>>(
        `/events/${id}/registrations?page=${page}&search=${encodeURIComponent(querySearch)}&status=${status}${registrationTypeId ? `&registrationTypeId=${encodeURIComponent(registrationTypeId)}` : ''}`,
      ),
    enabled: tab === 'inscricoes',
  });
  const history = useQuery({
    queryKey: ['history', id, page],
    queryFn: () => api<Page<Audit>>(`/events/${id}/history?page=${page}`),
    enabled: tab === 'historico',
  });
  const event = query.data;
  const invalidate = () => client.invalidateQueries();
  return (
    <QueryState query={query}>
      {event && (
        <>
          <Link
            className="mb-5 inline-block text-sm text-muted-foreground"
            to="/painel/eventos"
          >
            ← Todos os eventos
          </Link>
          <Heading
            title={event.title}
            action={
              <Button variant="outline" asChild>
                <Link to={`/painel/eventos/${id}/editar`}>Editar evento</Link>
              </Button>
            }
          >
            <Status value={event.status} />{' '}
            <span className="ml-2">
              {date(event.startsAt)}
              {event.endsAt ? ` até ${date(event.endsAt)}` : ''}
            </span>
          </Heading>
          <div className="mb-6 flex flex-wrap gap-3">
            {event.status !== 'closed' && (
              <>
                <Confirm
                  title="Publicar evento?"
                  description="A API verificará se o evento pode receber inscrições."
                  onConfirm={async () => {
                    await send(`/events/${id}/publish`);
                    await invalidate();
                  }}
                >
                  Publicar / retomar
                </Confirm>
                {event.status !== 'draft' && (
                  <Confirm
                    title="Suspender inscrições?"
                    description="Novas inscrições e cobranças serão interrompidas."
                    onConfirm={async () => {
                      await send(`/events/${id}/suspend`);
                      await invalidate();
                    }}
                  >
                    Suspender
                  </Confirm>
                )}
                <Confirm
                  title="Encerrar evento?"
                  description="O encerramento é definitivo. O evento não poderá voltar a receber inscrições."
                  onConfirm={async () => {
                    await send(`/events/${id}/close`);
                    await invalidate();
                  }}
                >
                  Encerrar
                </Confirm>
              </>
            )}
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="data-section">
              <h2>Informações do encontro</h2>
              <dl className="mt-5 space-y-3 text-sm">
                {[
                  ['Início', date(event.startsAt)],
                  ['Término', date(event.endsAt)],
                  ['Local', event.location || 'A confirmar'],
                  ['Valor', money(event.priceInCents)],
                  ['Capacidade', `${event.capacity} vagas`],
                  ['Prazo', date(event.registrationDeadline)],
                  [
                    'Abertura das inscrições',
                    event.registrationStartsAt
                      ? date(event.registrationStartsAt)
                      : 'Ao publicar',
                  ],
                ].map(([k, v]) => (
                  <div className="flex justify-between gap-4" key={k}>
                    <dt className="muted">{k}</dt>
                    <dd className="min-w-0 break-words text-right">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="muted mt-5 whitespace-pre-wrap text-sm">
                {event.description}
              </p>
            </section>
            <Share publicId={event.publicId} />
          </div>
          <Tabs
            value={tab}
            onValueChange={(value) => {
              setTab(value);
              setPage(1);
            }}
            className="mt-6"
          >
            <TabsList variant="line" aria-label="Dados do evento">
              <TabsTrigger value="inscricoes">Inscrições</TabsTrigger>
              <TabsTrigger value="historico">Histórico</TabsTrigger>
            </TabsList>
            <TabsContent value="inscricoes" className="data-section">
              <div className="filter-bar mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_200px_200px_auto]">
                <Input
                  aria-label="Buscar inscrição"
                  placeholder="Buscar por nome ou e-mail"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                />
                <select
                  aria-label="Estado da inscrição"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Todas as inscrições</option>
                  <option value="confirmed">Confirmadas</option>
                  <option value="reserved">Reservadas</option>
                  <option value="expired">Expiradas</option>
                  <option value="payment_review">Revisão necessária</option>
                  <option value="cancellation">Cancelamento solicitado</option>
                </select>
                <select
                  aria-label="Tipo de inscrição"
                  value={registrationTypeId}
                  onChange={(e) => {
                    setRegistrationTypeId(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Todos os tipos</option>
                  {(event.registrationTypes?.length
                    ? event.registrationTypes
                    : [{ id: 'geral', name: 'Inscrição geral' }]
                  ).map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  disabled={exporting || !registrations.data?.total}
                  onClick={async () => {
                    setExporting(true);
                    setExportError('');
                    try {
                      const filters = new URLSearchParams({
                        search: querySearch,
                        status,
                      });
                      if (registrationTypeId)
                        filters.set('registrationTypeId', registrationTypeId);
                      const blob = await api<Blob>(
                        `/events/${id}/registrations/export?${filters}`,
                        {},
                        true,
                        'blob',
                      );
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement('a');
                      link.href = url;
                      link.download = `participantes-${id}.xlsx`;
                      document.body.appendChild(link);
                      link.click();
                      link.remove();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    } catch (error) {
                      setExportError((error as Error).message);
                    } finally {
                      setExporting(false);
                    }
                  }}
                >
                  {exporting ? 'Exportando...' : 'Exportar Excel'}
                </Button>
              </div>
              <p className="muted mb-3 text-xs">
                A exportação inclui todos os participantes dos filtros
                selecionados, de todas as páginas.
              </p>
              {exportError && <Notice>{exportError}</Notice>}
              <QueryState query={registrations} hasData={!!registrations.data}>
                {registrations.data && (
                  <p className="muted mb-3 text-sm" role="status">
                    {registrations.data.total} inscrição(ões) encontrada(s)
                  </p>
                )}
                {registrations.data?.items.length ? (
                  <>
                    <Table className="data-table">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Participante</TableHead>
                          <TableHead>CPF do participante</TableHead>
                          <TableHead>Tipo de inscrição</TableHead>
                          <TableHead>Pagamento</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead>Reserva até</TableHead>
                          <TableHead>Ação</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {registrations.data.items.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell
                              className="whitespace-normal break-words"
                              data-label="Participante"
                            >
                              <div>
                                <p className="font-medium">{r.name}</p>
                                <p className="muted mt-1">{r.email}</p>
                                <details className="mt-2">
                                  <summary className="cursor-pointer text-xs">
                                    Respostas do formulário
                                  </summary>
                                  {Object.entries(r.answers).map(
                                    ([key, value]) => (
                                      <p key={key} className="mt-1 text-xs">
                                        {event.form.find((f) => f.id === key)
                                          ?.label || key}
                                        : {String(value)}
                                      </p>
                                    ),
                                  )}
                                </details>
                              </div>
                            </TableCell>
                            <TableCell data-label="CPF do participante">
                              {formatCpf(r.cpf)}
                            </TableCell>
                            <TableCell
                              data-label="Tipo de inscrição"
                              className="whitespace-normal"
                            >
                              {r.registrationTypeName || 'Inscrição geral'}
                            </TableCell>
                            <TableCell data-label="Pagamento">
                              <Status
                                value={
                                  r.paymentStatus ??
                                  (r.priceInCents === 0 ? 'free' : 'unpaid')
                                }
                              />
                            </TableCell>
                            <TableCell
                              className="whitespace-normal break-words"
                              data-label="Estado"
                            >
                              <div>
                                <Status value={r.status} />
                                {r.status === 'payment_review' && (
                                  <p className="mt-2 text-xs">
                                    {reviewReasonText(r.reviewReason)}
                                  </p>
                                )}
                                {r.cancellationRequestedAt && (
                                  <p
                                    className={`mt-2 text-xs ${r.status === 'canceled' ? 'text-muted-foreground' : 'text-warning'}`}
                                  >
                                    {r.status === 'canceled'
                                      ? 'Solicitação de cancelamento concluída'
                                      : 'Cancelamento solicitado'}
                                  </p>
                                )}
                                {r.suspendedAt && (
                                  <p className="mt-2 text-xs">
                                    Inscrição suspensa
                                  </p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell
                              className="whitespace-normal break-words"
                              data-label="Reserva até"
                            >
                              {date(r.reservationExpiresAt)}
                            </TableCell>
                            <TableCell
                              className="whitespace-normal break-words"
                              data-label="Ação"
                            >
                              {r.status === 'payment_review' && (
                                <Confirm
                                  title="Reavaliar confirmação?"
                                  description="Consulta o pagamento e confirma apenas se todas as regras permitirem. Não estorna. Ajustes financeiros devem ser feitos na conta do provedor e depois sincronizados."
                                  onConfirm={async () => {
                                    await api(
                                      `/registrations/${r.id}/payment-review/confirmation`,
                                      { method: 'POST' },
                                      false,
                                    );
                                    await invalidate();
                                  }}
                                >
                                  Reavaliar confirmação
                                </Confirm>
                              )}
                              <Confirm
                                title={
                                  r.suspendedAt
                                    ? 'Reativar inscrição?'
                                    : 'Suspender inscrição?'
                                }
                                description="A alteração será registrada no histórico do evento."
                                onConfirm={async () => {
                                  await send(
                                    `/registrations/${r.id}/suspension`,
                                    { suspended: !r.suspendedAt },
                                    'PATCH',
                                  );
                                  await invalidate();
                                }}
                              >
                                {r.suspendedAt ? 'Reativar' : 'Suspender'}
                              </Confirm>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <Pager
                      page={page}
                      total={registrations.data.total}
                      setPage={setPage}
                    />
                  </>
                ) : (
                  <Empty title="Nenhuma inscrição encontrada" />
                )}
              </QueryState>
            </TabsContent>
            <TabsContent value="historico" className="data-section">
              <QueryState query={history} hasData={!!history.data}>
                <AuditList data={history.data} />
                {history.data && (
                  <Pager
                    page={page}
                    total={history.data.total}
                    setPage={setPage}
                  />
                )}
              </QueryState>
            </TabsContent>
          </Tabs>
        </>
      )}
    </QueryState>
  );
}
export function FinancePage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const initialFilters = paymentFiltersFromSearch(location.search);
  const [filters, setFilters] = useState<PaymentFilters>(initialFilters);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const account = useQuery({
    queryKey: ['account'],
    queryFn: async () => {
      const users = user?.role === 'admin' ? await api<User[]>('/users') : [];
      const owner = users.find((u) => u.role === 'organizer' && u.active);
      return api<{ connected: boolean; merchantId?: string; isTest?: boolean }>(
        `/payments/accounts${owner ? '?ownerId=' + owner.id : ''}`,
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
        <QueryState query={account} hasData={!!account.data}>
          <p className="muted my-2 text-sm">
            {account.data?.connected
              ? 'Conta conectada ao Mercado Pago.'
              : 'Conecte a conta do organizador para habilitar pagamentos.'}{' '}
            {account.data?.isTest ? 'Ambiente de teste.' : ''}
          </p>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                let ownerId: string | undefined;
                if (user?.role === 'admin') {
                  const users = await api<User[]>('/users');
                  ownerId = users.find(
                    (u) => u.role === 'organizer' && u.active,
                  )?.id;
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
const userSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome.').max(120),
  email: z.email('Informe um e-mail válido.'),
  password: z
    .string()
    .refine(
      (v) => Array.from(v).length >= 6 && Array.from(v).length <= 128,
      'A senha deve ter entre 6 e 128 caracteres.',
    ),
  role: z.enum(['admin', 'organizer']),
});
export function UsersPage() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const query = useQuery({
    queryKey: ['users'],
    queryFn: () => api<User[]>('/users'),
    enabled: user?.role === 'admin',
  });
  const form = useForm<z.infer<typeof userSchema>>({
    resolver: zodResolver(userSchema),
    defaultValues: { role: 'organizer' },
  });
  if (user?.role !== 'admin')
    return <Notice>Você não tem acesso a esta área.</Notice>;
  return (
    <>
      <Heading title="Usuários">Acesso à gestão da liga.</Heading>
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <section className="data-section">
          <QueryState query={query}>
            <Table className="data-table" aria-label="Usuários">
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Perfil / estado</TableHead>
                  <TableHead>Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data?.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell
                      data-label="Usuário"
                      className="whitespace-normal break-words"
                    >
                      <div>
                        <p className="font-semibold">{u.name}</p>
                        <p className="muted text-sm">{u.email}</p>
                      </div>
                    </TableCell>
                    <TableCell
                      data-label="Perfil / estado"
                      className="whitespace-normal"
                    >
                      <p className="mt-1 text-xs">
                        {u.role === 'admin' ? 'Administrador' : 'Organizador'} ·{' '}
                        <span
                          className={`badge ${u.active ? 'badge-good' : 'badge-danger'}`}
                        >
                          {u.active ? 'Ativo' : 'Suspenso'}
                        </span>
                      </p>
                    </TableCell>
                    <TableCell data-label="Ação">
                      <Confirm
                        title={
                          u.active ? 'Suspender usuário?' : 'Reativar usuário?'
                        }
                        description="A API verifica as permissões e protege o último administrador ativo."
                        onConfirm={async () => {
                          await send(
                            `/users/${u.id}/status`,
                            { active: !u.active },
                            'PATCH',
                          );
                          await client.invalidateQueries({
                            queryKey: ['users'],
                          });
                        }}
                      >
                        {u.active ? 'Suspender' : 'Reativar'}
                      </Confirm>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </QueryState>
        </section>
        <form
          className="card space-y-4"
          onSubmit={form.handleSubmit(async (values) => {
            setError('');
            setSuccess(false);
            try {
              await send('/users', values);
              form.reset({
                name: '',
                email: '',
                password: '',
                role: 'organizer',
              });
              setSuccess(true);
              await client.invalidateQueries({ queryKey: ['users'] });
            } catch (e) {
              setError((e as Error).message);
            }
          })}
        >
          <h2>Novo acesso</h2>
          {success && <Notice success>Usuário criado.</Notice>}
          {error && <Notice>{error}</Notice>}
          <Field label="Nome" error={form.formState.errors.name?.message}>
            <Input {...form.register('name')} autoComplete="off" />
          </Field>
          <Field label="E-mail" error={form.formState.errors.email?.message}>
            <Input
              {...form.register('email')}
              type="email"
              autoComplete="off"
            />
          </Field>
          <Field
            label="Senha inicial"
            error={form.formState.errors.password?.message}
          >
            <Input
              {...form.register('password')}
              type="password"
              autoComplete="new-password"
            />
          </Field>
          <Field label="Perfil">
            <select {...form.register('role')}>
              <option value="organizer">Organizador</option>
              <option value="admin">Administrador</option>
            </select>
          </Field>
          <p className="muted text-xs">
            A liga possui somente um organizador cadastrado.
          </p>
          <Button disabled={form.formState.isSubmitting}>Criar acesso</Button>
        </form>
      </div>
    </>
  );
}
export function AuditPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const query = useQuery({
    queryKey: ['audit', page, entityType],
    queryFn: () =>
      api<Page<Audit>>(
        `/admin/audit?page=${page}${entityType ? `&entityType=${entityType}` : ''}`,
      ),
    enabled: user?.role === 'admin',
  });
  if (user?.role !== 'admin')
    return <Notice>Você não tem acesso a esta área.</Notice>;
  return (
    <>
      <Heading title="Auditoria">
        Ações, responsáveis e registros afetados na plataforma.
      </Heading>
      <section className="data-section">
        <div className="filter-bar mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
          <label className="block w-full text-sm font-medium sm:w-64">
            Tipo de registro
            <select
              value={entityType}
              onChange={(event) => {
                setEntityType(event.target.value);
                setPage(1);
              }}
              className="mt-2 w-full"
            >
              <option value="">Todos os tipos</option>
              {Object.entries(auditCategories).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p className="muted max-w-md text-xs">
            Mais recentes primeiro. Horários de Brasília. Nomes e perfis
            refletem o cadastro atual.
          </p>
        </div>
        <QueryState query={query} hasData={!!query.data}>
          <AuditList data={query.data} />
          {query.data && (
            <Pager
              page={page}
              total={query.data.total}
              limit={query.data.limit}
              setPage={setPage}
            />
          )}
        </QueryState>
      </section>
    </>
  );
}
