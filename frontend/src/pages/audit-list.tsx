import { Empty } from '../ui';
import { labels, money, reviewReasons, type Audit, type Page } from '../types';

export const auditCategories: Record<string, string> = {
  user: 'Usuários',
  event: 'Eventos',
  registration: 'Inscrições',
  payment: 'Pagamentos',
  payment_account: 'Contas de recebimento',
};

const actions: Record<string, string> = {
  'registration:registration.payment_review_confirmed':
    'Confirmação reavaliada e autorizada',
  'registration:registration.payment_review_blocked':
    'Confirmação reavaliada e bloqueada',
  'user:login': 'Acesso à plataforma realizado',
  'user:logout': 'Sessões de acesso encerradas',
  'user:user.created': 'Usuário criado',
  'user:status_updated': 'Situação de acesso do usuário alterada',
  'event:created': 'Evento criado',
  'event:updated': 'Dados do evento alterados',
  'event:published': 'Evento publicado',
  'event:suspended': 'Evento suspenso',
  'event:closed': 'Evento encerrado',
  'event:reservations.expired': 'Reservas vencidas marcadas como expiradas',
  'registration:registration.reserved': 'Inscrição reservada',
  'registration:cancellation.requested': 'Cancelamento da inscrição solicitado',
  'registration:registration.email_retry_authorized':
    'Retomada do envio de confirmação autorizada',
  'registration:registration.canceled':
    'Inscrição cancelada após devolução do pagamento',
  'registration:reservation.renewed': 'Reserva da inscrição renovada',
  'registration:reservation.pix_extended':
    'Prazo da reserva ampliado para pagamento Pix',
  'registration:registration.confirmed':
    'Inscrição confirmada após aprovação do pagamento',
  'registration:registration.payment_review':
    'Inscrição encaminhada para revisão do pagamento',
  'registration:registration.suspended': 'Inscrição suspensa',
  'registration:registration.resumed': 'Suspensão da inscrição removida',
  'payment:payment.created': 'Tentativa de pagamento criada',
  'payment:payment.updated': 'Situação do pagamento atualizada',
  'payment:payment.request_rejected':
    'Solicitação de pagamento recusada pelo provedor',
  'payment_account:payment_account.connected': 'Conta de recebimento conectada',
  'payment_account:payment_account.sandbox_connected':
    'Conta de teste conectada para recebimento',
};

const fields: Record<string, string> = {
  title: 'Título',
  description: 'Descrição',
  location: 'Local',
  startsAt: 'Início',
  endsAt: 'Término',
  registrationDeadline: 'Prazo de inscrição',
  reservationMinutes: 'Duração da reserva',
  capacity: 'Número de vagas',
  priceInCents: 'Preço',
  form: 'Formulário de inscrição',
  ownerId: 'Organizador responsável',
};
const roles: Record<string, string> = {
  admin: 'Administrador',
  organizer: 'Organizador',
};
const reasons: Record<string, string> = {
  ...reviewReasons,
  payment_approved: 'Pagamento aprovado',
  payment_refunded: 'Pagamento reembolsado integralmente',
  not_submitted_before_expiration:
    'Tentativa não enviada antes da expiração da reserva',
  payment_charged_back: 'Pagamento devolvido por contestação',
  capacity_or_registration_unavailable:
    'Sem vaga disponível ou inscrição indisponível para confirmação',
};

function timestamp(value: string) {
  const instant = new Date(value);
  return Number.isNaN(instant.getTime())
    ? 'Data não disponível'
    : new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'medium',
        timeZone: 'America/Sao_Paulo',
      }).format(instant);
}

