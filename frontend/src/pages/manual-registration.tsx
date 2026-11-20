import { useRef, useState } from 'react';
import { ApiError, send } from '../api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog';
import type { Event } from '../types';
import { Field, Notice } from '../ui';

export function validManualCpf(value: string) {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  return [9, 10].every((length) => {
    const sum = [...value.slice(0, length)].reduce(
      (total, digit, index) => total + Number(digit) * (length + 1 - index),
      0,
    );
    return ((sum * 10) % 11) % 10 === Number(value[length]);
  });
}

export function ManualRegistration({
  event,
  onCreated,
  onDuplicate,
}: {
  event: Event;
  onCreated: () => Promise<unknown>;
  onDuplicate: (email: string, id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const [duplicate, setDuplicate] = useState<{ id: string; email: string }>();
  const [created, setCreated] = useState(false);
  const unavailable =
    event.status === 'closed' ||
    !event.startsAt ||
    new Date(event.startsAt) <= new Date() ||
    (!!event.endsAt && new Date(event.endsAt) <= new Date());
  const types = event.registrationTypes?.length
    ? event.registrationTypes
    : [{ id: 'geral', name: 'Inscrição geral' }];
  return (
    <>
      {created && (
        <div className="basis-full">
          <Notice success>
            Cortesia confirmada. A confirmação por e-mail está pendente na fila;
            a vaga já está garantida.
          </Notice>
        </div>
      )}
      {unavailable && (
        <p className="muted basis-full text-sm">
          Para adicionar uma cortesia, configure o início futuro de um evento
          não encerrado.
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (submitting.current) return;
          setOpen(next);
          setError('');
          setDuplicate(undefined);
        }}
      >
        <DialogTrigger asChild>
          <Button disabled={unavailable}>Adicionar participante</Button>
        </DialogTrigger>
        <DialogContent
          className="flex max-h-[90dvh] flex-col overflow-hidden p-0"
          showCloseButton={!busy}
          onEscapeKeyDown={(e) => {
            if (busy) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          <DialogHeader className="shrink-0 px-6 pt-6 pr-14">
            <DialogTitle>Adicionar participante</DialogTitle>
            <DialogDescription>
              Confirme uma cortesia com valor R$ 0,00. A categoria será
              preservada e nenhuma cobrança será gerada.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex min-h-0 flex-col"
            onSubmit={async (e) => {
              e.preventDefault();
              if (submitting.current) return;
              const data = new FormData(e.currentTarget);
              const name = String(data.get('name')).trim();
              const cpf = String(data.get('cpf')).replace(/[.\-\s]/g, '');
              const email = String(data.get('email')).trim().toLowerCase();
              setError('');
              setDuplicate(undefined);
              if (!/^\S+\s+\S/.test(name)) {
                setError('Informe o nome completo do participante.');
                return;
              }
              if (!validManualCpf(cpf)) {
                setError('Informe um CPF válido para o participante.');
                return;
              }
              const answers: Record<string, unknown> = {};
              for (const field of event.form) {
                const value = data.get(`answer-${field.id}`);
                if (field.type === 'checkbox')
                  answers[field.id] = value === 'on';
                else if (value !== null && value !== '')
                  answers[field.id] =
                    field.type === 'number' ? Number(value) : value;
              }
              submitting.current = true;
              setBusy(true);
              try {
                await send(`/events/${event.id}/registrations/manual`, {
                  name,
                  cpf,
                  email,
                  registrationTypeId: data.get('registrationTypeId'),
                  answers,
                });
                setCreated(true);
                setOpen(false);
                // A refresh failure must not encourage submitting an already saved courtesy again.
                await onCreated().catch(() => undefined);
              } catch (failure) {
                setError((failure as Error).message);
                if (
                  failure instanceof ApiError &&
                  failure.status === 409 &&
                  failure.registrationId
                )
                  setDuplicate({ id: failure.registrationId, email });
              } finally {
                submitting.current = false;
                setBusy(false);
              }
            }}
          >
            <div className="min-h-0 space-y-4 overflow-y-auto px-6 py-4">
              {error && <Notice>{error}</Notice>}
              {duplicate && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    onDuplicate(duplicate.email, duplicate.id);
                    setOpen(false);
                  }}
                >
                  Localizar inscrição existente
                </Button>
              )}
              <fieldset disabled={busy} className="space-y-4">
                <Field label="Nome completo">
                  <Input
                    name="name"
                    required
                    minLength={3}
                    maxLength={120}
                    autoComplete="name"
                  />
                </Field>
                <Field label="E-mail">
                  <Input
                    name="email"
                    type="email"
                    required
                    maxLength={254}
                    autoComplete="email"
                  />
                </Field>
                <Field label="CPF do participante">
                  <Input
                    name="cpf"
                    required
                    inputMode="numeric"
                    maxLength={14}
                    placeholder="000.000.000-00"
                  />
                </Field>
                <Field label="Categoria">
                  <select
                    name="registrationTypeId"
                    required
                    defaultValue={types[0].id}
                  >
                    {types.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {event.form.map((field) => (
                  <Field
                    key={field.id}
                    label={`${field.label}${field.required ? ' (obrigatório)' : ''}`}
                  >
                    {field.type === 'select' ? (
                      <select
                        name={`answer-${field.id}`}
                        required={field.required}
                        defaultValue=""
                      >
                        <option value="">Selecione</option>
                        {field.options?.map((option) => (
                          <option key={option}>{option}</option>
                        ))}
                      </select>
                    ) : field.type === 'checkbox' ? (
                      <input
                        name={`answer-${field.id}`}
                        type="checkbox"
                        required={field.required}
                      />
                    ) : (
                      <Input
                        name={`answer-${field.id}`}
                        required={field.required}
                        type={field.type === 'number' ? 'number' : 'text'}
                        step={field.type === 'number' ? 'any' : undefined}
                        maxLength={field.type === 'text' ? 2000 : undefined}
                      />
                    )}
                  </Field>
                ))}
              </fieldset>
            </div>
            <DialogFooter className="shrink-0 border-t px-6 py-4">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Salvando…' : 'Confirmar cortesia'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
