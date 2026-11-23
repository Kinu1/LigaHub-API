import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  History,
  LayoutDashboard,
  LogOut,
  Mail,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './components/ui/breadcrumb';
import { Button } from './components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from './components/ui/sidebar';
import { MotionSection, SoundToggle } from './experience';
import { ThemeToggle } from './theme';
import { Brand, Loading, Notice } from './ui';

type Item = [string, string, LucideIcon];
const management: Item[] = [
  ['/painel', 'Visão geral', LayoutDashboard],
  ['/painel/eventos', 'Eventos', CalendarDays],
  ['/painel/financeiro', 'Financeiro', Wallet],
];
const administration: Item[] = [
  ['/painel/usuarios', 'Usuários', Users],
  ['/painel/auditoria', 'Auditoria', History],
  ['/painel/emails', 'Fila de e-mails', Mail],
  ['/painel/operacao', 'Operação', Activity],
];

function NavigationGroup({ label, items }: { label: string; items: Item[] }) {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map(([path, name, Icon]) => (
            <SidebarMenuItem key={path}>
              <SidebarMenuButton
                asChild
                tooltip={name}
                isActive={
                  path === '/painel'
                    ? pathname === path
                    : pathname.startsWith(path)
                }
              >
                <NavLink
                  to={path}
                  end={path === '/painel'}
                  aria-label={name}
                  onClick={() => setOpenMobile(false)}
                >
                  <Icon aria-hidden="true" />
                  <span>{name}</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function ManagementShell() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const { state, isMobile, openMobile, open, setOpenMobile } = useSidebar();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);
  const parts = pathname.split('/').filter(Boolean);
  const section = [...management, ...administration].find(
    ([path]) => path !== '/painel' && pathname.startsWith(path),
  );
  const nested = parts.length > 2;
  const current =
    parts.at(-1) === 'novo'
      ? 'Criar evento'
      : parts.at(-1) === 'editar'
        ? 'Editar evento'
        : 'Detalhes do evento';
  return (
    <>
      <a href="#conteudo" className="skip-link">
        Ir para o conteúdo
      </a>
      <Sidebar
        collapsible="icon"
        className="management-sidebar"
        role="complementary"
        aria-label="Navegação da gestão"
      >
        <SidebarHeader className="sidebar-brand">
          <Link to="/painel">
            <Brand />
          </Link>
          {isMobile && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Fechar menu"
              onClick={() => setOpenMobile(false)}
            >
              <X aria-hidden="true" />
            </Button>
          )}
        </SidebarHeader>
        <SidebarContent>
          <nav aria-label="Menu de gestão">
            <NavigationGroup label="Gestão" items={management} />
            {user?.role === 'admin' && (
              <NavigationGroup label="Administração" items={administration} />
            )}
          </nav>
        </SidebarContent>
        <SidebarFooter className="border-t border-border p-3">
          <div className="sidebar-profile flex items-center gap-3 px-1 py-3">
            <span className="avatar">{user?.name.slice(0, 1)}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user?.name}</p>
              <p className="muted text-xs">
                {user?.role === 'admin' ? 'Administrador' : 'Organizador'}
              </p>
            </div>
          </div>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                aria-label="Sair da conta"
                tooltip="Sair da conta"
                onClick={async () => {
                  try {
                    await logout();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <LogOut aria-hidden="true" />
                <span>Sair da conta</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <div className="management flex min-w-0 flex-1 flex-col">
        <header className="app-topbar">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger
              aria-label={
                isMobile
                  ? 'Abrir menu'
                  : state === 'expanded'
                    ? 'Recolher menu'
                    : 'Expandir menu'
              }
              aria-expanded={isMobile ? openMobile : open}
            />
            <Breadcrumb className="hidden sm:block">
              <BreadcrumbList>
                <BreadcrumbItem>
                  {section ? (
                    <BreadcrumbLink asChild>
                      <Link to="/painel">Visão geral</Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>Visão geral</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
                {section && (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      {nested ? (
                        <BreadcrumbLink asChild>
                          <Link to={section[0]}>{section[1]}</Link>
                        </BreadcrumbLink>
                      ) : (
                        <BreadcrumbPage>{section[1]}</BreadcrumbPage>
                      )}
                    </BreadcrumbItem>
                  </>
                )}
                {nested && (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{current}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                )}
              </BreadcrumbList>
            </Breadcrumb>
            <span className="text-sm font-medium sm:hidden">
              {section?.[1] || 'Visão geral'}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SoundToggle />
            <ThemeToggle />
            <Button asChild variant="ghost" size="icon">
              <Link to="/" aria-label="Página inicial">
                <ArrowUpRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </header>
        <main id="conteudo" tabIndex={-1} className="management-content">
          {error && <Notice>{error}</Notice>}
          <MotionSection change={pathname}>
            <Outlet />
          </MotionSection>
        </main>
      </div>
    </>
  );
}

export function Layout() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <SidebarProvider>
      <ManagementShell />
    </SidebarProvider>
  );
}

export { PublicLayout } from './public-layout';
