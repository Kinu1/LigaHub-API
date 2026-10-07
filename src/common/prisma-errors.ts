import { Prisma } from '../generated/prisma/client.js';

// Prisma com adaptador PostgreSQL informa o índice; outros motores informam target.
export function isUniqueConstraint(
  error: unknown,
  fields: string[],
  index: string,
): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  )
    return false;
  const target = error.meta?.target;
  if (
    Array.isArray(target) &&
    target.length === fields.length &&
    fields.every((field) => target.includes(field))
  )
    return true;
  const adapter = error.meta?.driverAdapterError as
    | { cause?: { constraint?: { index?: unknown; fields?: unknown } } }
    | undefined;
  const constraint = adapter?.cause?.constraint;
  if (constraint?.index === index) return true;
  return (
    Array.isArray(constraint?.fields) &&
    constraint.fields.length === fields.length &&
    fields.every((field) => (constraint.fields as unknown[]).includes(field))
  );
}
