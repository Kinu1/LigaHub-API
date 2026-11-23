import { useEffect, useState, type ComponentProps } from 'react';
import { initMercadoPago, CardPayment } from '@mercadopago/sdk-react';
import { Loading, Notice } from '../ui';

// This module (including the provider SDK) is requested only after opening Card.
export default function CardCheckout({
  publicKey,
  ...props
}: ComponentProps<typeof CardPayment> & { publicKey: string }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    try {
      initMercadoPago(publicKey, { locale: 'pt-BR' });
      setReady(true);
    } catch {
      setError(true);
    }
  }, [publicKey]);
  if (error)
    return <Notice>Não foi possível iniciar o formulário do cartão.</Notice>;
  if (!ready) return <Loading />;
  return <CardPayment {...props} />;
}
