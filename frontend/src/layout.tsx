import { useState, useEffect, useRef } from 'react';
import { NavLink, Outlet, Navigate, Link, useLocation } from 'react-router-dom';
import {
  type LucideIcon,
  LayoutDashboard,
  CalendarDays,
  Wallet,
  Users,
  History,
  Mail,
  Activity,
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
  const sidebar = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) menuButton.current?.focus();
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
      if (event.key === 'Tab') {
        const targets = sidebar.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
        if (!targets?.length) return;
        const first = targets[0];
        const last = targets[targets.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
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
  useEffect(() => {
    if (desktop) setOpen(false);
  }, [desktop]);
  useEffect(() => {
    if (!open || desktop) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open, desktop]);
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
          ['/painel/emails', 'Fila de e-mails', Mail],
          ['/painel/operacao', 'Operação', Activity],
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
        ref={sidebar}
        id="menu-gestao"
        inert={!open && !desktop}
        className={`app-sidebar fixed inset-y-0 left-0 z-40 flex w-64 flex-col overflow-y-auto border-r border-zinc-200 px-5 py-6 transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
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
          GESTÃO
        </p>
        <nav className="space-y-1" aria-label="Menu de gestão">
          {links.map(([path, label, Icon], index) => (
            <div key={path}>
            {index === 3 && <p className="mb-2 mt-6 px-4 text-[10px] font-semibold tracking-widest text-zinc-500">ADMINISTRAÇÃO</p>}
            <NavLink
              key={path}
              to={path}
              end={path === '/painel'}
              className="nav-link"
              onClick={() => setOpen(false)}
            >
              <Icon size={19} aria-hidden="true" />
              {label}
            </NavLink>
            </div>
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
      <div className="min-w-0 lg:ml-64" inert={open && !desktop}>
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
              <span className="sm:hidden">
                <Brand />
              </span>
              <span className="hidden sm:inline">
                {user.role === 'admin' ? 'Administração' : 'Minha liga'} <span className="mx-2 text-zinc-300">/</span> {links.find(([path]) => path === pathname)?.[1] || 'Eventos'}
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
