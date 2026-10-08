import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, send } from './api';
import type { User } from './types';
import { Brand, Field, Notice } from './ui';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
const Auth = createContext<{
  user?: User;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}>({ loading: true, login: async () => {}, logout: async () => {} });
export const useAuth = () => useContext(Auth);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User>();
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const client = useQueryClient();
  useEffect(() => {
    if (
      !location.pathname.startsWith('/painel') &&
      location.pathname !== '/login'
    ) {
      setLoading(false);
      return;
    }
    api<User>('/auth/me')
      .then(setUser)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const listener = () => {
      if (!user) return;
      setExpired(true);
    };
    window.addEventListener('session-expired', listener);
    return () => window.removeEventListener('session-expired', listener);
  }, [client, user]);
  const value = {
    user,
    loading,
    login: async (email: string, password: string) => {
      const response = await send<{ user: User }>('/auth/login', {
        email,
        password,
      });
      setUser(response.user);
      setExpired(false);
      if (user && user.id !== response.user.id) {
        client.clear();
        location.assign('/painel');
      } else await client.refetchQueries({ type: 'active' });
    },
    logout: async () => {
      await send('/auth/logout');
      setUser(undefined);
      client.clear();
    },
  };
  return (
    <Auth.Provider value={value}>
      <div inert={expired}>{children}</div>
      {expired && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/40 p-4">
          <div
            className="card w-full max-w-md"
            role="dialog"
            aria-modal="true"
            aria-label="Sessão expirada"
          >
            <LoginForm inline />
            <p className="muted mt-4 text-sm">
              O formulário permanece nesta página. Entre novamente para
              continuar.
            </p>
          </div>
        </div>
      )}
    </Auth.Provider>
  );
}
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
        <input
          type="email"
          autoComplete="username"
          autoFocus={inline}
          {...form.register('email')}
        />
      </Field>
      <Field label="Senha" error={form.formState.errors.password?.message}>
        <input
          type="password"
          autoComplete="current-password"
          {...form.register('password')}
        />
      </Field>
      <button className="btn w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? 'Entrando…' : 'Entrar no painel →'}
      </button>
    </form>
  );
}
export function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-red-800 p-12 text-white lg:flex">
        <Brand />
        <div className="max-w-lg">
          <p className="mb-5 text-sm uppercase tracking-widest text-red-100">
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
        <div className="mx-auto w-full max-w-sm">
          <LoginForm />
          <p className="muted mt-8 text-sm">
            Acesso exclusivo para administradores e organizador da liga.
          </p>
          <a href="/" className="mt-5 inline-block text-sm text-red-800">
            Voltar ao início
          </a>
        </div>
      </section>
    </main>
  );
}
