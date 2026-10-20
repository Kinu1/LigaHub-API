import { describe, expect, it } from 'vitest';
import { validationPipe } from '../../common/http.js';
import { CreateEventDto, UpdateEventDto } from './catalog.dto.js';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

describe('Preço mínimo dos eventos na API', () => {
  it.each([CreateEventDto, UpdateEventDto])(
    'deve rejeitar preços abaixo de cinquenta centavos em %s',
    async (metatype) => {
      for (const priceInCents of [0, 1, 49]) {
        const body = { title: 'Evento', capacity: 10, priceInCents };
        expect(
          validateSync(plainToInstance(metatype, body)).find(
            (error) => error.property === 'priceInCents',
          )?.constraints?.min,
        ).toBe('O preço mínimo da inscrição é R$ 0,50.');
        await expect(
          validationPipe().transform(body, { type: 'body', metatype }),
        ).rejects.toThrow('Dados inválidos.');
      }
    },
  );
  it.each([CreateEventDto, UpdateEventDto])(
    'deve aceitar exatamente cinquenta centavos em %s',
    async (metatype) => {
      await expect(
        validationPipe().transform(
          { title: 'Evento', capacity: 10, priceInCents: 50 },
          { type: 'body', metatype },
        ),
      ).resolves.toMatchObject({ priceInCents: 50 });
    },
  );
  it('deve permitir editar outros campos sem reenviar o preço', async () => {
    await expect(
      validationPipe().transform(
        { title: 'Outro título' },
        { type: 'body', metatype: UpdateEventDto },
      ),
    ).resolves.toMatchObject({ title: 'Outro título' });
  });
});
