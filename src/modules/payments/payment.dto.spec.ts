import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreatePaymentDto } from './payment.dto.js';

describe('Validação de pagamento', () => {
  it('deve rejeitar parcelas null antes de acessar o banco', async () => {
    const input = plainToInstance(CreatePaymentDto, {
      method: 'pix',
      cpf: '12345678909',
      installments: null,
    });
    const errors = await validate(input);
    expect(errors.some((error) => error.property === 'installments')).toBe(
      true,
    );
  });
  it('não deve aceitar Pix como bandeira de cartão', async () => {
    const input = plainToInstance(CreatePaymentDto, {
      method: 'card',
      cpf: '12345678909',
      cardToken: 'token',
      paymentMethodId: 'pix',
    });
    const errors = await validate(input);
    expect(errors.some((error) => error.property === 'paymentMethodId')).toBe(
      true,
    );
  });
  it('deve preencher uma parcela quando o campo não for enviado', async () => {
    const input = plainToInstance(CreatePaymentDto, {
      method: 'pix',
      cpf: '12345678909',
    });
    expect(await validate(input)).toHaveLength(0);
    expect(input.installments).toBe(1);
  });
  it.each(['cpf', 'cardToken', 'paymentMethodId', 'issuerId'])(
    'deve rejeitar null no campo %s de um pagamento com cartão',
    async (field) => {
      const input = plainToInstance(CreatePaymentDto, {
        method: 'card',
        cpf: '12345678909',
        cardToken: 'token',
        paymentMethodId: 'visa',
        [field]: null,
      });
      const errors = await validate(input);
      expect(errors.some((error) => error.property === field)).toBe(true);
    },
  );
});
