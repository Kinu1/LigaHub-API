import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { send } from '../api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Field, Heading, Notice } from '../ui';
const recoverySchema = z.object({
  publicId: z.uuid('Informe o identificador ou link completo do evento.'),
  email: z.email('Informe o e-mail usado na inscrição.'),
});
export function RecoveryPage() {
  const [params] = useSearchParams();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const form = useForm<z.infer<typeof recoverySchema>>({
    resolver: zodResolver(recoverySchema),
    defaultValues: { publicId: params.get('evento') || '', email: '' },
  });
  return (
    <div className="mx-auto max-w-lg">
      <Heading eyebrow="ACOMPANHAMENTO" title="Volte à sua inscrição">
        Solicite um novo link pessoal no e-mail usado para se inscrever.
      </Heading>
      <form
        className="card space-y-5"
        onSubmit={form.handleSubmit(async (values) => {
          setError('');
          setMessage('');
          try {
            const result = await send<{ message: string }>(
              '/public/access/recover',
              values,
            );
            setMessage(result.message);
          } catch (e) {
            setError((e as Error).message);
          }
        })}
      >
        {message && <Notice success>{message}</Notice>}
        {error && <Notice>{error}</Notice>}
        <Field
          label="Link ou identificador do evento"
          error={form.formState.errors.publicId?.message}
        >
          <Input
            {...form.register('publicId')}
            onChange={(e) => {
              const value = e.target.value.trim();
              const match = /\/eventos\/([0-9a-f-]{36})/i.exec(value);
              form.setValue('publicId', match ? match[1] : value, {
                shouldValidate: true,
              });
            }}
            placeholder="Cole o link que recebeu da liga"
          />
        </Field>
        <Field label="Seu e-mail" error={form.formState.errors.email?.message}>
          <Input
            type="email"
            autoComplete="email"
            {...form.register('email')}
          />
        </Field>
        <Button
          className="h-auto min-h-9 w-full whitespace-normal"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting
            ? 'Solicitando…'
            : 'Enviar link de acesso'}
        </Button>
      </form>
    </div>
  );
}
