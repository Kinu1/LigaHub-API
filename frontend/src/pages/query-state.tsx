import { type ReactNode } from 'react';
import { Button } from '../components/ui/button';
import { Loading, Notice } from '../ui';
export function QueryState({
  query,
  children,
  hasData = false,
}: {
  query: { isPending: boolean; error: Error | null; refetch: () => unknown };
  children: ReactNode;
  hasData?: boolean;
}) {
  if (query.isPending) return <Loading />;
  if (query.error && !hasData)
    return (
      <>
        <Notice>{query.error.message}</Notice>
        <Button variant="outline" onClick={() => query.refetch()}>
          Tentar novamente
        </Button>
      </>
    );
  return (
    <>
      {query.error && (
        <Notice>
          Não foi possível atualizar os registros. Os dados anteriores continuam
          disponíveis.{' '}
          <Button
            variant="link"
            className="h-auto p-0"
            onClick={() => query.refetch()}
          >
            Tentar novamente
          </Button>
        </Notice>
      )}
      {children}
    </>
  );
}
