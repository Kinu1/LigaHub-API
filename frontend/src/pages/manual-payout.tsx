import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, send } from '../api';
import { useAuth } from '../auth';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Field, Notice } from '../ui';
import { date, money } from '../types';

type ManualDetails = {
  id: string;
  amountInCents: number;
  keyType: string;
  key: string;
  receiptId: string | null;
  paidAt: string | null;
};
const localDateTime = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
};
export function ManualPayout({
  payout,
}: {
  payout: { id: string; status: string; manualReservedBy?: string | null };
}) {
  const { user } = useAuth();
  const queries = useQueryClient();
  const [details, setDetails] = useState<ManualDetails>();
  const [receiptId, setReceiptId] = useState('');
  const [paidAt, setPaidAt] = useState(localDateTime);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const action = async (run: () => Promise<ManualDetails>) => {
    setBusy(true);
    setError('');
    try {
      setDetails(await run());
      await queries.invalidateQueries({ queryKey: ['payouts'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const reserved = payout.status === 'manual_reserved';
  const canPrepare =
    user?.role === 'admin' &&
    (['pending', 'held'].includes(payout.status) ||
      (reserved && payout.manualReservedBy === user.id));
  return (
    <div className="mt-3 space-y-3">
      {canPrepare && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            action(async () => {
              const result = await send<ManualDetails>(
                `/payments/payouts/${payout.id}/manual-reservation`,
              );
              setPaidAt(localDateTime());
              return result;
            })
          }
        >
          {reserved
            ? 'Retomar registro do repasse'
            : 'Reservar e visualizar repasse'}
        </Button>
      )}
      {reserved && payout.manualReservedBy !== user?.id && (
        <p>
          Repasse reservado por um administrador. Aguarde o registro do
          comprovante.
        </p>
      )}
      {payout.status === 'manual_paid' && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            action(() => api(`/payments/payouts/${payout.id}/receipt`))
          }
        >
          Ver registro do comprovante
        </Button>
      )}
      {details && payout.status !== 'manual_paid' && (
        <form
          className="max-w-xl space-y-4 rounded-md border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!sent) return;
            void action(async () => {
              const result = await send<ManualDetails>(
                `/payments/payouts/${payout.id}/manual-confirmation`,
                {
                  receiptId: receiptId.trim(),
                  paidAt: new Date(paidAt).toISOString(),
                  amountInCents: details.amountInCents,
                },
              );
              setMessage(
                'Repasse manual registrado. O comprovante foi informado pela plataforma.',
              );
              return result;
            });
          }}
        >
          <p className="font-semibold">
            Valor integral do repasse: {money(details.amountInCents)}.
          </p>
          <p className="break-all">
            Chave Pix do destino reservado: {details.keyType} · {details.key}
          </p>
          <p className="text-muted-foreground">
            Confira seu extrato e o beneficiário no aplicativo do Mercado Pago.
            Faça o envio uma única vez e registre os dados do comprovante
            abaixo. Esta tela não envia dinheiro.
          </p>
          <Field label="ID da transação no comprovante">
            <Input
              value={receiptId}
              onChange={(e) => setReceiptId(e.target.value)}
              required
              minLength={6}
              maxLength={120}
              autoComplete="off"
              disabled={busy}
            />
          </Field>
          <Field label="Data e hora da transferência">
            <Input
              type="datetime-local"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              required
              max={localDateTime()}
              disabled={busy}
            />
          </Field>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={sent}
              onChange={(e) => setSent(e.target.checked)}
              required
              disabled={busy}
            />
            Já transferi o valor integral para a chave Pix indicada.
          </label>
          <Button type="submit" disabled={busy || !sent}>
            {busy ? 'Registrando…' : 'Registrar repasse realizado'}
          </Button>
        </form>
      )}
      {details?.receiptId && (
        <div className="space-y-1 break-all">
          <p>ID da transação: {details.receiptId}</p>
          <p>Data informada: {date(details.paidAt!)}</p>
          <p>Valor registrado: {money(details.amountInCents)}</p>
          <p className="text-muted-foreground">
            Registro informado pela plataforma; não é uma confirmação bancária
            automática.
          </p>
        </div>
      )}
      {error && <Notice>{error}</Notice>}
      {message && <Notice success>{message}</Notice>}
    </div>
  );
}
