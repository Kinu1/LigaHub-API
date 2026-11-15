import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Label } from './components/ui/label';
import { Skeleton } from './components/ui/skeleton';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from './components/ui/pagination';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './components/ui/dialog';
import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type ReactElement,
  type InputHTMLAttributes,
} from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { labels } from './types';
export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className={`brand ${inverse ? 'brand-inverse' : ''}`}>
      <img
        className="brand-logo"
        src="/logo-lauen.png"
        width={52}
        height={52}
        alt="Liga Acadêmica de Urgência e Emergência LAUEN · FABA"
      />
      <span className="brand-copy">
        <span>
          Liga<span className="brand-accent">Hub</span>
        </span>
        <span className="brand-caption">LAUEN · FABA</span>
      </span>
    </span>
  );
}
export function Heading({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {children && <div className="muted mt-2">{children}</div>}
      </div>
      {action}
    </header>
  );
}
export function Notice({
  children,
  success = false,
}: {
  children: ReactNode;
  success?: boolean;
}) {
  return (
    <div
      role={success ? 'status' : 'alert'}
      className={`notice ${success ? 'success' : ''}`}
    >
      {success ? <Check size={18} /> : <AlertCircle size={18} />}
      <div>{children}</div>
    </div>
  );
}
export function Status({ value }: { value: string }) {
  const tone = ['published', 'confirmed', 'approved'].includes(value)
    ? 'badge-good'
    : [
          'pending',
          'reserved',
          'created',
          'in_process',
          'authorized',
          'payment_review',
          'in_mediation',
        ].includes(value)
      ? 'badge-warning'
      : [
            'canceled',
            'cancelled',
            'rejected',
            'charged_back',
            'suspended',
            'failed',
          ].includes(value)
        ? 'badge-danger'
        : '';
  return (
    <Badge variant="ghost" className={`badge ${tone}`}>
      {labels[value] || value}
    </Badge>
  );
}
export function Empty({
  title = 'Nada por aqui ainda',
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-symbol">↗</span>
      <h2>{title}</h2>
      <p className="muted">
        {children || 'Os dados aparecerão aqui quando estiverem disponíveis.'}
      </p>
    </div>
  );
}
export function Loading() {
  return (
    <div role="status" className="loading" aria-label="Carregando">
      <span className="flex items-center gap-3">
        <span className="spinner" aria-hidden="true" />
        Carregando…
      </span>
      <div aria-hidden="true" className="space-y-3">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}
export function Field({
  label,
  error,
  children,
  hint,
}: {
  label: string;
  error?: string;
  children: ReactElement<InputHTMLAttributes<HTMLInputElement>>;
  hint?: string;
}) {
  const generatedId = useId();
  const id = children.props.id || generatedId;
  const description =
    [
      children.props['aria-describedby'],
      hint && `${id}-hint`,
      error && `${id}-error`,
    ]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <div className="field">
      <Label htmlFor={id}>{label}</Label>
      {cloneElement(children, {
        id,
        'aria-describedby': description,
        'aria-invalid': error ? true : children.props['aria-invalid'],
      })}
      {hint && (
        <small id={`${id}-hint`} className="muted">
          {hint}
        </small>
      )}
      {error && (
        <small id={`${id}-error`} className="field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
export function Pager({
  page,
  total,
  limit = 20,
  setPage,
}: {
  page: number;
  total: number;
  limit?: number;
  setPage: (page: number) => void;
}) {
  return (
    <div className="pager">
      <span className="muted">
        {total} registro(s) · Página {page} de{' '}
        {Math.max(1, Math.ceil(total / limit))}
      </span>
      <Pagination aria-label="Paginação" className="mx-0 w-auto">
        <PaginationContent>
          <PaginationItem>
            <Button
              variant="outline"
              size="icon"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              aria-label="Página anterior"
            >
              <ArrowLeft aria-hidden="true" />
            </Button>
          </PaginationItem>
          <PaginationItem>
            <Button
              variant="outline"
              size="icon"
              disabled={page * limit >= total}
              onClick={() => setPage(page + 1)}
              aria-label="Próxima página"
            >
              <ArrowRight aria-hidden="true" />
            </Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
export function Confirm({
  title,
  description,
  onConfirm,
  children,
}: {
  title: string;
  description: string;
  onConfirm: () => Promise<unknown>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending.current) {
          setOpen(value);
          if (value) setError('');
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">{children}</Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={!busy}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (pending.current) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (pending.current) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error && <Notice>{error}</Notice>}
        <DialogFooter>
          <Button
            ref={cancel}
            variant="outline"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Voltar
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              if (pending.current) return;
              pending.current = true;
              setBusy(true);
              setError('');
              try {
                await onConfirm();
                setOpen(false);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                pending.current = false;
                setBusy(false);
              }
            }}
          >
            {busy ? 'Aguarde…' : 'Confirmar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export function useUnsaved(dirty: boolean) {
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [dirty]);
}

export function useDebounced<T>(value: T, delay = 350): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
