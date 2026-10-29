import { useId, useState, type ReactNode } from 'react';
import { ImagePlus, Upload } from 'lucide-react';
import type { Event } from '../types';

export async function prepareEventImage(
  file: File,
  kind: 'logo' | 'banner',
): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error('Escolha uma imagem PNG, JPG ou WebP.');
  if (file.size > 5 * 1024 * 1024)
    throw new Error('A imagem deve ter no máximo 5 MB.');
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode().catch(() => {
      throw new Error(
        'Não foi possível ler essa imagem. Escolha outro arquivo.',
      );
    });
    const maxWidth = kind === 'logo' ? 512 : 1600;
    const maxHeight = kind === 'logo' ? 512 : 600;
    let scale = Math.min(
      1,
      maxWidth / image.naturalWidth,
      maxHeight / image.naturalHeight,
    );
    const canvas = document.createElement('canvas');
    for (let attempt = 0; attempt < 4; attempt++) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context)
        throw new Error('Não foi possível preparar a imagem neste navegador.');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const result = canvas.toDataURL('image/webp', 0.85 - attempt * 0.1);
      if (!result.startsWith('data:image/webp;base64,'))
        throw new Error(
          'Seu navegador não conseguiu preparar a imagem. Tente em outro navegador.',
        );
      if (result.length <= 400_000) return result;
      scale *= 0.75;
    }
    throw new Error(
      'Essa imagem tem muitos detalhes. Escolha um arquivo menor.',
    );
  } finally {
    URL.revokeObjectURL(source);
  }
}

export function EventImageInput({
  kind,
  value,
  onChange,
  onBusyChange,
}: {
  kind: 'logo' | 'banner';
  value: string;
  onChange: (value: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const label = kind === 'logo' ? 'Logo do evento' : 'Banner do evento';
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-2 block text-sm font-semibold">
        {label}
      </label>
      <p id={`${id}-hint`} className="muted mb-3 text-sm">
        {kind === 'logo'
          ? 'Prefira uma imagem quadrada, com fundo transparente.'
          : 'Prefira uma imagem horizontal, na proporção 1600 × 600.'}{' '}
        PNG, JPG ou WebP, até 5 MB.
      </p>
      <div
        className={`event-image-preview ${kind === 'logo' ? 'event-logo-preview' : 'event-banner-preview'}`}
      >
        {value ? (
          <img
            src={value}
            alt={`Prévia: ${label.toLocaleLowerCase('pt-BR')}`}
          />
        ) : (
          <div className="muted flex flex-col items-center gap-2 text-sm">
            <ImagePlus size={28} aria-hidden="true" />
            <span>
              {kind === 'logo'
                ? 'Sua logo aparece junto ao título'
                : 'Seu banner aparece no topo do evento'}
            </span>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="relative">
          <span
            className="btn secondary pointer-events-none"
            aria-hidden="true"
          >
            <Upload size={16} />
            {busy
              ? 'Preparando…'
              : value
                ? 'Trocar imagem'
                : 'Selecionar imagem'}
          </span>
          <input
            id={id}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
            aria-invalid={!!error}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setError('');
              setBusy(true);
              onBusyChange(true);
              try {
                onChange(await prepareEventImage(file, kind));
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
                onBusyChange(false);
              }
            }}
          />
        </div>
        {value && (
          <button
            type="button"
            className="text-sm text-red-800 underline underline-offset-4"
            disabled={busy}
            onClick={() => {
              onChange('');
              setError('');
            }}
          >
            Remover {kind}
          </button>
        )}
        {busy && (
          <span role="status" className="muted text-sm">
            Preparando imagem…
          </span>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="field-error mt-2 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

export function EventArtwork({
  event,
  children,
}: {
  event: Pick<Event, 'title' | 'logoImage' | 'bannerImage'>;
  children?: ReactNode;
}) {
  if (!event.logoImage && !event.bannerImage && !children) return null;
  return (
    <div className="event-artwork mb-6">
      {event.bannerImage && (
        <img
          className="event-banner"
          src={event.bannerImage}
          alt={`Banner do evento ${event.title}`}
          decoding="async"
        />
      )}
      {(event.logoImage || children) && (
        <div className="event-identity">
          {event.logoImage && (
            <img
              className="event-logo"
              src={event.logoImage}
              alt={`Logo do evento ${event.title}`}
              decoding="async"
            />
          )}
          {children && <div className="min-w-0 flex-1">{children}</div>}
        </div>
      )}
    </div>
  );
}
