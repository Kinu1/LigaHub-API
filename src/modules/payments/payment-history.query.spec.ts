import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { PaymentHistoryQuery } from './payment-history.query.js';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
const parse = async (value: object) => {
  const query = (await pipe.transform(value, {
    type: 'query',
    metatype: PaymentHistoryQuery,
  })) as PaymentHistoryQuery;
  query.assertPeriod();
  return query;
};
describe('Filtros financeiros validados', () => {
  it('preserva padrão e transforma filtros válidos', async () => {
    expect((await parse({})).page).toBe(1);
    expect(
      await parse({
        page: '2',
        eventSearch: ' Jornada ',
        status: 'approved',
        method: 'card',
        from: '2026-10-27T00:00:00-03:00',
        to: '2026-10-28T03:00:00Z',
      }),
    ).toMatchObject({ page: 2, eventSearch: 'Jornada', method: 'card' });
  });
  it.each([
    { page: '0' },
    { page: '1e2' },
    { page: '0x10' },
    { page: ['1', '2'] },
    { page: '100001' },
    { eventId: 'errado' },
    { eventSearch: ' ' },
    { eventSearch: ['um', 'dois'] },
    { status: 'confirmed' },
    { method: 'boleto' },
    { from: '2026-02-30T03:00:00Z' },
    { from: '2026-10-27' },
    { from: '2026-10-27T00:00:00' },
    { to: 'amanha' },
    { from: '2026-10-28T03:00:00Z', to: '2026-10-27T03:00:00Z' },
    { from: '2026-10-27T03:00:00Z', to: '2026-10-27T03:00:00Z' },
    { ownerId: 'nao-pode-trocar-escopo' },
  ])('recusa consulta inválida %j', async (value) => {
    await expect(parse(value)).rejects.toMatchObject({ status: 400 });
  });
});
