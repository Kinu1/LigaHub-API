import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  createBrowserRouter,
  RouterProvider,
  Navigate,
  Link,
  useRouteError,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, LoginPage } from './auth';
import { Layout, PublicLayout } from './layout';
const Dashboard = React.lazy(() =>
  import('./pages/panel').then((m) => ({ default: m.Dashboard })),
);
const EventsPage = React.lazy(() =>
  import('./pages/panel').then((m) => ({ default: m.EventsPage })),
);
const EventDetails = React.lazy(() =>
  import('./pages/panel').then((m) => ({ default: m.EventDetails })),
);
const FinancePage = React.lazy(() =>
  import('./pages/panel').then((m) => ({ default: m.FinancePage })),
);
const UsersPage = React.lazy(() =>
  import('./pages/panel').then((m) => ({ default: m.UsersPage })),
);
const AuditPage = React.lazy(() =>
  import('./pages/panel').then((m) => ({ default: m.AuditPage })),
);
import { Heading, Notice, Loading } from './ui';
import './styles.css';
function Home() {
  return (
    <div className="py-14">
      <p className="eyebrow">ENCONTROS QUE APROXIMAM</p>
      <h1 className="max-w-2xl text-4xl sm:text-6xl">
        Conhecimento compartilhado.
        <br />
        <span className="text-red-700">Experiências que ficam.</span>
      </h1>
      <p className="muted mt-6 max-w-xl text-lg">
        Recebeu um convite da sua liga? Abra o link do evento para conhecer a
        programação e fazer sua inscrição.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link className="btn" to="/recuperar">
          Acompanhar minha inscrição →
        </Link>
        <Link className="btn secondary" to="/login">
          Sou organizador
        </Link>
      </div>
      <div className="mt-16 grid gap-5 md:grid-cols-3">
        {[
          ['01', 'Inscreva-se', 'Preencha seus dados no link do evento.'],
          [
            '02',
            'Escolha como pagar',
            'Pix ou cartão, com processamento pelo Mercado Pago.',
          ],
          [
            '03',
            'Acompanhe sua vaga',
            'Consulte sua inscrição pelo link pessoal recebido por e-mail.',
          ],
        ].map(([n, title, text]) => (
          <div className="card" key={n}>
            <p className="eyebrow">{n}</p>
            <h2>{title}</h2>
            <p className="muted mt-3">{text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
function NotFound() {
  return (
    <>
      <Heading title="Página não encontrada" />
      <p className="muted mb-6">Confira o endereço ou volte ao início.</p>
      <Link className="btn" to="/">
        Voltar ao início
      </Link>
    </>
  );
}
function RouteError() {
  const error = useRouteError();
  return (
    <main className="mx-auto max-w-lg p-8">
      <Notice>
        {error instanceof Error
          ? error.message
          : 'Não foi possível abrir esta página.'}
      </Notice>
      <a href="/" className="btn">
        Voltar ao início
      </a>
    </main>
  );
}
const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  {
    path: '/painel',
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'eventos', element: <EventsPage /> },
      { path: 'eventos/:id', element: <EventDetails /> },
      { path: 'financeiro', element: <FinancePage /> },
      { path: 'usuarios', element: <UsersPage /> },
      { path: 'auditoria', element: <AuditPage /> },
    ],
  },
  {
    element: <PublicLayout />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <Home /> },

      { path: '*', element: <NotFound /> },
    ],
  },
]);
const client = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: true },
    mutations: { retry: false },
  },
});
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <AuthProvider>
        <React.Suspense fallback={<Loading />}>
          <RouterProvider router={router} />
        </React.Suspense>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
