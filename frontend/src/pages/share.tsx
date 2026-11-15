import { ArrowUpRight, Check, Copy, Download } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { Notice } from '../ui';
export function Share({ publicId }: { publicId: string }) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  const url = `${location.origin}/eventos/${publicId}`;
  useEffect(() => {
    QRCode.toDataURL(url, {
      width: 220,
      margin: 2,
      color: { dark: '#991b1b', light: '#ffffff' },
    })
      .then(setQr)
      .catch(() => setError('Não foi possível gerar o QR Code.'));
  }, [url]);
  return (
    <div className="data-section">
      <h2>Convide os participantes</h2>
      <p className="muted mt-2 text-sm">
        Compartilhe o link público quando o evento estiver publicado.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2500);
            } catch {
              setError('Não foi possível copiar. Selecione o endereço abaixo.');
            }
          }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}{' '}
          {copied ? 'Link copiado' : 'Copiar link'}
        </Button>
        <Button variant="outline" asChild>
          <a href={url} target="_blank" rel="noreferrer">
            Abrir página <ArrowUpRight size={16} />
          </a>
        </Button>
      </div>
      <p className="mt-3 break-all text-xs text-muted-foreground">{url}</p>
      {qr && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium">
            QR Code de divulgação
          </summary>
          <img
            src={qr}
            width={220}
            height={220}
            alt="QR Code do link público do evento"
          />
          <Button variant="outline" asChild>
            <a href={qr} download="evento-ligahub.png">
              <Download size={16} />
              Baixar QR Code
            </a>
          </Button>
        </details>
      )}
      {error && <Notice>{error}</Notice>}
    </div>
  );
}
