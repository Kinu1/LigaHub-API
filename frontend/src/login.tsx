import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from './auth';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { SoundToggle } from './experience';
import { ThemeToggle } from './theme';
import { Brand, Field, Notice } from './ui';
const loginSchema = z.object({
  email: z.email('Informe um e-mail válido.'),
  password: z
    .string()
    .refine(
      (value) =>
        Array.from(value).length >= 6 && Array.from(value).length <= 128,
      'A senha deve ter entre 6 e 128 caracteres.',
    ),
});
export function LoginForm({ inline = false }: { inline?: boolean }) {
  const auth = useAuth();
  const [error, setError] = useState('');
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
  });
  return (
    <form
      className="space-y-5"
      onSubmit={form.handleSubmit(async (values) => {
        setError('');
        try {
          await auth.login(values.email, values.password);
          if (!inline) location.assign('/painel');
        } catch (e) {
          setError((e as Error).message);
        }
      })}
    >
      <div>
        <p className="eyebrow">ACESSO À GESTÃO</p>
        <h1>{inline ? 'Entre novamente' : 'Bem-vindo de volta'}</h1>
        <p className="muted mt-3">Organize encontros. Conecte pessoas.</p>
      </div>
      {error && <Notice>{error}</Notice>}
      <Field label="E-mail" error={form.formState.errors.email?.message}>
        <Input
          type="email"
          autoComplete="username"
          autoFocus={inline}
          {...form.register('email')}
        />
      </Field>
      <Field label="Senha" error={form.formState.errors.password?.message}>
        <Input
          type="password"
          autoComplete="current-password"
          {...form.register('password')}
        />
      </Field>
      <Button className="w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? 'Entrando…' : 'Entrar no painel →'}
      </Button>
    </form>
  );
}
export function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="login-art hidden flex-col justify-between p-12 text-white lg:flex">
        <Brand inverse />
        <div className="max-w-lg">
          <p className="mb-5 text-sm uppercase tracking-widest text-white/85">
            Sua liga, mais perto
          </p>
          <h2 className="text-5xl font-bold leading-tight tracking-tight">
            Grandes encontros começam com uma boa organização.
          </h2>
          <p className="mt-6 text-lg text-red-100">
            Eventos, inscrições e pagamentos em um só lugar.
          </p>
        </div>
        <p className="text-sm text-red-100">
          LigaHub · Gestão de eventos acadêmicos
        </p>
      </section>
      <section className="flex flex-col justify-center p-6 sm:p-12">
        <div className="mb-12 lg:hidden">
          <Brand />
        </div>
        <div className="login-form-panel mx-auto w-full max-w-md">
          <div className="mb-5 flex justify-end gap-2">
            <SoundToggle />
            <ThemeToggle />
          </div>
          <LoginForm />
          <p className="muted mt-8 text-sm">
            Acesso exclusivo para administradores e organizador da liga.
          </p>
          <a href="/" className="mt-5 inline-block text-sm text-primary">
            Voltar ao início
          </a>
        </div>
      </section>
    </main>
  );
}
