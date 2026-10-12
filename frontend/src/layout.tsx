import { useState, useEffect, useRef } from 'react';
import { NavLink, Outlet, Navigate, Link, useLocation } from 'react-router-dom';
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
import { MotionSection, SoundToggle } from './experience';
export function Layout() {
  const { pathname } = useLocation();
  const { user, loading, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [open]);
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
        id="menu-gestao"
        inert={!open && !desktop}
        className={`app-sidebar fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-zinc-200 px-5 py-7 transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="mb-10 flex items-center justify-between">
          <Link to="/painel">
            <Brand />
          </Link>
          <button
            ref={closeButton}
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
        <header className="app-topbar flex h-20 items-center justify-between border-b border-zinc-200 px-5 sm:px-9">
          <div className="flex items-center gap-3">
            <button
              ref={menuButton}
              aria-expanded={open}
              aria-controls="menu-gestao"
              className="icon-btn lg:hidden"
              aria-label="Abrir menu"
              onClick={() => setOpen(true)}
            >
              <Menu />
            </button>
            <span className="text-sm text-zinc-500">
              <span className="font-semibold text-red-800 sm:hidden">
                LigaHub
              </span>
              <span className="hidden sm:inline">
                Gestão <span className="mx-2 text-zinc-300">/</span> Liga
                acadêmica
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <SoundToggle />
            <Link
              to="/"
              className="flex items-center gap-1 text-xs text-zinc-500"
            >
              <span className="hidden sm:inline">Página inicial</span>
              <ArrowUpRight size={17} aria-hidden="true" />
              <span className="sr-only sm:hidden">Página inicial</span>
            </Link>
          </div>
        </header>
        <main
          id="conteudo"
          tabIndex={-1}
          className="mx-auto max-w-7xl p-5 sm:p-9"
        >
          {error && <Notice>{error}</Notice>}
          <MotionSection change={pathname}>
            <Outlet />
          </MotionSection>
        </main>
      </div>
    </div>
  );
}
export function PublicLayout() {
  const { pathname } = useLocation();
  return (
    <>
      <a href="#conteudo-publico" className="sr-only focus:not-sr-only">
        Ir para o conteúdo
      </a>
      <header className="public-topbar border-b border-zinc-200">
        <div className="mx-auto flex max-w-6xl items-center justify-between p-5">
          <Link to="/">
            <Brand />
          </Link>
          <div className="flex items-center gap-3">
            <SoundToggle />
            <Link className="text-sm font-medium text-zinc-600" to="/login">
              <span className="hidden sm:inline">Acesso à gestão</span>
              <span className="sm:hidden">Entrar</span>
            </Link>
          </div>
        </div>
      </header>
      <main
        id="conteudo-publico"
        tabIndex={-1}
        className="mx-auto max-w-6xl p-5 py-10 sm:p-9"
      >
        <MotionSection change={pathname}>
          <Outlet />
        </MotionSection>
      </main>
      <footer className="mx-auto max-w-6xl border-t border-zinc-200 p-6 text-sm text-zinc-500">
        LigaHub · Encontros que aproximam.
      </footer>
    </>
  );
}
