import { afterEach, describe, expect, it, vi } from 'vitest';
import { paymentAccountReturnUrl } from './payment-account-return.js';

afterEach(() => vi.unstubAllEnvs());

describe('Destino fixo do retorno OAuth', () => {
  it.each([
    'https://ligahub.example',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
  ])('aceita o site configurado %s', (origin) => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('FRONTEND_URL', origin);
    expect(paymentAccountReturnUrl().toString()).toBe(
      `${origin}/painel/financeiro`,
    );
  });
  it.each([
    '',
    '//evil.example',
    'javascript:alert(1)',
    'http://public.example',
    'https://user:password@site.example',
    'https://site.example/?next=evil',
    'https://site.example/#evil',
    'https://site.example/outro',
  ])('recusa configuração insegura %s', (origin) => {
    vi.stubEnv('FRONTEND_URL', origin);
    expect(() => paymentAccountReturnUrl()).toThrow(
      'Configure o endereço do site',
    );
  });
  it('exige HTTPS quando o processo está em produção', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3001');
    expect(() => paymentAccountReturnUrl()).toThrow(
      'Configure o endereço do site',
    );
  });
});
