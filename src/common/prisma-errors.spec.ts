import { Prisma } from '../generated/prisma/client.js';
import { isUniqueConstraint } from './prisma-errors.js';

describe('Tradução de conflitos únicos', () => {
  const error = (meta: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError('Conflito de teste', {
      code: 'P2002',
      clientVersion: '7.10.0',
      meta,
    });
  it('deve reconhecer os campos informados pelo Prisma', () => {
    expect(
      isUniqueConstraint(
        error({ target: ['email'] }),
        ['email'],
        'users_email_key',
      ),
    ).toBe(true);
  });
  it('deve reconhecer o índice informado pelo adaptador PostgreSQL', () => {
    expect(
      isUniqueConstraint(
        error({
          driverAdapterError: {
            cause: { constraint: { index: 'users_email_key' } },
          },
        }),
        ['email'],
        'users_email_key',
      ),
    ).toBe(true);
  });
  it('não deve confundir conflito de responsável com e-mail duplicado', () => {
    expect(
      isUniqueConstraint(
        error({
          driverAdapterError: {
            cause: { constraint: { index: 'users_one_organizer' } },
          },
        }),
        ['email'],
        'users_email_key',
      ),
    ).toBe(false);
    expect(
      isUniqueConstraint(
        new Error('Falha de conexão'),
        ['email'],
        'users_email_key',
      ),
    ).toBe(false);
  });
});
