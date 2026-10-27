import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Confirm, Empty, Heading, Loading, Notice, Pager } from '../ui';
import type { Page } from '../types';

type Status = 'pending' | 'processing' | 'sent' | 'failed' | 'skipped';
type Entry = {
  id: string;
  registrationId: string;
  status: Status;
  attempts: number;
  createdAt: string;
  firstAttemptAt: string | null;
  nextAttemptAt: string | null;
  leaseExpiresAt: string | null;
  sentAt: string | null;
  reason:
    | 'idempotency_window_expired'
    | 'attempt_limit_reached'
    | 'manual_review_required'
    | null;
};
const statuses: Record<Status, string> = {
  pending: 'Pendente',
  processing: 'Em processamento',
  sent: 'Aceito pelo provedor',
  failed: 'Falhou',
  skipped: 'Ignorado',
};
const reasons = {
  idempotency_window_expired: 'Janela de idempotência expirada',
  attempt_limit_reached: 'Limite de tentativas atingido',
  manual_review_required: 'Revisão manual necessária',
};
function date(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Não disponível';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}
function eligible(item: Entry) {
  const elapsed = item.firstAttemptAt
    ? Date.now() - Date.parse(item.firstAttemptAt)
    : NaN;
  return (
    item.status === 'failed' && elapsed >= 0 && elapsed < 23 * 60 * 60 * 1000
  );
}
export function OutboxPage() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (user?.role !== 'admin')
    return <Notice>Você não tem acesso à fila de e-mails.</Notice>;
  return <AdminOutbox key={user.id} />;
}
function AdminOutbox() {
  const [status, setStatus] = useState<Status>('failed');
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState('');
  const inFlight = useRef(false);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['email-outbox', status, page],
    queryFn: () =>
      api<Page<Entry>>(
        `/admin/email-outbox?status=${status}&page=${page}&limit=20`,
      ),
  });
  async function retry(item: Entry) {
    if (inFlight.current) return;
    if (!eligible(item))
      throw new Error(
        'A janela segura terminou. Atualize a fila para conferir a situação.',
      );
    inFlight.current = true;
    setMessage('');
    try {
      // Esta operação não deve ser repetida automaticamente após uma falha de sessão.
      await api<{ id: string; status: 'sent' }>(
        `/admin/email-outbox/${encodeURIComponent(item.id)}/retry`,
        { method: 'POST' },
        false,
      );
      setMessage(
        'Mensagem aceita pelo provedor. Isso não confirma entrega na caixa de entrada.',
      );
    } catch (error) {
      throw new Error(
        error instanceof ApiError && error.status === 409
          ? 'Retomada recusada por segurança. Revise a situação atual antes de continuar.'
          : error instanceof ApiError && error.status === 503
            ? 'Retomada indisponível ou com resultado incerto. Atualize a fila e confira a configuração antes de outra tentativa.'
            : 'Não foi possível confirmar a retomada. O resultado pode ser incerto; atualize e revise antes de tentar novamente.',
      );
    } finally {
      await client.invalidateQueries({ queryKey: ['email-outbox'] });
      inFlight.current = false;
    }
  }
  return (
    <>
      <Heading title="Fila de e-mails">
        Acompanhe o processamento. Aceito pelo provedor não significa entregue
        na caixa de entrada.
      </Heading>
      <div className="card mb-5 flex flex-wrap items-end gap-4">
        <div className="field">
          <label htmlFor="outbox-status">Status</label>
          <select
            id="outbox-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as Status);
              setPage(1);
              setMessage('');
            }}
          >
            {Object.entries(statuses).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <button
          className="btn secondary"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Atualizar fila
        </button>
      </div>
      {message && <Notice success>{message}</Notice>}
      {query.isError && (
        <Notice>
          Não foi possível atualizar a fila.{' '}
          {query.data
            ? 'Os dados anteriores foram mantidos e podem estar desatualizados.'
            : 'Os dados não estão disponíveis.'}
        </Notice>
      )}
      {query.isPending && <Loading />}
      {query.data && (
        <div className="card">
          {!query.data.items.length && !query.isError && (
            <Empty title="Nenhum e-mail neste status" />
          )}
          <ol className="divide-y divide-zinc-100">
            {query.data.items.map((item) => (
              <li key={item.id} className="py-5 space-y-3">
                <h2 className="font-semibold">
                  {statuses[item.status] ?? 'Status não reconhecido'}
                </h2>
                <p>Tentativas: {item.attempts}</p>
                {item.status === 'failed' && (
                  <p>
                    Classificação atual:{' '}
                    {item.reason
                      ? (reasons[item.reason] ?? 'Não disponível')
                      : 'Sem classificação informada'}
                    . Esta classificação não comprova a causa histórica da
                    falha.
                  </p>
                )}
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  {(
                    [
                      ['Criado em', item.createdAt],
                      ['Primeira tentativa', item.firstAttemptAt],
                      ...(item.status === 'pending'
                        ? [['Próxima tentativa', item.nextAttemptAt] as const]
                        : []),
                      ...(item.status === 'processing'
                        ? [
                            [
                              'Fim da reserva de processamento',
                              item.leaseExpiresAt,
                            ] as const,
                          ]
                        : []),
                      ...(item.sentAt
                        ? [['Aceito pelo provedor em', item.sentAt] as const]
                        : []),
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <dt className="muted">{label} (Brasília)</dt>
                      <dd>{date(value)}</dd>
                    </div>
                  ))}
                </dl>
                <details className="text-sm">
                  <summary className="cursor-pointer">Identificadores</summary>
                  <dl className="break-all">
                    <dt>ID do e-mail</dt>
                    <dd>{item.id}</dd>
                    <dt>ID da inscrição</dt>
                    <dd>{item.registrationId}</dd>
                  </dl>
                </details>
                {eligible(item) ? (
                  <Confirm
                    title="Retomar e-mail?"
                    description="A retomada reutiliza a mensagem e a chave originais. Com SMTP, uma falha incerta pode causar duplicidade. A API decide a elegibilidade final da retomada."
                    onConfirm={() => retry(item)}
                  >
                    Retomar e-mail
                  </Confirm>
                ) : (
                  item.status === 'failed' && (
                    <p className="muted text-sm">
                      Retomada indisponível: exige primeira tentativa conhecida
                      há menos de 23 horas. Revise manualmente.
                    </p>
                  )
                )}
              </li>
            ))}
          </ol>
          <Pager
            page={page}
            total={query.data.total}
            limit={query.data.limit}
            setPage={setPage}
          />
        </div>
      )}
    </>
  );
}
