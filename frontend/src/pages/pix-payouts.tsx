import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, send } from '../api';
import { useAuth } from '../auth';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { date, money, type Page, type User } from '../types';
import { Field, Notice, Pager } from '../ui';
import { QueryState } from './query-state';
import { ManualPayout } from './manual-payout';

type DestinationStatus = {
  platformPix: boolean;
  automaticPayoutsEnabled: boolean;
  payoutMode?: 'manual' | 'automatic';
  destination: {
    id: string;
    ownerId: string;
    keyType: string;
    key: string;
    approved: boolean;
  } | null;
};
type Payout = {
  id: string;
  registrationId: string;
  ownerId: string;
  amountInCents: number;
  status: string;
  reason?: string;
  createdAt: string;
  manualReservedBy?: string | null;
  payment?: { registration: { name: string; event: { title: string } } };
};
const statusLabels: Record<string, string> = {
  pending: 'Aguardando envio',
  processing: 'Aguardando confirmação do banco',
  paid: 'Creditado ao organizador',
  held: 'Aguardando revisão',
  unknown: 'Resultado incerto — revisão necessária',
  failed: 'Não concluído — revisão necessária',
  manual_reserved: 'Reservado para repasse manual',
  manual_paid: 'Repasse manual registrado',
};

export function PixPayoutSection() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [ownerId, setOwnerId] = useState('');
  const [keyType, setKeyType] = useState('CPF');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const owners = useQuery({
    queryKey: ['payout-owners', user?.id],
    enabled: user?.role === 'admin',
    queryFn: () => api<User[]>('/users'),
  });
  const destination = useQuery({
    queryKey: ['pix-destination', user?.id, ownerId],
    queryFn: () =>
      api<DestinationStatus>(
        `/payments/pix-destination${ownerId ? '?ownerId=' + encodeURIComponent(ownerId) : ''}`,
      ),
  });
  const payouts = useQuery({
    queryKey: ['payouts', user?.id, page],
    enabled:
      !!destination.data?.platformPix ||
      destination.data?.payoutMode === 'manual',
    queryFn: () => api<Page<Payout>>(`/payments/payouts?page=${page}`),
    refetchInterval: 30_000,
  });
  const act = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
      setKey('');
      await queryClient.invalidateQueries({ queryKey: ['pix-destination'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (destination.isPending) return null;
  if (destination.error)
    return (
      <Notice>
        Não foi possível consultar os repasses. Atualize a página para tentar
        novamente.
      </Notice>
    );
  // A interface anterior permanece quando o novo modo não está configurado.
  if (
    !destination.data?.platformPix &&
    destination.data?.payoutMode !== 'manual'
  )
    return null;
  const selected = destination.data.destination;
  const manual = destination.data.payoutMode === 'manual';
  return (
    <section className="data-section mb-6 space-y-5">
      <h2>Recebimento por Pix</h2>
      <p className="text-sm text-muted-foreground">
        O valor integral de cada inscrição paga por Pix será repassado{' '}
        {manual ? 'manualmente ' : ''}à chave aprovada do organizador. As
        tarifas ficam por conta da plataforma.
      </p>
      {manual && (
        <p className="text-sm text-muted-foreground">
          A plataforma envia o Pix pelo aplicativo do Mercado Pago e registra o
          comprovante aqui.
        </p>
      )}
      {!destination.data.platformPix && user?.role === 'admin' && (
        <Notice>
          Cadastre e aprove a chave do organizador antes de configurar o
          recebimento Pix na conta da plataforma. As cobranças atuais mantêm a
          configuração anterior.
        </Notice>
      )}
      {!manual && !destination.data.automaticPayoutsEnabled && (
        <Notice>
          Os repasses automáticos ainda não estão ativados. O cadastro da chave
          não inicia uma transferência.
        </Notice>
      )}
      {user?.role === 'admin' && (
        <Field label="Organizador do recebimento">
          <select
            className="input"
            value={ownerId}
            disabled={busy}
            onChange={(e) => {
              setOwnerId(e.target.value);
              setKey('');
              setMessage('');
              setError('');
            }}
          >
            <option value="">Selecione um organizador</option>
            {owners.data
              ?.filter((u) => u.role === 'organizer' && u.active)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        </Field>
      )}
      {(user?.role !== 'admin' || ownerId) && (
        <>
          {selected && (
            <div className="space-y-2 text-sm">
              <p>
                Chave cadastrada:{' '}
                <span className="break-all">
                  {selected.keyType} · {selected.key}
                </span>
              </p>
              <p role="status">
                {selected.approved
                  ? 'Chave Pix aprovada para receber repasses.'
                  : 'Chave Pix aguardando aprovação da plataforma.'}
              </p>
              {user?.role === 'admin' && !selected.approved && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    act(
                      () =>
                        send('/payments/pix-destination/approval', {
                          ownerId: selected.ownerId,
                          destinationId: selected.id,
                        }),
                      'Chave Pix aprovada.',
                    )
                  }
                >
                  Aprovar chave Pix conferida
                </Button>
              )}
            </div>
          )}
          <form
            className="max-w-xl space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void act(
                () =>
                  send(
                    '/payments/pix-destination',
                    { keyType, key, ...(ownerId ? { ownerId } : {}) },
                    'PUT',
                  ),
                'Chave salva. Aguarde a aprovação da plataforma.',
              );
            }}
          >
            <Field label="Tipo de chave Pix">
              <select
                className="input"
                value={keyType}
                disabled={busy}
                onChange={(e) => setKeyType(e.target.value)}
              >
                <option value="CPF">CPF</option>
                <option value="CNPJ">CNPJ</option>
                <option value="EMAIL">E-mail</option>
                <option value="PHONE">Telefone</option>
                <option value="PIX_CODE">Chave aleatória</option>
              </select>
            </Field>
            <Field
              label={selected ? 'Nova chave Pix' : 'Chave Pix'}
              hint="Informe a chave do banco em que deseja receber. Para telefone, use +55 e DDD. Alterações exigem nova aprovação."
            >
              <Input
                value={key}
                required
                maxLength={254}
                disabled={busy}
                autoComplete="off"
                onChange={(e) => setKey(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? 'Aguarde…' : 'Salvar chave Pix'}
            </Button>
          </form>
        </>
      )}
      {error && <Notice>{error}</Notice>}
      {message && <Notice success>{message}</Notice>}
      <h3>Repasses de inscrições</h3>
      <QueryState query={payouts} hasData={!!payouts.data}>
        {payouts.data?.items.length ? (
          <>
            <ul className="space-y-3">
              {payouts.data.items.map((p) => (
                <li key={p.id} className="rounded-lg border p-3 text-sm">
                  <p>
                    {date(p.createdAt)} · {money(p.amountInCents)}
                  </p>
                  <p>{statusLabels[p.status] ?? 'Aguardando revisão'}</p>
                  {p.payment && (
                    <p>
                      {p.payment.registration.event.title} ·{' '}
                      {p.payment.registration.name}
                    </p>
                  )}
                  <p className="break-all text-xs text-muted-foreground">
                    Inscrição: {p.registrationId}
                  </p>
                  {(manual || p.status === 'manual_paid') && (
                    <ManualPayout payout={p} />
                  )}
                </li>
              ))}
            </ul>
            <Pager
              page={page}
              total={payouts.data.total}
              limit={50}
              setPage={setPage}
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhum repasse registrado.
          </p>
        )}
      </QueryState>
    </section>
  );
}
