import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Empty, Heading, Loading, Notice, Status } from '../ui';
import { date, labels, money, type Event, type Page } from '../types';
import type { ReactNode } from 'react';

type Overview = {
  events: number;
  drafts: number;
  confirmed: number;
  cancellationRequests: number;
  pendingPayments: number;
  approvedBaseAmountInCents: number;
  accountConnected: boolean;
};

function SectionState({ query, name, children }: {
  query: { isPending: boolean; error: Error | null; data: unknown; refetch: () => unknown };
  name: string;
  children: ReactNode;
}) {
  return <>
    {query.isPending && <Loading />}
    {query.error && <Notice>
      Não foi possível atualizar {name}. {query.data ? 'Os dados anteriores podem estar desatualizados.' : 'Os demais blocos continuam disponíveis.'}{' '}
      <button className="underline" onClick={() => void query.refetch()}>Tentar novamente: {name}</button>
    </Notice>}
    {query.data != null && children}
  </>;
}

export function Dashboard() {
  const { user } = useAuth();
  const admin = user?.role === 'admin';
  const overview = useQuery({
    queryKey: ['overview', user?.id, user?.role],
    queryFn: () => api<Overview>('/dashboard'),
  });
  const recent = useQuery({
    queryKey: ['events', 'recent', user?.id, user?.role],
    queryFn: () => api<Page<Event>>('/events?page=1&limit=5'),
  });
  const info = overview.data;
  const scope = admin ? 'Todos os eventos da plataforma' : 'Somente os seus eventos';
  return <>
    <Heading title="Visão geral" eyebrow={admin ? 'ADMINISTRAÇÃO' : 'GESTÃO DE EVENTOS'} action={<Link className="btn" to="/painel/eventos/novo"><Plus size={18} aria-hidden="true" />Criar evento</Link>}>
      {scope}. Acompanhe inscrições e prioridades de gestão.
    </Heading>
    <SectionState query={overview} name="o resumo">
      {info && <>
        <div className="dashboard-metrics grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['Eventos', info.events, scope],
            ['Inscrições confirmadas', info.confirmed, 'Inscrições no estado confirmado'],
            ['Valor base aprovado', money(info.approvedBaseAmountInCents), 'Tentativas aprovadas; não é saldo nem receita líquida'],
            ['Pagamentos pendentes', info.pendingPayments, 'Tentativas criadas, pendentes, em análise, autorizadas ou em mediação'],
          ].map(([label, value, context]) => <section className="card metric-card min-w-0" key={label}>
            <h2 className="text-sm font-medium">{label}</h2>
            <p className="my-3 break-words text-3xl font-semibold tabular-nums">{value}</p>
            <p className="muted text-xs">{context}</p>
          </section>)}
        </div>
      </>}
    </SectionState>
    <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <section className="card min-w-0" aria-labelledby="recent-events-heading">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 id="recent-events-heading">Eventos recentes</h2><Link className="text-sm underline" to="/painel/eventos">Ver todos os eventos</Link></div>
        <p className="muted mb-3 text-xs">Até 5 eventos, em ordem de criação, do mais recente ao mais antigo.</p>
        <SectionState query={recent} name="os eventos recentes">
          {recent.data?.items.length ? <ul className="divide-y divide-zinc-200">
            {recent.data.items.map(event => <li key={event.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0 flex-1"><Link className="break-words font-medium hover:underline" to={`/painel/eventos/${event.id}`} aria-label={`Gerenciar evento ${event.title}`}>{event.title}</Link><p className="muted mt-1 text-sm">{date(event.startsAt)}</p></div><Status value={event.status} />
            </li>)}
          </ul> : <Empty title="Nenhum evento ainda"><Link className="underline" to="/painel/eventos/novo">Criar seu primeiro evento</Link></Empty>}
        </SectionState>
      </section>
      <section className="card min-w-0" aria-labelledby="priorities-heading">
        <h2 id="priorities-heading">Prioridades</h2>
        <SectionState query={overview} name="as prioridades">
          {info && <div className="mt-4 space-y-4">
            {info.drafts > 0 && <Link className="block underline" to="/painel/eventos?status=draft">Revisar {info.drafts} evento(s) em rascunho</Link>}
            {info.cancellationRequests > 0 && <div><Link className="underline" to="/painel/eventos?attention=cancellation">Analisar {info.cancellationRequests} solicitação(ões) de cancelamento por evento</Link><p className="muted mt-1 text-xs">Selecione o evento para abrir suas inscrições com o filtro de cancelamentos solicitados.</p></div>}
            {info.pendingPayments > 0 && <div><p className="font-medium">Consultar {info.pendingPayments} tentativa(s) de pagamento pendente(s)</p><p className="muted mt-1 text-xs">Escolha um estado para consultar o histórico financeiro:</p><div className="mt-2 flex flex-wrap gap-3">{['created', 'pending', 'in_process', 'authorized', 'in_mediation'].map(status => <Link className="text-sm underline" key={status} to={`/painel/financeiro?status=${status}`}>{labels[status]}</Link>)}</div></div>}
            {info.drafts === 0 && info.cancellationRequests === 0 && info.pendingPayments === 0 && <Empty title="Nenhuma prioridade pendente">Acompanhe os eventos e suas inscrições.</Empty>}
          </div>}
        </SectionState>
      </section>
    </div>
    {info && <section className="card account-strip mt-5 flex flex-wrap items-center justify-between gap-3" aria-label="Conta de recebimento"><div><h2 className="text-base">Mercado Pago</h2><p className="muted text-sm">{info.accountConnected ? 'Conta de recebimento conectada.' : 'Conta de recebimento não conectada.'}{admin ? ' Conta do organizador ativo.' : ''}{overview.error ? ' Situação anterior; atualização indisponível.' : ''}</p></div><Link className="btn secondary" to="/painel/financeiro">{info.accountConnected ? 'Gerenciar conexão' : 'Conectar conta'}</Link></section>}
    {admin && <nav aria-label="Administração" className="mt-5 flex flex-wrap gap-4 text-sm"><Link className="underline" to="/painel/usuarios">Usuários</Link><Link className="underline" to="/painel/auditoria">Auditoria</Link><Link className="underline" to="/painel/emails">Fila de e-mails</Link><Link className="underline" to="/painel/operacao">Operação e rotinas</Link></nav>}
  </>;
}
