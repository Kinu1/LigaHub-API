import React from 'react';
import './access-fragment';
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
const EventEditor = React.lazy(() =>
  import('./pages/editor').then((m) => ({ default: m.EventEditor })),
);
const PublicEvent = React.lazy(() =>
  import('./pages/public').then((m) => ({ default: m.PublicEvent })),
);
const ParticipantPage = React.lazy(() =>
  import('./pages/public').then((m) => ({ default: m.ParticipantPage })),
);
const RecoveryPage = React.lazy(() =>
  import('./pages/public').then((m) => ({ default: m.RecoveryPage })),
);
const StatusPage = React.lazy(() =>
  import('./pages/public').then((m) => ({ default: m.StatusPage })),
);
import { Heading, Notice, Loading } from './ui';
import './styles.css';
import { HomePage } from './pages/home';
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
      { path: 'eventos/novo', element: <EventEditor /> },
      { path: 'eventos/:id', element: <EventDetails /> },
      { path: 'eventos/:id/editar', element: <EventEditor /> },
      { path: 'financeiro', element: <FinancePage /> },
      { path: 'usuarios', element: <UsersPage /> },
      { path: 'auditoria', element: <AuditPage /> },
    ],
  },
  {
    element: <PublicLayout />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/eventos/:publicId', element: <PublicEvent /> },
      { path: '/inscricao/:id', element: <ParticipantPage /> },
      { path: '/inscricoes/:id', element: <StatusPage /> },
      { path: '/recuperar', element: <RecoveryPage /> },
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
