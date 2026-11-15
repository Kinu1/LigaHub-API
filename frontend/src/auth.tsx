import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, send } from './api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './components/ui/dialog';
import type { User } from './types';
const LoginForm = lazy(() =>
  import('./login').then((m) => ({ default: m.LoginForm })),
);
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
  const sessionFocus = useRef<HTMLElement | null>(null);
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
      if (!expired)
        sessionFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
      setExpired(true);
    };
    window.addEventListener('session-expired', listener);
    return () => window.removeEventListener('session-expired', listener);
  }, [client, user, expired]);
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
      <Dialog open={expired}>
        <DialogContent
          showCloseButton={false}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = sessionFocus.current?.isConnected
              ? sessionFocus.current
              : document.querySelector<HTMLElement>('main');
            if (target) {
              if (!target.matches('input,button,a,[tabindex]'))
                target.tabIndex = -1;
              target.focus();
            }
          }}
        >
          <DialogTitle className="sr-only">Sessão expirada</DialogTitle>
          <DialogDescription>
            Entre novamente para continuar. Seu formulário permanece nesta
            página.
          </DialogDescription>
          <Suspense fallback={<p role="status">Carregando formulário…</p>}>
            <LoginForm inline />
          </Suspense>
        </DialogContent>
      </Dialog>
    </Auth.Provider>
  );
}
