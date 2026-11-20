import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, send } from '../api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../components/ui/tabs';
import {
  date,
  formatCpf,
  money,
  reviewReasonText,
  type Audit,
  type Event,
  type Page,
  type Registration,
} from '../types';
import {
  Confirm,
  Empty,
  Heading,
  Notice,
  Pager,
  Status,
  useDebounced,
} from '../ui';
import { AuditList } from './audit-list';
import { QueryState } from './query-state';
import { Share } from './share';
import { Communications } from './communications';
import { ManualRegistration } from './manual-registration';
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
              <div className="mb-5 flex flex-wrap items-start gap-3">
                <ManualRegistration
                  event={event}
                  onCreated={async () => {
                    setPage(1);
                    setSearch('');
                    setStatus('');
                    setRegistrationTypeId('');
                    await invalidate();
                  }}
                  onDuplicate={(email) => {
                    setSearch(email);
                    setStatus('');
                    setRegistrationTypeId('');
                    setPage(1);
                  }}
                />
                <Communications event={event} />
              </div>
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
                                {r.origin === 'manual' && (
                                  <div className="mt-2 space-y-1">
                                    <Status value="manual" />
                                    <p className="muted text-xs">
                                      Incluída em {date(r.manualCreatedAt)}
                                    </p>
                                    {r.emailDeliveryStatus !== 'sent' && (
                                      <p className="text-xs text-warning">
                                        Confirmação por e-mail pendente. A vaga
                                        está confirmada.
                                      </p>
                                    )}
                                  </div>
                                )}
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
                                  r.financialStatus ??
                                  r.paymentStatus ??
                                  (r.priceInCents === 0 ? 'free' : 'unpaid')
                                }
                              />
                              {r.latestPaymentStatus && (
                                <div className="mt-2 text-xs">
                                  Última tentativa:{' '}
                                  <Status value={r.latestPaymentStatus} />
                                </div>
                              )}
                              {r.financialWarnings?.map((warning) => (
                                <p
                                  key={warning}
                                  className="mt-2 text-xs text-warning"
                                >
                                  {warning === 'multiple_approvals'
                                    ? 'Mais de um pagamento aprovado'
                                    : 'Histórico de contestação'}
                                </p>
                              ))}
                            </TableCell>
                            <TableCell
                              className="whitespace-normal break-words"
                              data-label="Estado"
                            >
                              <div>
                                <Status
                                  value={r.suspendedAt ? 'suspended' : r.status}
                                />
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
                              </div>
                            </TableCell>
                            <TableCell
                              className="whitespace-normal break-words"
                              data-label="Reserva até"
                            >
                              {r.origin === 'manual'
                                ? 'Não se aplica'
                                : date(r.reservationExpiresAt)}
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