function details(audit: Audit) {
  const metadata = audit.metadata ?? {};
  const values: [string, string][] = [];
  if (typeof metadata.previousActive === 'boolean')
    values.push([
      'Acesso anterior',
      metadata.previousActive ? 'Ativo' : 'Suspenso',
    ]);
  if (typeof metadata.active === 'boolean')
    values.push([
      'Acesso após a alteração',
      metadata.active ? 'Ativo' : 'Suspenso',
    ]);
  if (typeof metadata.role === 'string')
    values.push([
      'Perfil atribuído',
      roles[metadata.role] ?? 'Perfil não reconhecido',
    ]);
  if (typeof metadata.method === 'string')
    values.push([
      'Forma de pagamento',
      metadata.method === 'pix'
        ? 'Pix'
        : metadata.method === 'card'
          ? 'Cartão'
          : 'Forma não reconhecida',
    ]);
  if (
    typeof metadata.amountInCents === 'number' &&
    Number.isFinite(metadata.amountInCents)
  )
    values.push(['Valor do pagamento', money(metadata.amountInCents)]);
  if (typeof metadata.status === 'string')
    values.push([
      'Situação registrada',
      labels[metadata.status] ?? 'Situação não reconhecida',
    ]);
  if (typeof metadata.count === 'number')
    values.push(['Reservas afetadas', String(metadata.count)]);
  if (typeof metadata.attempt === 'number')
    values.push(['Tentativa de envio', String(metadata.attempt)]);
  if (typeof metadata.expiresAt === 'string')
    values.push([
      'Novo prazo da reserva',
      `${timestamp(metadata.expiresAt)} (Brasília)`,
    ]);
  if (typeof metadata.reason === 'string')
    values.push([
      'Motivo',
      reasons[metadata.reason] ?? 'Motivo sem descrição disponível',
    ]);
  if (Array.isArray(metadata.fields)) {
    const changed = metadata.fields.flatMap((field) =>
      typeof field === 'string' && fields[field] ? [fields[field]] : [],
    );
    if (changed.length) values.push(['Campos alterados', changed.join(', ')]);
  }
  return values;
}

export function AuditList({ data }: { data?: Page<Audit> }) {
  if (!data?.items.length)
    return <Empty title="Nenhum registro no histórico" />;
  return (
    <ol className="divide-y divide-zinc-100">
      {data.items.map((audit) => {
        const title =
          actions[`${audit.entityType}:${audit.action}`] ??
          'Ação sem descrição disponível';
        const values = details(audit);
        return (
          <li key={audit.id} className="py-5 first:pt-0 last:pb-0">
            <article aria-label={title} className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    {auditCategories[audit.entityType] ?? 'Outros registros'}
                  </span>
                  <h2 className="mt-1 font-semibold">{title}</h2>
                  <p className="mt-1 break-words text-sm">
                    {audit.subject?.name ??
                      'Registro sem identificação disponível'}
                  </p>
                  {audit.subject?.eventTitle && (
                    <p className="muted mt-1 break-words text-sm">
                      Evento: {audit.subject.eventTitle}
                    </p>
                  )}
                </div>
                <time
                  dateTime={audit.createdAt}
                  className="text-sm text-zinc-500"
                >
                  {timestamp(audit.createdAt)} · Brasília
                </time>
              </div>
              <div className="text-sm">
                <p>
                  <span className="font-medium">Responsável: </span>
                  {audit.actor?.name ??
                    (audit.actorId
                      ? 'Identificação disponível nos detalhes do registro'
                      : 'Não identificado no registro')}
                </p>
                {audit.actor && (
                  <p className="muted break-words">
                    {roles[audit.actor.role] ?? 'Perfil não informado'} ·{' '}
                    {audit.actor.email}
                  </p>
                )}
              </div>
              {values.length > 0 ? (
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  {values.map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <dt className="muted">{label}</dt>
                      <dd className="break-words font-medium">{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="muted text-sm">
                  Sem detalhes adicionais registrados.
                </p>
              )}
              <details className="text-xs text-zinc-500">
                <summary className="cursor-pointer py-2 font-medium">
                  Identificadores do registro
                </summary>
                <dl className="mt-2 space-y-2 break-all">
                  <div>
                    <dt>Ação registrada</dt>
                    <dd>{audit.action}</dd>
                  </div>
                  <div>
                    <dt>Identificador da auditoria</dt>
                    <dd>{audit.id}</dd>
                  </div>
                  <div>
                    <dt>Identificador do objeto</dt>
                    <dd>{audit.entityId ?? 'Não disponível'}</dd>
                  </div>
                  <div>
                    <dt>Identificador do responsável</dt>
                    <dd>{audit.actorId ?? 'Não registrado'}</dd>
                  </div>
                  {[
                    'eventId',
                    'paymentId',
                    'providerPaymentId',
                    'merchantId',
                    'outboxId',
                  ].map((key) => {
                    const value = audit.metadata?.[key];
                    const names: Record<string, string> = {
                      eventId: 'Identificador do evento',
                      paymentId: 'Identificador do pagamento',
                      providerPaymentId: 'Identificador no provedor',
                      merchantId: 'Identificador do recebedor',
                      outboxId: 'Identificador da tarefa de e-mail',
                    };
                    return typeof value === 'string' ||
                      typeof value === 'number' ? (
                      <div key={key}>
                        <dt>{names[key]}</dt>
                        <dd>{String(value)}</dd>
                      </div>
                    ) : null;
                  })}
                </dl>
              </details>
            </article>
          </li>
        );
      })}
    </ol>
  );
}
