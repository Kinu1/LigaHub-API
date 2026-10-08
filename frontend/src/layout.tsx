import { useState, useEffect } from 'react';
import { NavLink, Outlet, Navigate, Link } from 'react-router-dom';
import {
  type LucideIcon,
  LayoutDashboard,
  CalendarDays,
  Wallet,
  Users,
  History,
  LogOut,
  Menu,
  X,
  ArrowUpRight,
} from 'lucide-react';
import { useAuth } from './auth';
import { Brand, Loading, Notice } from './ui';
export function Layout() {
  const { user, loading, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(
    () => window.matchMedia('(min-width:1024px)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(min-width:1024px)');
    const change = () => setDesktop(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const [error, setError] = useState('');
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  const links: [string, string, LucideIcon][] = [
    ['/painel', 'Visão geral', LayoutDashboard],
    ['/painel/eventos', 'Eventos', CalendarDays],
    ['/painel/financeiro', 'Financeiro', Wallet],
    ...(user.role === 'admin'
      ? ([
          ['/painel/usuarios', 'Usuários', Users],
          ['/painel/auditoria', 'Auditoria', History],
        ] as [string, string, LucideIcon][])
      : []),
  ];
  return (
    <div className="min-h-screen">
      <a href="#conteudo" className="sr-only focus:not-sr-only">
        Ir para o conteúdo
      </a>
      {open && (
        <button
          aria-label="Fechar menu"
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        inert={!open && !desktop}
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-zinc-200 bg-white px-5 py-7 transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="mb-10 flex items-center justify-between">
          <Link to="/painel">
            <Brand />
          </Link>
          <button
            className="icon-btn lg:hidden"
            aria-label="Fechar menu"
            onClick={() => setOpen(false)}
          >
            <X />
          </button>
        </div>
        <p className="mb-3 px-4 text-[10px] font-semibold tracking-widest text-zinc-500">
          ESPAÇO DA LIGA
        </p>
        <nav className="space-y-1">
          {links.map(([path, label, Icon]) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/painel'}
              className="nav-link"
              onClick={() => setOpen(false)}
            >
              <Icon size={19} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto border-t border-zinc-100 pt-5">
          <div className="flex gap-3 px-2">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-50 font-bold text-red-800">
              {user.name.slice(0, 1)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{user.name}</p>
              <p className="text-xs text-zinc-500">
                {user.role === 'admin' ? 'Administrador' : 'Organizador'}
              </p>
            </div>
          </div>
          <button
            className="nav-link mt-3 w-full"
            onClick={async () => {
              try {
                await logout();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <LogOut size={18} />
            Sair da conta
          </button>
        </div>
      </aside>
      <div className="lg:ml-64">
        <header className="flex h-20 items-center justify-between border-b border-zinc-200 bg-white px-5 sm:px-9">
          <div className="flex items-center gap-3">
            <button
              className="icon-btn lg:hidden"
              aria-label="Abrir menu"
              onClick={() => setOpen(true)}
            >
              <Menu />
            </button>
            <span className="text-sm text-zinc-500">
              Gestão <span className="mx-2 text-zinc-300">/</span> Liga
              acadêmica
            </span>
          </div>
          <Link
            to="/"
            className="flex items-center gap-1 text-xs text-zinc-500"
          >
            Página inicial <ArrowUpRight size={15} />
          </Link>
        </header>
        <main id="conteudo" className="mx-auto max-w-7xl p-5 sm:p-9">
          {error && <Notice>{error}</Notice>}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
export function PublicLayout() {
  return (
    <>
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between p-5">
          <Link to="/">
            <Brand />
          </Link>
          <Link className="text-sm font-medium text-zinc-600" to="/login">
            Acesso à gestão
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-5 py-10 sm:p-9">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-6xl border-t border-zinc-200 p-6 text-sm text-zinc-500">
        LigaHub · Encontros que aproximam.
      </footer>
    </>
  );
}
