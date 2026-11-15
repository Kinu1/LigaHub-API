import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/table';
import { Button } from '../components/ui/button';
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
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {query.isFetching ? 'Atualizando...' : 'Atualizar diagnóstico'}
        </Button>
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
          <div className="data-section">
            <h2 className="text-lg font-semibold mb-4">
              Habilitação do sistema
            </h2>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
              <div className="min-w-0 border-l border-border pl-3">
                <dt className="muted">Endpoints HTTP de rotina</dt>
                <dd className="font-semibold text-base mt-1">
                  {query.data.flags.backgroundJobsEnabled ? (
                    <span className="text-success">Habilitado</span>
                  ) : (
                    <span className="text-muted-foreground">Desabilitado</span>
                  )}
                </dd>
              </div>
              <div className="min-w-0 border-l border-border pl-3">
                <dt className="muted">Timers automáticos</dt>
                <dd className="font-semibold text-base mt-1">
                  {query.data.flags.backgroundTimersEnabled ? (
                    <span className="text-success">Ativo</span>
                  ) : (
                    <span className="text-muted-foreground">Inativo</span>
                  )}
                </dd>
              </div>
              <div className="min-w-0 border-l border-border pl-3">
                <dt className="muted">Envio de e-mails</dt>
                <dd className="font-semibold text-base mt-1">
                  {query.data.flags.emailDeliveryEnabled ? (
                    <span className="text-success">Ativo</span>
                  ) : (
                    <span className="text-muted-foreground">Inativo</span>
                  )}
                </dd>
              </div>
              <div className="min-w-0 border-l border-border pl-3">
                <dt className="muted">Reconciliação de pagamentos</dt>
                <dd className="font-semibold text-base mt-1">
                  {query.data.flags.paymentReconciliationEnabled ? (
                    <span className="text-success">Ativo</span>
                  ) : (
                    <span className="text-muted-foreground">Inativo</span>
                  )}
                </dd>
              </div>
            </dl>
          </div>

          {/* Rotinas de segundo plano */}
          <div className="data-section">
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

            <Table className="data-table" aria-label="Rotinas de segundo plano">
              <TableHeader>
                <TableRow>
                  <TableHead>Rotina / estado</TableHead>
                  <TableHead>Execução (Brasília)</TableHead>
                  <TableHead>Contadores da última execução</TableHead>
                  <TableHead className="md:text-right">Totais</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.routines.map((routine) => (
                  <TableRow key={routine.name}>
                    <TableCell
                      data-label="Rotina / estado"
                      className="whitespace-normal break-words"
                    >
                      <h3 className="text-sm font-semibold">
                        {routineLabels[routine.name] ?? routine.name}
                      </h3>
                      <p
                        className={`mt-2 text-xs ${routine.status === 'completed' ? 'text-success' : routine.status === 'failed' ? 'text-destructive' : ['partial', 'running', 'unfinished'].includes(routine.status ?? '') ? 'text-warning' : 'text-muted-foreground'}`}
                      >
                        {statusLabels[routine.status ?? ''] ?? 'Sem execução'}
                      </p>
                      {routine.activeLease && routine.status !== 'running' && (
                        <p className="text-xs text-warning">Em execução</p>
                      )}
                      {routine.errorCode && (
                        <p className="mt-2 text-xs text-destructive">
                          Classificação:{' '}
                          {errorCategories[routine.errorCode] ??
                            routine.errorCode}
                        </p>
                      )}
                    </TableCell>
                    <TableCell
                      data-label="Execução (Brasília)"
                      className="whitespace-normal"
                    >
                      <dl className="space-y-2 text-xs">
                        {[
                          [
                            'Último sucesso verificável',
                            routine.lastSucceededAt,
                          ],
                          ['Última tentativa', routine.startedAt],
                          ['Última falha', routine.lastFailedAt],
                          ['Término', routine.finishedAt],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <dt className="text-muted-foreground">{label}</dt>
                            <dd>{date(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    </TableCell>
                    <TableCell
                      data-label="Contadores da última execução"
                      className="whitespace-normal"
                    >
                      {(routine.status === 'running' ||
                        routine.status === 'unfinished') && (
                        <p className="mb-2 text-xs text-muted-foreground">
                          Contadores disponíveis após o término
                        </p>
                      )}
                      <dl className="space-y-1 text-xs tabular-nums">
                        {[
                          ['Processados', routine.processedCount],
                          ['Sucessos', routine.succeededCount],
                          ['Falhas', routine.failedCount],
                          ['Ignorados', routine.skippedCount],
                        ].map(([label, value]) => (
                          <div
                            key={label}
                            className="flex flex-wrap justify-between gap-3"
                          >
                            <dt>{label}</dt>
                            <dd>{value ?? '—'}</dd>
                          </div>
                        ))}
                      </dl>
                    </TableCell>
                    <TableCell
                      data-label="Totais"
                      className="whitespace-normal tabular-nums md:text-right"
                    >
                      <p>Execuções totais: {routine.runCount}</p>
                      <p>Falhas registradas: {routine.failureCount}</p>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Filas de e-mails: Confirmação vs Acesso */}
          <div className="data-section">
            <h2 className="text-lg font-semibold mb-2">Filas de e-mails</h2>
            <p className="text-xs muted mb-4">
              Aceito pelo provedor não significa entregue na caixa de entrada do
              participante.
            </p>

            <Table className="data-table" aria-label="Filas de e-mails">
              <TableHeader>
                <TableRow>
                  <TableHead>Fila</TableHead>
                  {[
                    'Pendentes',
                    'Em processamento',
                    'Aceitos pelo provedor',
                    'Falhas',
                    'Ignorados',
                  ].map((label) => (
                    <TableHead key={label} className="md:text-right">
                      {label}
                    </TableHead>
                  ))}
                  <TableHead>Próximo agendado mais antigo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(
                  [
                    ['confirmation', 'Confirmações de inscrição'],
                    ['access', 'Links de acesso e gestão'],
                  ] as const
                ).map(([key, title]) => {
                  const queue = query.data.queues[key];
                  return (
                    <TableRow key={key}>
                      <TableCell
                        data-label="Fila"
                        className="whitespace-normal font-medium"
                      >
                        {title}
                      </TableCell>
                      {(
                        [
                          ['pending', 'Pendentes'],
                          ['processing', 'Em processamento'],
                          ['sent', 'Aceitos pelo provedor'],
                          ['failed', 'Falhas'],
                          ['skipped', 'Ignorados'],
                        ] as const
                      ).map(([field, label]) => (
                        <TableCell
                          key={field}
                          data-label={label}
                          className={`tabular-nums md:text-right ${field === 'failed' ? 'text-destructive' : field === 'sent' ? 'text-success' : field === 'processing' ? 'text-warning' : ''}`}
                        >
                          {queue[field]}
                        </TableCell>
                      ))}
                      <TableCell
                        data-label="Próximo agendado mais antigo"
                        className="whitespace-normal"
                      >
                        {date(queue.oldestNextAttemptAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Consultas de pagamento com erro */}
          <div className="data-section">
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
              <div className="min-w-0">
                <Table
                  className="data-table"
                  aria-label="Pagamentos com falha de sincronização"
                >
                  <TableHeader>
                    <TableRow className="border-b border-border">
                      <TableHead className="py-2.5 px-3">
                        Identificador
                      </TableHead>
                      <TableHead className="py-2.5 px-3">Evento</TableHead>
                      <TableHead className="py-2.5 px-3 md:text-right">
                        Valor
                      </TableHead>
                      <TableHead className="py-2.5 px-3">
                        Categoria do erro
                      </TableHead>
                      <TableHead className="py-2.5 px-3">
                        Última tentativa de sync
                      </TableHead>
                      <TableHead className="py-2.5 px-3">
                        Último sucesso
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-border">
                    {query.data.failedPayments.items.map((item) => (
                      <TableRow key={item.id} className="hover:bg-muted/50">
                        <TableCell
                          data-label="Identificador"
                          className="py-3 px-3 whitespace-normal break-words"
                        >
                          <span className="font-mono text-xs block">
                            {item.id.slice(0, 8)}...
                          </span>
                          <span className="text-xs muted font-mono">
                            Inscrição: {item.registrationId.slice(0, 8)}...
                          </span>
                        </TableCell>
                        <TableCell
                          data-label="Evento"
                          className="py-3 px-3 whitespace-normal break-words"
                        >
                          <span className="font-medium">
                            {item.event?.title ?? 'Evento não informado'}
                          </span>
                          <span className="block text-xs muted uppercase">
                            {item.method}
                          </span>
                        </TableCell>
                        <TableCell
                          data-label="Valor"
                          className="py-3 px-3 font-medium whitespace-normal break-words tabular-nums md:text-right"
                        >
                          {money(item.amountInCents)}
                        </TableCell>
                        <TableCell
                          data-label="Categoria do erro"
                          className="py-3 px-3 whitespace-normal break-words"
                        >
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-destructive/10 text-destructive">
                            {errorCategories[item.lastSyncErrorCode ?? ''] ??
                              item.lastSyncErrorCode ??
                              'Erro não informado'}
                          </span>
                        </TableCell>
                        <TableCell
                          data-label="Última tentativa de sync"
                          className="py-3 px-3 text-xs whitespace-normal break-words"
                        >
                          {date(item.lastSyncAttemptAt)}
                        </TableCell>
                        <TableCell
                          data-label="Último sucesso"
                          className="py-3 px-3 text-xs whitespace-normal break-words"
                        >
                          {date(item.lastSyncSucceededAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
