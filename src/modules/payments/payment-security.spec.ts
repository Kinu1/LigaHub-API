import { createHmac, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertProviderPayment, decryptCredential, encryptCredential, verifyWebhook, type ProviderPayment } from './payment-security.js';

describe('Segurança de pagamentos', () => {
  const now = 1_780_000_000_000;
  const ts = String(now);
  const signature = () => `ts=${ts},v1=${createHmac('sha256', 'segredo-de-teste').update(`id:123;request-id:pedido;ts:${ts};`).digest('hex')}`;
  beforeEach(() => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
    vi.stubEnv('MERCADO_PAGO_WEBHOOK_SECRET', 'segredo-de-teste');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('deve criptografar credenciais com valores diferentes e recuperá-las', () => {
    const first = encryptCredential('token-secreto');
    const second = encryptCredential('token-secreto');
    expect(first).not.toContain('token-secreto');
    expect(first).not.toBe(second);
    expect(decryptCredential(first)).toBe('token-secreto');
    expect(decryptCredential(second)).toBe('token-secreto');
  });
  it('deve rejeitar uma credencial adulterada', () => {
    const encrypted = encryptCredential('token-secreto');
    const [iv, tag, ciphertext] = encrypted.split('.');
    const bytes = Buffer.from(ciphertext, 'base64url');
    bytes[0] ^= 1;
    expect(() => decryptCredential(`${iv}.${tag}.${bytes.toString('base64url')}`)).toThrow('Não foi possível ler as credenciais');
  });
  it('deve recusar chave de criptografia ausente', () => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '');
    expect(() => encryptCredential('token')).toThrow('Configure a chave de criptografia');
  });
  it('deve aceitar a assinatura válida do webhook', () => {
    expect(() => verifyWebhook(signature(), 'pedido', '123', now)).not.toThrow();
  });
  it('deve rejeitar a troca do identificador do pagamento', () => {
    expect(() => verifyWebhook(signature(), 'pedido', '999', now)).toThrow('Assinatura de notificação inválida.');
  });
  it('deve rejeitar o identificador da requisição adulterado', () => {
    expect(() => verifyWebhook(signature(), 'outro-pedido', '123', now)).toThrow('Assinatura de notificação inválida.');
  });
  it('deve rejeitar a reutilização de uma notificação antiga', () => {
    expect(() => verifyWebhook(signature(), 'pedido', '123', now + 300_001)).toThrow('fora do prazo');
  });
  it('deve rejeitar parâmetros de assinatura repetidos', () => {
    expect(() => verifyWebhook(`${signature()},ts=${ts}`, 'pedido', '123', now)).toThrow('Assinatura de notificação inválida.');
  });
  const payment: ProviderPayment = { id: 123, external_reference: 'tentativa', collector_id: 456, currency_id: 'BRL', transaction_amount: 10.25, status: 'approved', date_last_updated: '2026-10-07T12:00:00Z' };
  it('deve aceitar apenas o pagamento correspondente à inscrição e ao organizador', () => {
    expect(() => assertProviderPayment(payment, 'tentativa', '456', 1025)).not.toThrow();
  });
  it.each([
    { transaction_amount: 10.24 }, { transaction_amount: 10.251 },
    { collector_id: 999 }, { currency_id: 'USD' }, { external_reference: 'outra' },
  ])('deve rejeitar um pagamento com dados divergentes: %j', (change) => {
    expect(() => assertProviderPayment({ ...payment, ...change }, 'tentativa', '456', 1025)).toThrow('não corresponde');
  });
});
