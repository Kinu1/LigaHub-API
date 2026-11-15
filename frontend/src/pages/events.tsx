import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { date, money, type Event, type Page } from '../types';
import { Empty, Heading, Notice, Pager, Status, useDebounced } from '../ui';
import { QueryState } from './query-state';
export function EventsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const querySearch = useDebounced(search);
  const [params, setParams] = useSearchParams();
  const status = ['draft', 'published', 'suspended', 'closed'].includes(
    params.get('status') || '',
  )
    ? params.get('status')!
    : '';
  const cancellations = params.get('attention') === 'cancellation';
  const query = useQuery({
    queryKey: ['events', page, querySearch, status],
    queryFn: () =>
      api<Page<Event>>(
        `/events?page=${page}&limit=12&search=${encodeURIComponent(querySearch)}&status=${status}`,
      ),
  });
  return (
    <>
      <Heading
        title="Eventos"
        action={
          <Button asChild>
            <Link to="/painel/eventos/novo">
              <Plus size={18} />
              Criar evento
            </Link>
          </Button>
        }
      >
        Organize cada detalhe do próximo encontro.
      </Heading>
      <div className="filter-bar mb-6 flex flex-wrap gap-3">
        <label className="relative min-w-0 flex-1">
          <Search
            className="absolute left-3 top-3.5 text-muted-foreground"
            size={18}
          />
          <Input
            aria-label="Buscar evento"
            placeholder="Buscar pelo nome do evento"
            style={{ paddingLeft: 40 }}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <select
          aria-label="Filtrar por estado"
          className="sm:max-w-48"
          value={status}
          onChange={(e) => {
            setParams((current) => {
              const next = new URLSearchParams(current);
              if (e.target.value) next.set('status', e.target.value);
              else next.delete('status');
              return next;
            });
            setPage(1);
          }}
        >
          <option value="">Todos os estados</option>
          {['draft', 'published', 'suspended', 'closed'].map((s) => (
            <option key={s} value={s}>
              {
                {
                  draft: 'Rascunho',
                  published: 'Publicado',
                  suspended: 'Suspenso',
                  closed: 'Encerrado',
                }[s]
              }
            </option>
          ))}
        </select>
        {query.data && (
          <p
            className="text-muted-foreground self-center text-sm"
            role="status"
          >
            {query.data.total} evento(s) encontrado(s)
            {status
              ? ` · ${{ draft: 'Rascunho', published: 'Publicado', suspended: 'Suspenso', closed: 'Encerrado' }[status]}`
              : ' · Todos os estados'}
          </p>
        )}
      </div>
      {cancellations && (
        <Notice success>
          Selecione um evento para consultar suas solicitações abertas de
          cancelamento. Esta lista inclui todos os eventos; não indica quais têm
          solicitações.
        </Notice>
      )}
      <QueryState query={query} hasData={!!query.data}>
        {query.data?.items.length ? (
          <>
            <section className="data-section" aria-label="Lista de eventos">
              <Table className="data-table" aria-label="Eventos">
                <TableHeader>
                  <TableRow>
                    <TableHead>Evento / local</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead className="md:text-right">Preço</TableHead>
                    <TableHead className="md:text-right">Capacidade</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.items.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell
                        data-label="Evento / local"
                        className="whitespace-normal break-words"
                      >
                        <div className="min-w-0">
                          <Link
                            className="font-medium hover:underline"
                            to={`/painel/eventos/${event.id}${cancellations ? '?status=cancellation' : ''}`}
                            aria-label={`${cancellations ? 'Analisar cancelamentos de' : 'Gerenciar evento'} ${event.title}`}
                          >
                            {event.title}
                          </Link>
                          <p className="text-muted-foreground mt-1 text-sm">
                            {event.location || 'Local a confirmar'}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell
                        data-label="Data"
                        className="whitespace-normal"
                      >
                        {date(event.startsAt)}
                      </TableCell>
                      <TableCell
                        data-label="Preço"
                        className="whitespace-normal break-words tabular-nums md:text-right"
                      >
                        {money(event.priceInCents)}
                      </TableCell>
                      <TableCell
                        data-label="Capacidade"
                        className="whitespace-normal tabular-nums md:text-right"
                      >
                        {event.capacity} vagas
                      </TableCell>
                      <TableCell data-label="Estado">
                        <Status value={event.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
            <Pager
              page={page}
              total={query.data.total}
              limit={12}
              setPage={setPage}
            />
          </>
        ) : (
          <Empty title="Nenhum evento encontrado">
            Crie seu primeiro evento ou ajuste os filtros.
          </Empty>
        )}
      </QueryState>
    </>
  );
}
