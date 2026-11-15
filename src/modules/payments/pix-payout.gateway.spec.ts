import { generateKeyPairSync, verify } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PixPayoutGateway } from './pix-payout.gateway.js';
import {
  normalizePixKey,
  destinationFingerprint,
  readPixDestination,
} from './pix-payout.policy.js';
import { encryptCredential } from './payment-security.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const id = '8fed5e14-11ba-4fc9-af20-69d76089bf63';
const destination = {
  ownerId: id,
  keyType: 'EMAIL' as const,
  key: 'organizador@example.test',
  fingerprint: 'test',
};

describe('Payouts Pix', () => {
  it('assina exatamente o corpo transmitido com Ed25519, sem descontar tarifas', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    vi.stubEnv('MERCADO_PAGO_PAYOUTS_ENABLED', 'true');
    vi.stubEnv('MERCADO_PAGO_TEST_MODE', 'false');
    vi.stubEnv(
      'MERCADO_PAGO_PAYOUTS_PRIVATE_KEY_BASE64',
      Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString(
        'base64',
      ),
    );
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { id: 'POPTEST', transactions: [{ id: 'TOPTEST' }] },
          { status: 202 },
        ),
      );
    vi.stubGlobal('fetch', fetch);
    await new PixPayoutGateway().create(
      'token-ficticio',
      id,
      1055,
      destination,
    );
    const [url, request] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.mercadopago.com/v1/payouts');
    const headers = request.headers as Record<string, string>;
    expect(headers['X-enforce-signature']).toBe('true');
    expect(headers['X-test-token']).toBe('false');
    expect(headers['X-Idempotency-Key']).toBe(id);
    expect(
      verify(
        null,
        Buffer.from(request.body as string),
        publicKey,
        Buffer.from(headers['X-signature'], 'base64'),
      ),
    ).toBe(true);
    expect(JSON.parse(request.body as string).transactions[0]).toEqual({
      type: 'pix',
      pix: { type: 'EMAIL', chave: destination.key },
      amount: { currency: 'BRL', value: 10.55 },
      external_reference: id,
    });
  });
  it('recusa envio desativado, chave ausente ou algoritmo diferente em produção', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const gateway = new PixPayoutGateway();
    vi.stubEnv('MERCADO_PAGO_PAYOUTS_ENABLED', 'false');
    await expect(
      gateway.create('token', id, 1000, destination),
    ).rejects.toMatchObject({ status: 503 });
    vi.stubEnv('MERCADO_PAGO_PAYOUTS_ENABLED', 'true');
    vi.stubEnv('MERCADO_PAGO_TEST_MODE', 'false');
    vi.stubEnv('MERCADO_PAGO_PAYOUTS_PRIVATE_KEY_BASE64', '');
    await expect(
      gateway.create('token', id, 1000, destination),
    ).rejects.toMatchObject({ status: 503 });
    const { privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    vi.stubEnv(
      'MERCADO_PAGO_PAYOUTS_PRIVATE_KEY_BASE64',
      Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString(
        'base64',
      ),
    );
    await expect(
      gateway.create('token', id, 1000, destination),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('oculta respostas com dados sensíveis e não repete automaticamente um POST', async () => {
    vi.stubEnv('MERCADO_PAGO_PAYOUTS_ENABLED', 'true');
    vi.stubEnv('MERCADO_PAGO_TEST_MODE', 'true');
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ key: 'segredo-ficticio' }, { status: 500 }),
      );
    vi.stubGlobal('fetch', fetch);
    await expect(
      new PixPayoutGateway().create('token', id, 1000, destination),
    ).rejects.toThrow('Não foi possível confirmar');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['CPF', '12345678909', '12345678909'],
    ['CNPJ', '11.222.333/0001-81', '11222333000181'],
    ['EMAIL', 'Org@Example.test', 'org@example.test'],
    ['PHONE', '+5521999999999', '+5521999999999'],
    ['PIX_CODE', id.toUpperCase(), id],
  ])('valida e normaliza %s', (type, input, expected) => {
    expect(normalizePixKey(type, input)).toBe(expected);
  });
  it.each([
    ['CPF', '11111111111'],
    ['CPF', '12345678900'],
    ['CNPJ', '11222333000180'],
    ['PHONE', '21999999999'],
    ['EMAIL', 'invalido'],
    ['PIX_CODE', 'nao-e-uuid'],
    ['account', '123'],
  ])('recusa %s inválido', (type, key) => {
    expect(() => normalizePixKey(type, key)).toThrow();
  });
  it('vincula o snapshot ao organizador e detecta corrupção', () => {
    vi.stubEnv(
      'CREDENTIALS_ENCRYPTION_KEY',
      Buffer.alloc(32, 1).toString('base64'),
    );
    const data = {
      ...destination,
      fingerprint: destinationFingerprint(
        id,
        destination.keyType,
        destination.key,
      ),
    };
    expect(readPixDestination(encryptCredential(JSON.stringify(data)))).toEqual(
      data,
    );
    expect(() =>
      readPixDestination(
        encryptCredential(
          JSON.stringify({
            ...data,
            ownerId: '445f322e-1a16-4833-8036-26176afcc271',
          }),
        ),
      ),
    ).toThrow();
  });
});
