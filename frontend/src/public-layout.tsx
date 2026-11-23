import { Link, Outlet, useLocation } from 'react-router-dom';
import { Brand } from './ui';
import { MotionSection, SoundToggle } from './experience';
import { ThemeToggle } from './theme';
import { Button } from './components/ui/button';
export function PublicLayout() {
  const { pathname } = useLocation();
  return (
    <>
      <a href="#conteudo-publico" className="skip-link">
        Ir para o conteúdo
      </a>
      <header className="public-topbar">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-4 sm:px-9">
          <Link to="/">
            <Brand />
          </Link>
          <div className="flex items-center gap-2">
            <SoundToggle />
            <ThemeToggle />
            <Button variant="ghost" asChild>
              <Link to="/login">
                <span className="hidden sm:inline">Acesso à gestão</span>
                <span className="sm:hidden">Entrar</span>
              </Link>
            </Button>
          </div>
        </div>
      </header>
      <main
        id="conteudo-publico"
        tabIndex={-1}
        className="mx-auto max-w-6xl px-5 py-9 sm:px-9 sm:py-12"
      >
        <MotionSection change={pathname}>
          <Outlet />
        </MotionSection>
      </main>
      <footer className="mx-auto max-w-6xl border-t border-border px-5 py-6 text-sm text-muted-foreground">
        LigaHub · Encontros que aproximam.
      </footer>
    </>
  );
}
