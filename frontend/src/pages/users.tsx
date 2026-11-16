import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api, send } from '../api';
import { useAuth } from '../auth';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { type User } from '../types';
import { Confirm, Field, Heading, Notice } from '../ui';
import { QueryState } from './query-state';
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
        <section className="data-section">
          <QueryState query={query}>
            <Table className="data-table" aria-label="Usuários">
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Perfil / estado</TableHead>
                  <TableHead>Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data?.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell
                      data-label="Usuário"
                      className="whitespace-normal break-words"
                    >
                      <div>
                        <p className="font-semibold">{u.name}</p>
                        <p className="muted text-sm">{u.email}</p>
                      </div>
                    </TableCell>
                    <TableCell
                      data-label="Perfil / estado"
                      className="whitespace-normal"
                    >
                      <p className="mt-1 text-xs">
                        {u.role === 'admin' ? 'Administrador' : 'Organizador'} ·{' '}
                        <span
                          className={`badge ${u.active ? 'badge-good' : 'badge-danger'}`}
                        >
                          {u.active ? 'Ativo' : 'Suspenso'}
                        </span>
                      </p>
                    </TableCell>
                    <TableCell data-label="Ação">
                      <Confirm
                        title={
                          u.active ? 'Suspender usuário?' : 'Reativar usuário?'
                        }
                        description="A API verifica as permissões e protege o último administrador ativo."
                        onConfirm={async () => {
                          await send(
                            `/users/${u.id}/status`,
                            { active: !u.active },
                            'PATCH',
                          );
                          await client.invalidateQueries({
                            queryKey: ['users'],
                          });
                        }}
                      >
                        {u.active ? 'Suspender' : 'Reativar'}
                      </Confirm>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
            <Input {...form.register('name')} autoComplete="off" />
          </Field>
          <Field label="E-mail" error={form.formState.errors.email?.message}>
            <Input
              {...form.register('email')}
              type="email"
              autoComplete="off"
            />
          </Field>
          <Field
            label="Senha inicial"
            error={form.formState.errors.password?.message}
          >
            <Input
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
          <Button disabled={form.formState.isSubmitting}>Criar acesso</Button>
        </form>
      </div>
    </>
  );
}
