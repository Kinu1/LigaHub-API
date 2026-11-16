import React from 'react';
import '@fontsource-variable/inter';
import { ThemeProvider } from './theme';
import './access-fragment';
import ReactDOM from 'react-dom/client';
import {
  createBrowserRouter,
  RouterProvider,
  Link,
  useRouteError,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './auth';
const LoginPage = React.lazy(() =>
  import('./login').then((m) => ({ default: m.LoginPage })),
);
import { PublicLayout } from './public-layout';
const Layout = React.lazy(() =>
  import('./layout').then((m) => ({ default: m.Layout })),
);
const Dashboard = React.lazy(() =>
  import('./pages/dashboard').then((m) => ({ default: m.Dashboard })),
);
const EventsPage = React.lazy(() =>
  import('./pages/events').then((m) => ({ default: m.EventsPage })),
);
const EventDetails = React.lazy(() =>
  import('./pages/event-details').then((m) => ({ default: m.EventDetails })),
);
const FinancePage = React.lazy(() =>
  import('./pages/finance').then((m) => ({ default: m.FinancePage })),
);
const UsersPage = React.lazy(() =>
  import('./pages/users').then((m) => ({ default: m.UsersPage })),
);
const OperationsPage = React.lazy(() =>
  import('./pages/operations').then((m) => ({ default: m.OperationsPage })),
);
const OutboxPage = React.lazy(() =>
  import('./pages/outbox').then((m) => ({ default: m.OutboxPage })),
);
const AuditPage = React.lazy(() =>
  import('./pages/audit').then((m) => ({ default: m.AuditPage })),
);
const EventEditor = React.lazy(() =>
  import('./pages/editor').then((m) => ({ default: m.EventEditor })),
);
const PublicEvent = React.lazy(() =>
  import('./pages/public-event').then((m) => ({ default: m.PublicEvent })),
);
const ParticipantPage = React.lazy(() =>
  import('./pages/participant').then((m) => ({ default: m.ParticipantPage })),
);
const RecoveryPage = React.lazy(() =>
  import('./pages/recovery').then((m) => ({ default: m.RecoveryPage })),
);
const StatusPage = React.lazy(() =>
  import('./pages/participant-status').then((m) => ({ default: m.StatusPage })),
);
import { Heading, Notice, Loading } from './ui';
import './styles.css';
import { ExperienceProvider } from './experience';
const HomePage = React.lazy(() =>
  import('./pages/home').then((m) => ({ default: m.HomePage })),
);
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
      { path: 'emails', element: <OutboxPage /> },
      { path: 'operacao', element: <OperationsPage /> },
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
      <ThemeProvider>
        <ExperienceProvider>
          <AuthProvider>
            <React.Suspense fallback={<Loading />}>
              <RouterProvider router={router} />
            </React.Suspense>
          </AuthProvider>
        </ExperienceProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
