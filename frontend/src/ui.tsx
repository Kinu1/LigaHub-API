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
import { AlertCircle, ArrowLeft, ArrowRight, Check, X } from 'lucide-react';
import { labels } from './types';
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        L<span />
      </span>
      Liga<span className="text-red-700">Hub</span>
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
      <div>
        <p className="eyebrow">{eyebrow || 'LIGAHUB'}</p>
        <h1>{title}</h1>
        {children && <p className="muted mt-2">{children}</p>}
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
  return (
    <span
      className={`badge ${['published', 'confirmed', 'approved'].includes(value) ? 'badge-good' : ''}`}
    >
      {labels[value] || value}
    </span>
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
    <div role="status" className="loading">
      <span className="spinner" />
      Carregando…
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
      <label htmlFor={id}>{label}</label>
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
      <div className="flex gap-2">
        <button
          className="btn secondary"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
          aria-label="Página anterior"
        >
          <ArrowLeft size={16} />
        </button>
        <button
          className="btn secondary"
          disabled={page * limit >= total}
          onClick={() => setPage(page + 1)}
          aria-label="Próxima página"
        >
          <ArrowRight size={16} />
        </button>
      </div>
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
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <>
      <button
        className="btn secondary"
        onClick={() => {
          setError('');
          ref.current?.showModal();
          cancelRef.current?.focus();
        }}
      >
        {children}
      </button>
      <dialog
        ref={ref}
        className="dialog"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <div className="flex justify-between gap-4">
          <h2 id={`${id}-title`}>{title}</h2>
          <button
            className="icon-btn"
            aria-label="Fechar"
            disabled={busy}
            onClick={() => ref.current?.close()}
          >
            <X />
          </button>
        </div>
        <p id={`${id}-description`} className="muted my-5">
          {description}
        </p>
        {error && <Notice>{error}</Notice>}
        <div className="flex justify-end gap-3 mt-5">
          <button
            className="btn secondary"
            ref={cancelRef}
            disabled={busy}
            onClick={() => ref.current?.close()}
          >
            Voltar
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                ref.current?.close();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Aguarde…' : 'Confirmar'}
          </button>
        </div>
      </dialog>
    </>
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
