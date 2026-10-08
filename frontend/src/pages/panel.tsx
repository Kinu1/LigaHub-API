import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  ArrowUpRight,
  CalendarDays,
  Users,
  Wallet,
  Copy,
  Check,
  Search,
  Download,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { api, send, ApiError } from '../api';
import { useAuth } from '../auth';
import {
  Heading,
  Loading,
  Notice,
  Empty,
  Status,
  Pager,
  Confirm,
  Field,
} from '../ui';
import {
  money,
  date,
  type Event,
  type Page,
  type Registration,
  type User,
  type Audit,
  type Payment,
} from '../types';
function QueryState({
  query,
  children,
}: {
  query: { isPending: boolean; error: Error | null; refetch: () => unknown };
  children: ReactNode;
}) {
  if (query.isPending) return <Loading />;
  if (query.error)
    return (
      <>
        <Notice>{query.error.message}</Notice>
        <button className="btn secondary" onClick={() => query.refetch()}>
          Tentar novamente
        </button>
      </>
    );
  return <>{children}</>;
}
type Overview = {
  events: number;
  drafts: number;
  confirmed: number;
  cancellationRequests: number;
  pendingPayments: number;
  approvedBaseAmountInCents: number;
  accountConnected: boolean;
};
export function Dashboard() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ['overview'],
    queryFn: () => api<Overview>('/dashboard'),
  });
  const info = query.data;
  return (
    <>
      <Heading
        eyebrow="ESPAÇO DA LIGA"
        title={`Olá, ${user?.name.split(' ')[0] || 'organizador'}`}
        action={
          <Link className="btn" to="/painel/eventos/novo">
            <Plus size={18} />
            Criar evento
          </Link>
        }
      >
        Tudo pronto para o seu próximo encontro?
      </Heading>
      <QueryState query={query}>
        {info && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                [CalendarDays, 'Eventos', info.events],
                [Users, 'Inscrições confirmadas', info.confirmed],
                [
                  Wallet,
                  'Valor base aprovado',
                  money(info.approvedBaseAmountInCents),
                ],
                [CalendarDays, 'Pagamentos pendentes', info.pendingPayments],
              ].map(([Icon, label, value]) => {
                const I = Icon as typeof CalendarDays;
                return (
                  <div key={String(label)} className="card">
                    <div className="mb-5 flex justify-between">
                      <span className="text-sm text-zinc-500">
                        {String(label)}
                      </span>
                      <I size={18} className="text-red-700" />
                    </div>
                    <p className="text-3xl font-semibold tracking-tight">
                      {String(value)}
                    </p>
                  </div>
                );
              })}
            </div>
            <div className="mt-7 grid gap-5 lg:grid-cols-[1.5fr_1fr]">
              <section className="card">
                <p className="eyebrow">PRÓXIMOS PASSOS</p>
                <h2>O que precisa de atenção</h2>
                <div className="mt-6 space-y-4">
                  {!info.accountConnected && (
                    <Action
                      to="/painel/financeiro"
                      title="Conectar conta de recebimento"
                      description="Prepare o Mercado Pago para receber inscrições."
                    />
                  )}
                  {info.drafts > 0 && (
                    <Action
                      to="/painel/eventos?status=draft"
                      title={`${info.drafts} evento(s) em rascunho`}
                      description="Revise os detalhes e publique quando estiver pronto."
                    />
                  )}
                  {info.cancellationRequests > 0 && (
                    <Action
                      to="/painel/eventos"
                      title={`${info.cancellationRequests} solicitação(ões) de cancelamento`}
                      description="Abra as inscrições de cada evento para analisar."
                    />
                  )}
                  {info.accountConnected &&
                    info.drafts === 0 &&
                    info.cancellationRequests === 0 && (
                      <Empty title="Tudo em dia">
                        Crie um evento ou acompanhe suas inscrições.
                      </Empty>
                    )}
                </div>
              </section>
              <section className="card bg-red-50/50">
                <span className="inline-flex rounded-xl bg-white p-3 text-red-700">
                  <CalendarDays />
                </span>
                <h2 className="mt-6">O próximo encontro começa aqui.</h2>
                <p className="muted mt-3">
                  Defina os detalhes, personalize as perguntas e compartilhe o
                  link com os participantes.
                </p>
                <Link
                  to="/painel/eventos/novo"
                  className="mt-6 inline-flex items-center gap-2 font-semibold text-red-800"
                >
                  Preparar um evento <ArrowUpRight size={17} />
                </Link>
              </section>
            </div>
          </>
        )}
      </QueryState>
    </>
  );
}
function Action({
  to,
  title,
  description,
}: {
  to: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 p-4 hover:border-red-300"
    >
      <div>
        <p className="font-medium">{title}</p>
        <p className="muted mt-1 text-sm">{description}</p>
      </div>
      <ArrowUpRight size={18} />
    </Link>
  );
}
export function EventsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(
    new URLSearchParams(location.search).get('status') || '',
  );
  const query = useQuery({
    queryKey: ['events', page, search, status],
    queryFn: () =>
      api<Page<Event>>(
        `/events?page=${page}&limit=12&search=${encodeURIComponent(search)}&status=${status}`,
      ),
  });
  return (
    <>
      <Heading
        title="Eventos"
        action={
          <Link className="btn" to="/painel/eventos/novo">
            <Plus size={18} />
            Criar evento
          </Link>
        }
      >
        Organize cada detalhe do próximo encontro.
      </Heading>
      <div className="mb-6 flex flex-wrap gap-3">
        <label className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-3.5 text-zinc-400" size={18} />
          <input
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
            setStatus(e.target.value);
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
      </div>
      <QueryState query={query}>
        {query.data?.items.length ? (
          <>
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {query.data.items.map((event) => (
                <article key={event.id} className="card flex flex-col">
                  <div className="mb-7 flex justify-between">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-red-50 text-red-700">
                      <CalendarDays size={23} />
                    </span>
                    <Status value={event.status} />
                  </div>
                  <h2>{event.title}</h2>
                  <p className="muted mt-3 text-sm">{date(event.startsAt)}</p>
                  <p className="muted mt-1 text-sm">
                    {event.location || 'Local a confirmar'}
                  </p>
                  <div className="mt-6 flex justify-between border-t border-zinc-100 pt-4 text-sm">
                    <span>{money(event.priceInCents)}</span>
                    <span className="muted">{event.capacity} vagas</span>
                  </div>
                  <Link
                    className="btn secondary mt-6"
                    to={`/painel/eventos/${event.id}`}
                  >
                    Gerenciar evento <ArrowUpRight size={16} />
                  </Link>
                </article>
              ))}
            </div>
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
    <div className="card">
      <h2>Convide os participantes</h2>
      <p className="muted mt-2 text-sm">
        Compartilhe o link público quando o evento estiver publicado.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className="btn secondary"
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
        </button>
        <a
          className="btn secondary"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          Abrir página <ArrowUpRight size={16} />
        </a>
      </div>
      <p className="mt-3 break-all text-xs text-zinc-500">{url}</p>
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
          <a className="btn secondary" href={qr} download="evento-ligahub.png">
            <Download size={16} />
            Baixar QR Code
          </a>
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
  const [status, setStatus] = useState('');
  const query = useQuery({
    queryKey: ['event', id],
    queryFn: () => api<Event>(`/events/${id}`),
  });
  const registrations = useQuery({
    queryKey: ['registrations', id, page, search, status],
    queryFn: () =>
      api<Page<Registration>>(
        `/events/${id}/registrations?page=${page}&search=${encodeURIComponent(search)}&status=${status}`,
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
            className="mb-5 inline-block text-sm text-zinc-500"
            to="/painel/eventos"
          >
            ← Todos os eventos
          </Link>
          <Heading
            title={event.title}
            action={
              <Link
                className="btn secondary"
                to={`/painel/eventos/${id}/editar`}
              >
                Editar evento
              </Link>
            }
          >
            <Status value={event.status} />
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
            <section className="card">
              <h2>Informações do encontro</h2>
              <dl className="mt-5 space-y-3 text-sm">
                {[
                  ['Data', date(event.startsAt)],
                  ['Local', event.location || 'A confirmar'],
                  ['Valor', money(event.priceInCents)],
                  ['Capacidade', `${event.capacity} vagas`],
                  ['Prazo', date(event.registrationDeadline)],
                ].map(([k, v]) => (
                  <div className="flex justify-between gap-4" key={k}>
                    <dt className="muted">{k}</dt>
                    <dd className="text-right">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="muted mt-5 whitespace-pre-wrap text-sm">
                {event.description}
              </p>
            </section>
            <Share publicId={event.publicId} />
          </div>
          <div
            className="my-6 flex gap-2"
            role="tablist"
            aria-label="Dados do evento"
          >
            {[
              ['inscricoes', 'Inscrições'],
              ['historico', 'Histórico'],
            ].map(([key, label]) => (
              <button
                role="tab"
                aria-selected={tab === key}
                className={`btn ${tab === key ? '' : 'secondary'}`}
                key={key}
                onClick={() => {
                  setTab(key);
                  setPage(1);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'inscricoes' ? (
            <section className="card">
              <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_200px]">
                <input
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
                  <option value="cancellation">Cancelamento solicitado</option>
                </select>
              </div>
              <QueryState query={registrations}>
                {registrations.data?.items.length ? (
                  <>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Participante</th>
                          <th>Estado</th>
                          <th>Reserva até</th>
                          <th>Ação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {registrations.data.items.map((r) => (
                          <tr key={r.id}>
                            <td data-label="Participante">
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
                            </td>
                            <td data-label="Estado">
                              <div>
                                <Status value={r.status} />
                                {r.cancellationRequestedAt && (
                                  <p className="mt-2 text-xs text-amber-800">
                                    Cancelamento solicitado
                                  </p>
                                )}
                                {r.suspendedAt && (
                                  <p className="mt-2 text-xs">
                                    Inscrição suspensa
                                  </p>
                                )}
                              </div>
                            </td>
                            <td data-label="Reserva até">
                              {date(r.reservationExpiresAt)}
                            </td>
                            <td data-label="Ação">
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
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
            </section>
          ) : (
            <section className="card">
              <QueryState query={history}>
                <AuditList data={history.data} />
                {history.data && (
                  <Pager
                    page={page}
                    total={history.data.total}
                    setPage={setPage}
                  />
                )}
              </QueryState>
            </section>
          )}
        </>
      )}
    </QueryState>
  );
}
export function FinancePage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
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
    queryKey: ['payments', page],
    queryFn: () => api<Page<Payment>>(`/payments?page=${page}`),
  });
  return (
    <>
      <Heading title="Financeiro">
        Recebimentos e conexão com Mercado Pago.
      </Heading>
      <section className="card mb-6">
        <h2>Conta de recebimento</h2>
        <QueryState query={account}>
          <p className="muted my-4">
            {account.data?.connected
              ? 'Conta conectada ao Mercado Pago.'
              : 'Conecte a conta do organizador para habilitar pagamentos.'}{' '}
            {account.data?.isTest ? 'Ambiente de teste.' : ''}
          </p>
          <button
            className="btn"
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
          </button>
        </QueryState>
        {error && <Notice>{error}</Notice>}
      </section>
      <section className="card">
        <h2 className="mb-5">Histórico de pagamentos</h2>
        <QueryState query={payments}>
          {payments.data?.items.length ? (
            <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Forma</th>
                    <th>Valor base</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.data.items.map((p) => (
                    <tr key={p.id}>
                      <td data-label="Data">{date(p.createdAt)}</td>
                      <td data-label="Forma">
                        {p.method === 'pix'
                          ? 'Pix'
                          : `Cartão · ${p.installments}x`}
                      </td>
                      <td data-label="Valor base">{money(p.amountInCents)}</td>
                      <td data-label="Estado">
                        <Status value={p.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pager
                page={page}
                total={payments.data.total}
                limit={50}
                setPage={setPage}
              />
            </>
          ) : (
            <Empty title="Nenhum pagamento ainda" />
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
        <section className="card">
          <QueryState query={query}>
            {query.data?.map((u) => (
              <div
                className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-100 py-5"
                key={u.id}
              >
                <div>
                  <p className="font-semibold">{u.name}</p>
                  <p className="muted text-sm">{u.email}</p>
                  <p className="mt-1 text-xs">
                    {u.role === 'admin' ? 'Administrador' : 'Organizador'} ·{' '}
                    {u.active ? 'Ativo' : 'Suspenso'}
                  </p>
                </div>
                <Confirm
                  title={u.active ? 'Suspender usuário?' : 'Reativar usuário?'}
                  description="A API verifica as permissões e protege o último administrador ativo."
                  onConfirm={async () => {
                    await send(
                      `/users/${u.id}/status`,
                      { active: !u.active },
                      'PATCH',
                    );
                    await client.invalidateQueries({ queryKey: ['users'] });
                  }}
                >
                  {u.active ? 'Suspender' : 'Reativar'}
                </Confirm>
              </div>
            ))}
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
            <input {...form.register('name')} autoComplete="off" />
          </Field>
          <Field label="E-mail" error={form.formState.errors.email?.message}>
            <input
              {...form.register('email')}
              type="email"
              autoComplete="off"
            />
          </Field>
          <Field
            label="Senha inicial"
            error={form.formState.errors.password?.message}
          >
            <input
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
          <button className="btn" disabled={form.formState.isSubmitting}>
            Criar acesso
          </button>
        </form>
      </div>
    </>
  );
}
function AuditList({ data }: { data?: Page<Audit> }) {
  return data?.items.length ? (
    <div className="space-y-4">
      {data.items.map((a) => (
        <div
          className="flex flex-wrap justify-between gap-3 border-b border-zinc-100 pb-4"
          key={a.id}
        >
          <div>
            <p className="font-medium">{a.action}</p>
            <p className="muted text-xs">{a.entityType}</p>
          </div>
          <time className="text-sm text-zinc-500">{date(a.createdAt)}</time>
        </div>
      ))}
    </div>
  ) : (
    <Empty title="Nenhum registro no histórico" />
  );
}
export function AuditPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['audit', page],
    queryFn: () => api<Page<Audit>>(`/admin/audit?page=${page}`),
    enabled: user?.role === 'admin',
  });
  if (user?.role !== 'admin')
    return <Notice>Você não tem acesso a esta área.</Notice>;
  return (
    <>
      <Heading title="Auditoria">Histórico de ações da plataforma.</Heading>
      <section className="card">
        <QueryState query={query}>
          <AuditList data={query.data} />
          {query.data && (
            <Pager page={page} total={query.data.total} setPage={setPage} />
          )}
        </QueryState>
      </section>
    </>
  );
}
