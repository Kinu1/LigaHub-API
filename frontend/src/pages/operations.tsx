import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useAuth } from '../auth';
import { Empty, Heading, Loading, Notice, Pager } from '../ui';

type RoutineStatus =
  | 'completed'
  | 'partial'
  | 'failed'
  | 'skipped'
  | 'running'
  | 'unfinished'
  | null;

type RoutineInfo = {
  name: 'emails' | 'payments';
  startedAt: string | null;
  finishedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  status: RoutineStatus;
  errorCode: string | null;
  runCount: number;
  failureCount: number;
  processedCount: number | null;
  succeededCount: number | null;
  failedCount: number | null;
  skippedCount: number | null;
  activeLease: boolean;
  leaseExpiresAt: string | null;
};

type QueueSummary = {
  pending: number;
  processing: number;
  sent: number;
  failed: number;
  skipped: number;
  oldestNextAttemptAt: string | null;
};

type FailedPaymentItem = {
  id: string;
  registrationId: string;
  event: { id: string; title: string } | null;
  method: string;
  amountInCents: number;
  status: string;
  lastSyncAttemptAt: string | null;
  lastSyncSucceededAt: string | null;
  lastSyncErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

type OperationsResponse = {
  flags: {
    backgroundJobsEnabled: boolean;
    backgroundTimersEnabled: boolean;
    emailDeliveryEnabled: boolean;
    paymentReconciliationEnabled: boolean;
  };
  routines: RoutineInfo[];
  queues: {
    confirmation: QueueSummary;
    access: QueueSummary;
  };
  failedPayments: {
    items: FailedPaymentItem[];
    total: number;
    page: number;
    limit: number;
  };
};

const statusLabels: Record<string, string> = {
  completed: 'Concluído',
  partial: 'Parcial',
  failed: 'Falhou',
  skipped: 'Ignorado',
  running: 'Em execução',
  unfinished: 'Sem conclusão registrada',
};

const routineLabels: Record<string, string> = {
  emails: 'Fila de e-mails',
  payments: 'Reconciliação de pagamentos',
};

const errorCategories: Record<string, string> = {
  credentials_unavailable: 'Credenciais indisponíveis',
  provider_unavailable: 'Provedor indisponível',
  invalid_provider_response: 'Resposta do provedor inválida',
  database_unavailable: 'Banco de dados indisponível',
  sync_failed: 'Falha na sincronização',
  JOB_FAILED: 'Falha na rotina',
  PARTIAL_FAILURE: 'Falha parcial',
  CONFIG_UNAVAILABLE: 'Configuração indisponível',
  BUSY: 'Ocupado',
  DISABLED: 'Desativado',
  DATABASE_UNAVAILABLE: 'Banco de dados indisponível',
  SYNC_FAILED: 'Falha na sincronização',
  INVALID_RESULT: 'Resultado da rotina inválido',
};

function date(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Não disponível';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

function money(amountInCents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(amountInCents / 100);
}

export function OperationsPage() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (user?.role !== 'admin') {
    return <Notice>Você não tem acesso a esta página.</Notice>;
  }
  return <AdminOperations key={user.id} />;
}

function AdminOperations() {
  const [page, setPage] = useState(1);
  const query = useQuery<OperationsResponse>({
    queryKey: ['admin-operations', page],
    queryFn: () =>
      api<OperationsResponse>(`/admin/operations?page=${page}&limit=20`),
  });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <Heading title="Operação e rotinas">
          Diagnóstico administrativo seguro de rotinas de segundo plano, filas
          de e-mail e sincronização de pagamentos.
        </Heading>
        <button
          className="btn secondary"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {query.isFetching ? 'Atualizando...' : 'Atualizar diagnóstico'}
        </button>
      </div>

      {query.isError && (
        <Notice>
          Não foi possível atualizar o diagnóstico operacional.{' '}
          {query.data
            ? 'Os dados anteriores foram mantidos e podem estar desatualizados.'
            : 'Os dados não estão disponíveis.'}
        </Notice>
      )}

      {query.isPending && <Loading />}

      {query.data && (
        <div className="space-y-8">
          {/* Habilitação de flags */}
          <div className="card">
            <h2 className="text-lg font-semibold mb-4">
              Habilitação do sistema
            </h2>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
              <div className="p-3 bg-zinc-50 rounded-lg">
                <dt className="muted">Endpoints HTTP de rotina</dt>
                <dd className="font-semibold text-base mt-1">
                  {query.data.flags.backgroundJobsEnabled ? (
                    <span className="text-emerald-700">Habilitado</span>
                  ) : (
                    <span className="text-zinc-500">Desabilitado</span>
                  )}
                </dd>
              </div>
              <div className="p-3 bg-zinc-50 rounded-lg">
                <dt className="muted">Timers automáticos</dt>
                <dd className="font-semibold text-base mt-1">
                  {query.data.flags.backgroundTimersEnabled ? (
                    <span className="text-emerald-700">Ativo</span>
                  ) : (
                    <span className="text-zinc-500">Inativo</span>
                  )}
                </dd>
              </div>
              <div className="p-3 bg-zinc-50 rounded-lg">
                <dt className="muted">Envio de e-mails</dt>
                <dd className="font-semibold text-base mt-1">
                  {query.data.flags.emailDeliveryEnabled ? (
                    <span className="text-emerald-700">Ativo</span>
                  ) : (
                    <span className="text-zinc-500">Inativo</span>
                  )}
                </dd>
              </div>
              <div className="p-3 bg-zinc-50 rounded-lg">
                <dt className="muted">Reconciliação de pagamentos</dt>
                <dd className="font-semibold text-base mt-1">
                  {query.data.flags.paymentReconciliationEnabled ? (
                    <span className="text-emerald-700">Ativo</span>
                  ) : (
                    <span className="text-zinc-500">Inativo</span>
                  )}
                </dd>
              </div>
            </dl>
          </div>

          {/* Rotinas de segundo plano */}
          <div className="card">
            <h2 className="text-lg font-semibold mb-2">
              Rotinas de segundo plano
            </h2>
            <div className="text-xs muted mb-4 space-y-1">
              <p>
                <strong>Último sucesso verificável:</strong> a rotina executou e
                concluiu todos os itens sem falhas.
              </p>
              <p>
                <strong>Última tentativa:</strong> data e hora em que o runner
                iniciou a rotina mais recente.
              </p>
              <p>
                <strong>Última falha:</strong> registro de execução que falhou
                ou terminou com pendências parciais.
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {query.data.routines.map((routine) => (
                <div
                  key={routine.name}
                  className="border border-zinc-200 rounded-xl p-5 space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-base">
                      {routineLabels[routine.name] ?? routine.name}
                    </h3>
                    <div className="flex items-center gap-2">
                      {routine.activeLease && routine.status !== 'running' && (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                          Em execução
                        </span>
                      )}
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                          routine.status === 'completed'
                            ? 'bg-emerald-100 text-emerald-800'
                            : ['partial', 'running', 'unfinished'].includes(
                                  routine.status ?? '',
                                )
                              ? 'bg-amber-100 text-amber-800'
                              : routine.status === 'failed'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-zinc-100 text-zinc-700'
                        }`}
                      >
                        {statusLabels[routine.status ?? ''] ?? 'Sem execução'}
                      </span>
                    </div>
                  </div>

                  {routine.errorCode && (
                    <p className="text-sm text-red-700 bg-red-50 p-2 rounded">
                      Classificação:{' '}
                      {errorCategories[routine.errorCode] ?? routine.errorCode}
                    </p>
                  )}

                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="muted">Último sucesso verificável</dt>
                      <dd className="font-medium">
                        {date(routine.lastSucceededAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="muted">Última tentativa</dt>
                      <dd className="font-medium">{date(routine.startedAt)}</dd>
                    </div>
                    <div>
                      <dt className="muted">Última falha</dt>
                      <dd className="font-medium">
                        {date(routine.lastFailedAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="muted">Término</dt>
                      <dd className="font-medium">
                        {date(routine.finishedAt)}
                      </dd>
                    </div>
                  </dl>

                  <div className="border-t border-zinc-100 pt-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                      {routine.status === 'running' ||
                      routine.status === 'unfinished'
                        ? 'Contadores disponíveis após o término'
                        : 'Contadores da última execução'}
                    </p>
                    <div className="grid grid-cols-4 gap-2 text-center text-sm">
                      <div className="bg-zinc-50 p-2 rounded">
                        <span className="block text-xs muted">Processados</span>
                        <span className="font-semibold">
                          {routine.processedCount ?? '—'}
                        </span>
                      </div>
                      <div className="bg-emerald-50 p-2 rounded text-emerald-900">
                        <span className="block text-xs text-emerald-700">
                          Sucessos
                        </span>
                        <span className="font-semibold">
                          {routine.succeededCount ?? '—'}
                        </span>
                      </div>
                      <div className="bg-red-50 p-2 rounded text-red-900">
                        <span className="block text-xs text-red-700">
                          Falhas
                        </span>
                        <span className="font-semibold">
                          {routine.failedCount ?? '—'}
                        </span>
                      </div>
                      <div className="bg-zinc-50 p-2 rounded">
                        <span className="block text-xs muted">Ignorados</span>
                        <span className="font-semibold">
                          {routine.skippedCount ?? '—'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-xs muted flex justify-between pt-1">
                    <span>Execuções totais: {routine.runCount}</span>
                    <span>Falhas registradas: {routine.failureCount}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Filas de e-mails: Confirmação vs Acesso */}
          <div className="card">
            <h2 className="text-lg font-semibold mb-2">Filas de e-mails</h2>
            <p className="text-xs muted mb-4">
              Aceito pelo provedor não significa entregue na caixa de entrada do
              participante.
            </p>

            <div className="grid gap-6 md:grid-cols-2">
              {/* Confirmações */}
              <div className="border border-zinc-200 rounded-xl p-5 space-y-4">
                <h3 className="font-semibold text-base">
                  Confirmações de inscrição
                </h3>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="muted">Pendentes</dt>
                    <dd className="text-lg font-semibold">
                      {query.data.queues.confirmation.pending}
                    </dd>
                  </div>
                  <div>
                    <dt className="muted">Em processamento</dt>
                    <dd className="text-lg font-semibold text-amber-700">
                      {query.data.queues.confirmation.processing}
                    </dd>
                  </div>
                  <div>
                    <dt className="muted">Aceitos pelo provedor</dt>
                    <dd className="text-lg font-semibold text-emerald-700">
                      {query.data.queues.confirmation.sent}
                    </dd>
                  </div>
                  <div>
                    <dt className="muted">Falhas</dt>
                    <dd className="text-lg font-semibold text-red-700">
                      {query.data.queues.confirmation.failed}
                    </dd>
                  </div>
                  <div>
                    <dt className="muted">Ignorados</dt>
                    <dd className="text-lg font-semibold text-zinc-500">
                      {query.data.queues.confirmation.skipped}
                    </dd>
                  </div>
                  <div>
                    <dt className="muted">Próximo agendado mais antigo</dt>
                    <dd className="text-sm font-medium">
                      {date(query.data.queues.confirmation.oldestNextAttemptAt)}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Links de acesso */}
              <div className="border border-zinc-200 rounded-xl p-5 space-y-4">
                <h3 className="font-semibold text-base">
                  Links de acesso e gestão
                </h3>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="muted">Pendentes</dt>
                    <dd className="text-lg font-semibold">
                      {query.data.queues.access.pending}
                    </dd>
                  </div>
                  <div>
                    <dt className="muted">Em processamento</dt>
                    <dd className="text-lg font-semibold text-amber-700">
                      {query.data.queues.access.processing}
                    </dd>
                  </div>
                  <div>
                    <dt className="muted">Aceitos pelo provedor</dt>
                    <dd className="text-lg font-semibold text-emerald-700">
                      {query.data.queues.access.sent}
                    </dd>
                  </div>
                  <div>
                    <dt className="muted">Falhas</dt>
                    <dd className="text-lg font-semibold text-red-700">
                      {query.data.queues.access.failed}
                    </dd>
                  </div>
                  <div>
                    <dt className="muted">Ignorados</dt>
                    <dd className="text-lg font-semibold text-zinc-500">
                      {query.data.queues.access.skipped}
                    </dd>
                  </div>
                  <div>
                    <dt className="muted">Próximo agendado mais antigo</dt>
                    <dd className="text-sm font-medium">
                      {date(query.data.queues.access.oldestNextAttemptAt)}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>

          {/* Consultas de pagamento com erro */}
          <div className="card">
            <h2 className="text-lg font-semibold mb-2">
              Pagamentos com falha de sincronização
            </h2>
            <p className="text-xs muted mb-4">
              Tentativas em que a consulta ao provedor não pôde ser concluída.
              Dados confidenciais do pagador e credenciais não são exibidos.
            </p>

            {!query.data.failedPayments.items.length && (
              <Empty title="Nenhum pagamento com falha de sincronização" />
            )}

            {query.data.failedPayments.items.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200">
                      <th className="py-2.5 px-3">Identificador</th>
                      <th className="py-2.5 px-3">Evento</th>
                      <th className="py-2.5 px-3">Valor</th>
                      <th className="py-2.5 px-3">Categoria do erro</th>
                      <th className="py-2.5 px-3">Última tentativa de sync</th>
                      <th className="py-2.5 px-3">Último sucesso</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {query.data.failedPayments.items.map((item) => (
                      <tr key={item.id} className="hover:bg-zinc-50/50">
                        <td className="py-3 px-3">
                          <span className="font-mono text-xs block">
                            {item.id.slice(0, 8)}...
                          </span>
                          <span className="text-xs muted font-mono">
                            Inscrição: {item.registrationId.slice(0, 8)}...
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <span className="font-medium">
                            {item.event?.title ?? 'Evento não informado'}
                          </span>
                          <span className="block text-xs muted uppercase">
                            {item.method}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-medium">
                          {money(item.amountInCents)}
                        </td>
                        <td className="py-3 px-3">
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800">
                            {errorCategories[item.lastSyncErrorCode ?? ''] ??
                              item.lastSyncErrorCode ??
                              'Erro não informado'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-xs">
                          {date(item.lastSyncAttemptAt)}
                        </td>
                        <td className="py-3 px-3 text-xs">
                          {date(item.lastSyncSucceededAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <Pager
              page={page}
              total={query.data.failedPayments.total}
              limit={query.data.failedPayments.limit}
              setPage={setPage}
            />
          </div>
        </div>
      )}
    </>
  );
}
