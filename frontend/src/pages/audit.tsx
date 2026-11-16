import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { type Audit, type Page } from '../types';
import { Heading, Notice, Pager } from '../ui';
import { AuditList, auditCategories } from './audit-list';
import { QueryState } from './query-state';
export function AuditPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const query = useQuery({
    queryKey: ['audit', page, entityType],
    queryFn: () =>
      api<Page<Audit>>(
        `/admin/audit?page=${page}${entityType ? `&entityType=${entityType}` : ''}`,
      ),
    enabled: user?.role === 'admin',
  });
  if (user?.role !== 'admin')
    return <Notice>Você não tem acesso a esta área.</Notice>;
  return (
    <>
      <Heading title="Auditoria">
        Ações, responsáveis e registros afetados na plataforma.
      </Heading>
      <section className="data-section">
        <div className="filter-bar mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
          <label className="block w-full text-sm font-medium sm:w-64">
            Tipo de registro
            <select
              value={entityType}
              onChange={(event) => {
                setEntityType(event.target.value);
                setPage(1);
              }}
              className="mt-2 w-full"
            >
              <option value="">Todos os tipos</option>
              {Object.entries(auditCategories).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p className="muted max-w-md text-xs">
            Mais recentes primeiro. Horários de Brasília. Nomes e perfis
            refletem o cadastro atual.
          </p>
        </div>
        <QueryState query={query} hasData={!!query.data}>
          <AuditList data={query.data} />
          {query.data && (
            <Pager
              page={page}
              total={query.data.total}
              limit={query.data.limit}
              setPage={setPage}
            />
          )}
        </QueryState>
      </section>
    </>
  );
}
