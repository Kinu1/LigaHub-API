import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { accessFragment, captureAccessFragment } from '../access-fragment';
import { api } from '../api';
import { Button } from '../components/ui/button';
import { date } from '../types';
import { Heading, Loading, Notice, Status } from '../ui';
export function StatusPage() {
  const { id } = useParams();
  const [token] = useState(() => accessFragment('token'));
  useEffect(() => captureAccessFragment(), []);
  const query = useQuery({
    queryKey: ['status', id],
    queryFn: () =>
      api<{
        name: string;
        status: string;
        suspended: boolean;
        cancellationRequested: boolean;
        event: { title: string; location: string; startsAt: string };
      }>(`/public/registrations/${id}/status`, {
        headers: { 'x-registration-status-token': token || '' },
      }),
    enabled: !!token,
  });
  if (!token)
    return (
      <>
        <Notice>Solicite um novo link para consultar sua inscrição.</Notice>
        <Button asChild>
          <Link to="/recuperar">Solicitar link</Link>
        </Button>
      </>
    );
  if (query.isPending) return <Loading />;
  if (query.error)
    return (
      <>
        <Notice>{query.error.message}</Notice>
        <Button asChild>
          <Link to="/recuperar">Solicitar novo link</Link>
        </Button>
      </>
    );
  return (
    <div className="mx-auto max-w-xl">
      <Heading title={query.data?.event.title || 'Sua inscrição'} />
      <section className="card">
        <Status value={query.data?.status || ''} />
        {query.data?.suspended && (
          <Notice>
            Sua inscrição está suspensa. Entre em contato com a organização do
            evento.
          </Notice>
        )}
        {query.data?.status === 'canceled' && (
          <Notice>
            Sua inscrição foi cancelada e não garante vaga no evento. Para
            consultar os pagamentos, solicite acesso à gestão da inscrição.
          </Notice>
        )}
        {query.data?.cancellationRequested &&
          query.data.status !== 'canceled' && (
            <Notice>
              O cancelamento da sua inscrição foi solicitado. Entre em contato
              com a organização para acompanhar a solicitação.
            </Notice>
          )}
        <p className="mt-5">Olá, {query.data?.name}.</p>
        <p className="muted mt-3">
          {date(query.data?.event.startsAt)} · {query.data?.event.location}
        </p>
        <Button
          asChild
          variant="outline"
          className="mt-6 h-auto min-h-9 whitespace-normal"
        >
          <Link to="/recuperar">Solicitar acesso à gestão da inscrição</Link>
        </Button>
      </section>
    </div>
  );
}
